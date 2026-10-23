import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { Args } from '../args'
import { flag } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import { VERSION } from '../version'
import BUTTON from '../../../../system/components/Button.tess?raw'

export const PRESETS = ['tessera', 'tailwind', 'none'] as const
export type Preset = (typeof PRESETS)[number]

// Every file of every preset, as text, keyed by its path in the template folder. Bundled at build time, so the
// published package needs no template folder at run time.
const TEMPLATES = import.meta.glob('../../templates/**/*', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>

/** The files a preset writes, by path relative to the project. */
export function presetFiles(preset: Preset): Record<string, string> {
  const prefix = `../../templates/${preset}/`
  const files: Record<string, string> = {}
  for (const [key, content] of Object.entries(TEMPLATES)) {
    if (key.startsWith(prefix)) files[key.slice(prefix.length)] = content
  }
  // The presets' Button is the design system's own, so there is one copy to maintain.
  if (preset !== 'none') files['system/components/Button.tess'] = BUTTON
  return files
}

const TYPES = `declare module '*.tess' {
  import type { Component } from '@pixelscriptio/tessera/core'
  const component: Component
  export default component
}

declare module 'virtual:tessera/tokens.css'
`

const CONFIG = `// Style rules, severity exemptions and options for Tessera. Every field is optional. See the docs for the list.
// export default { severity: [{ files: 'app/legacy/**', rules: '*', level: 'warn', reason: 'old screens', expires: '2027-01-01' }] }
export default {}
`

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "strict": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["app", "system", ".tessera/*.d.ts"]
}
`

/** Files a project may already configure Prettier in. */
const PRETTIER_CONFIGS = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.json5',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.toml',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  'prettier.config.ts',
]

const PRETTIERRC = JSON.stringify({ plugins: ['@pixelscriptio/tessera/prettier'] }, null, 2) + '\n'

const GITIGNORE_LINES = ['node_modules', 'dist', '.tessera']

/** Where the package comes from: a `link:` to a checkout (`--link`, for working on Tessera itself) or its version. */
function dependency(target: string, link: string | undefined): string {
  return link ? `link:${relative(target, resolve(link)).replaceAll('\\', '/')}` : `^${VERSION}`
}

export interface InitResult {
  written: string[]
  skipped: string[]
  preset: Preset
}

/**
 * `tessera init [folder] [--preset tessera|tailwind|none]`: start a project, in an empty folder or beside an existing
 * `package.json`. It never overwrites a file; what already exists is left alone and reported.
 *
 * The preset is chosen here (not at install time, which cannot prompt): in a terminal it asks, `--preset`
 * answers it, and with neither it uses `tessera`.
 */
export async function init(args: Args, io: Io): Promise<number> {
  const target = resolve(io.cwd, args.positional[0] ?? '.')
  const given = flag(args, 'preset')
  let preset: Preset
  if (typeof given === 'string') {
    if (!(PRESETS as readonly string[]).includes(given)) {
      throw new CliError(`There is no preset "${given}".`, `Presets: ${PRESETS.join(', ')}.`)
    }
    preset = given as Preset
  } else if (io.choose) {
    preset = (await io.choose('Which starting point?', [
      {
        value: 'tessera',
        label:
          'tessera: a small design system of our own (warm paper neutrals, one green accent), with a styled page; the docs use it too',
      },
      {
        value: 'tailwind',
        label:
          "tailwind: a full design system built from Tailwind's default theme, with a styled page",
      },
      {
        value: 'none',
        label: 'none: no tokens or themes; example files with the examples commented out',
      },
    ])) as Preset
  } else {
    preset = 'tessera'
    io.out(
      'No --preset given and no terminal to ask in, so using "tessera". Pass --preset tailwind or --preset none for another.',
    )
  }

  const linkFlag = flag(args, 'link')
  const link = typeof linkFlag === 'string' ? linkFlag : undefined
  const written: string[] = []
  const skipped: string[] = []
  const put = (file: string, content: string) => {
    const path = join(target, file)
    if (existsSync(path)) {
      skipped.push(file)
      return
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    written.push(file)
  }

  // package.json: written in an empty folder; in one that has it, only the missing scripts and the dependency.
  const manifestPath = join(target, 'package.json')
  const scripts = {
    dev: 'tessera dev',
    build: 'tessera build',
    preview: 'tessera preview',
    check: 'tessera check',
    format: 'tessera format',
  }
  let hasDependency
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, any>
    const added: string[] = []
    manifest.scripts ??= {}
    for (const [name, command] of Object.entries(scripts)) {
      if (manifest.scripts[name] === undefined) {
        manifest.scripts[name] = command
        added.push(`script "${name}"`)
      }
    }
    manifest.type ??= 'module'
    hasDependency = !!(
      manifest.dependencies?.['@pixelscriptio/tessera'] ??
      manifest.devDependencies?.['@pixelscriptio/tessera']
    )
    if (!hasDependency) {
      manifest.dependencies = {
        ...manifest.dependencies,
        '@pixelscriptio/tessera': dependency(target, link),
      }
      added.push('the @pixelscriptio/tessera dependency')
    }
    if (added.length) {
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      written.push(`package.json (added ${added.join(', ')})`)
    }
  } else {
    hasDependency = false
    const name =
      basename(target)
        .replace(/[^A-Za-z0-9._-]/g, '-')
        .toLowerCase() || 'tessera-app'
    put(
      'package.json',
      JSON.stringify(
        {
          name,
          version: '0.0.0',
          private: true,
          type: 'module',
          scripts,
          dependencies: { '@pixelscriptio/tessera': dependency(target, link) },
        },
        null,
        2,
      ) + '\n',
    )
  }

  for (const [file, content] of Object.entries(presetFiles(preset))) put(file, content)
  put('app/tess.d.ts', TYPES)
  put('tessera.config.ts', CONFIG)
  put('tsconfig.json', TSCONFIG)
  // Prettier knows `.tess` through the plugin. A project that already has Prettier configuration keeps its own.
  if (!PRETTIER_CONFIGS.some((name) => existsSync(join(target, name)))) {
    put('.prettierrc.json', PRETTIERRC)
  }

  // .gitignore: add what is missing, never remove.
  const ignorePath = join(target, '.gitignore')
  if (existsSync(ignorePath)) {
    const have = readFileSync(ignorePath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
    const missing = GITIGNORE_LINES.filter((l) => !have.includes(l))
    if (missing.length) {
      const text = readFileSync(ignorePath, 'utf8')
      writeFileSync(ignorePath, `${text}${text.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`)
      written.push(`.gitignore (added ${missing.join(', ')})`)
    }
  } else put('.gitignore', GITIGNORE_LINES.join('\n') + '\n')

  const where = args.positional[0]
  io.out(`Started a Tessera project (${preset} preset) in ${where ?? 'the current folder'}.`)
  if (written.length) io.out(`Wrote: ${written.join(', ')}`)
  if (skipped.length) io.out(`Left alone (already there): ${skipped.join(', ')}`)
  io.out('')
  io.out('Next:')
  if (where) io.out(`  cd ${where}`)
  if (!hasDependency) io.out('  npm install')
  io.out('  npm run dev')
  io.out('')
  io.out('To format .tess files, add Prettier as a dev dependency, then run npm run format.')
  return 0
}
