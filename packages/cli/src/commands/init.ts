import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { Args } from '../args'
import { flag } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import { openProjectAt } from '../project'
import type { Ui } from '../ui'
import { VERSION } from '../version'
import { agentFileContents } from './agent'

export const PRESETS = ['tessera', 'tailwind', 'none'] as const
export type Preset = (typeof PRESETS)[number]

// Every file of every preset, as text, keyed by its path in the template folder. Bundled at build time, so the
// published package needs no template folder at run time.
const TEMPLATES = import.meta.glob('../../templates/**/*', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>

// The design system's own components (the repository's `system/components`): Button, Checkbox, Switch, TextField,
// Accordion and the rest. There is one copy of each, and the presets that have a design system write it into the project.
// `none` has no design system, so it gets none of them.
const SYSTEM_COMPONENTS = import.meta.glob('../../../../system/components/*.tess', {
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
  if (preset !== 'none') {
    for (const [key, content] of Object.entries(SYSTEM_COMPONENTS)) {
      files[`system/components/${key.split('/').pop()}`] = content
    }
  }
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

/** Claude Code reads CLAUDE.md, and other tools read AGENTS.md: this one line makes them the same file. */
const CLAUDE_MD = '@AGENTS.md\n'

/** Starts the Tessera MCP server for a tool that reads `.mcp.json`, so it can look up components, tokens, APIs and state. */
const MCP_JSON =
  JSON.stringify(
    { mcpServers: { tessera: { command: 'npx', args: ['tessera', 'mcp'] } } },
    null,
    2,
  ) + '\n'

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
  if (io.ui) io.out(io.ui.banner(`Tessera ${VERSION}`, 'A new project') + '\n')
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

  // For an AI tool: what the project is and how it is written, and a way to look things up. A model should be able to
  // build in this folder without searching for Tessera first.
  try {
    const generated = agentFileContents(await openProjectAt(target))
    for (const [file, text] of generated.files) put(file, text)
    mkdirSync(join(target, '.tessera'), { recursive: true })
    if (!existsSync(join(target, '.tessera', 'manifest.json')))
      writeFileSync(join(target, '.tessera', 'manifest.json'), generated.manifest)
  } catch {
    io.out(
      'Could not write AGENTS.md and llms.txt. Run npx tessera agent-files once the project builds.',
    )
  }
  put('CLAUDE.md', CLAUDE_MD)
  put('.mcp.json', MCP_JSON)

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
  if (io.ui) {
    printSummary(io, io.ui, { preset, where, written, skipped, install: !hasDependency })
    return 0
  }
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

/** What init did, for a person: the folders it filled, then the three commands to run. */
function printSummary(
  io: Io,
  ui: Ui,
  info: { preset: string; where?: string; written: string[]; skipped: string[]; install: boolean },
): void {
  const place = info.where ?? 'the current folder'
  io.out(
    ui.ok(ui.bold(`Started a Tessera project in ${place}`)) + ui.dim(` (${info.preset} preset)`),
  )
  // Files by their first folder, so twenty-eight lines become a few.
  const folders = new Map<string, number>()
  for (const file of info.written) {
    const top = file.includes('/') ? file.split('/')[0] + '/' : file.replace(/ \(.*$/, '')
    folders.set(top, (folders.get(top) ?? 0) + 1)
  }
  io.out('')
  io.out(
    ui.columns(
      [...folders].map(([name, count]) => [
        ui.accent(name),
        ui.dim(`${count} ${count === 1 ? 'file' : 'files'}`),
      ]),
      { indent: 2 },
    ),
  )
  if (info.skipped.length)
    io.out('\n' + ui.warn(`Left alone (already there): ${info.skipped.join(', ')}`))
  io.out('')
  io.out(ui.heading('Next'))
  const steps = [
    ...(info.where ? [`cd ${info.where}`] : []),
    ...(info.install ? ['npm install'] : []),
    'npm run dev',
  ]
  io.out(steps.map((step, i) => `  ${ui.dim(String(i + 1))}  ${ui.bold(step)}`).join('\n'))
  io.out('')
  io.out(
    ui.dim(
      'Then: npx tessera docs for the design system docs, npx tessera check to validate, npx tessera a11y for accessibility tests.',
    ),
  )
}
