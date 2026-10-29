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

export const PRESETS = ['tailwind', 'unstyled', 'none'] as const
export type Preset = (typeof PRESETS)[number]

/** The design system each preset writes: its name in the config, and its folder under `system/`. */
export const SYSTEMS: Record<Preset, { name: string; folder: string }> = {
  tailwind: { name: 'Tailwind', folder: 'tailwind' },
  unstyled: { name: 'Unstyled', folder: 'unstyled' },
  // No tokens and no components: the person imports their own (`tessera tokens import`).
  none: { name: 'Design system', folder: 'design' },
}

/** The apps `init` can start with: a to-do app, a page that shows what Tessera does, or one empty page. */
export const STARTERS = ['todo', 'page', 'blank'] as const
export type Starter = (typeof STARTERS)[number]

/** The template folders each starter is made of, after `base` (which every project has). */
const STARTER_FOLDERS: Record<Starter, string[]> = {
  todo: ['layout', 'todo'],
  page: ['layout', 'page'],
  blank: ['blank'],
}

/** The tokens a person can choose, in the words the question uses: `none` is the unstyled preset (plain values). */
export const TOKEN_CHOICES = ['tailwind', 'none'] as const
const PRESET_OF_TOKENS: Record<(typeof TOKEN_CHOICES)[number], Preset> = {
  tailwind: 'tailwind',
  none: 'none',
}

/** The presets of earlier versions, and what to use now. */
const RENAMED: Record<string, string> = {
  tessera:
    'The tessera preset is now a design system you add: start with --tokens tailwind, then run tessera add tokens:tessera.',
}

// Every file of every preset, as text, keyed by its path in the template folder. Bundled at build time, so the
// published package needs no template folder at run time.
const TEMPLATES = import.meta.glob('../../templates/**/*', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>

// The components every project starts with, taken from the Tessera UI catalogue so there is one copy of each.
const STARTER_COMPONENTS = import.meta.glob('../../../ui/components/{Button,Card}.{tess,docs.md}', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>

/**
 * The files a project starts with, by path relative to the project: the starter app (`page`, the one that shows what
 * Tessera does, unless another is asked for), its two components, and its tokens.
 */
export function presetFiles(preset: Preset, starter: Starter = 'page'): Record<string, string> {
  const files: Record<string, string> = {}
  for (const folder of ['base', ...STARTER_FOLDERS[starter], preset]) {
    const prefix = `../../templates/${folder}/`
    for (const [key, content] of Object.entries(TEMPLATES)) {
      if (key.startsWith(prefix)) files[key.slice(prefix.length)] = content
    }
  }
  // A design system of your own has no components yet: a commented example shows how one is written.
  for (const [key, content] of Object.entries(preset === 'none' ? {} : STARTER_COMPONENTS)) {
    files[`system/components/${key.slice(key.lastIndexOf('/') + 1)}`] = content
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

/** The project's config: the design systems in `system/`, and which one is active. */
function configFor(preset: Preset): string {
  const { name, folder } = SYSTEMS[preset]
  return [
    '// Style rules, severity exemptions and options for Tessera. Every field is optional. See the docs for the list.',
    'export default {',
    '  // The design systems in system/. Each is a folder of tokens (system/<path>/tokens); the components in',
    '  // system/components are styled by the active one. Add one with `tessera add tokens:<name>`.',
    `  systems: [{ name: '${name}', path: '/${folder}' }],`,
    `  defaultSystem: '${name}',`,
    '  // `npm run dev` also serves the docs of this design system. Uncomment to serve only the app.',
    '  // docs: false,',
    "  // severity: [{ files: 'app/legacy/**', rules: '*', level: 'warn', reason: 'old screens', expires: '2027-01-01' }],",
    '}',
    '',
  ].join('\n')
}

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
    { mcpServers: { tessera: { command: 'npx', args: ['@pixelscriptio/tessera', 'mcp'] } } },
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
  starter: Starter
}

/**
 * `tessera init [folder] [--starter todo|page|blank] [--tokens tailwind|none]`: start a project, in an empty folder or
 * beside an existing `package.json`. It never overwrites a file; what already exists is left alone and reported.
 *
 * Two choices are made here (not at install time, which cannot prompt): the starter app and the tokens. In a terminal it
 * asks; `--starter` and `--tokens` answer; with neither and no terminal it uses the `page` starter and `tailwind`.
 * `--preset tailwind|unstyled` is the older spelling of `--tokens`.
 */
export async function init(args: Args, io: Io): Promise<number> {
  const target = resolve(io.cwd, args.positional[0] ?? '.')
  if (io.ui) io.out(io.ui.banner(`Tessera ${VERSION}`, 'A new project') + '\n')

  const givenStarter = flag(args, 'starter')
  let starter: Starter | undefined
  if (typeof givenStarter === 'string') {
    if (!(STARTERS as readonly string[]).includes(givenStarter)) {
      throw new CliError(
        `There is no starter "${givenStarter}".`,
        `Starters: ${STARTERS.join(', ')}.`,
      )
    }
    starter = givenStarter as Starter
  }

  const givenTokens = flag(args, 'tokens')
  const givenPreset = flag(args, 'preset')
  let preset: Preset | undefined
  if (typeof givenTokens === 'string') {
    if (!(TOKEN_CHOICES as readonly string[]).includes(givenTokens)) {
      throw new CliError(
        `There are no tokens called "${givenTokens}".`,
        `Tokens: ${TOKEN_CHOICES.join(', ')}.`,
      )
    }
    preset = PRESET_OF_TOKENS[givenTokens as (typeof TOKEN_CHOICES)[number]]
  } else if (typeof givenPreset === 'string') {
    // The older spelling: the names of the presets.
    const name = givenPreset
    if (!(PRESETS as readonly string[]).includes(name)) {
      throw new CliError(
        `There is no preset "${givenPreset}".`,
        RENAMED[givenPreset] ?? `Presets: ${PRESETS.join(', ')}.`,
      )
    }
    preset = name as Preset
  }

  if (io.choose) {
    preset ??=
      PRESET_OF_TOKENS[
        (await io.choose('Which tokens?', [
          {
            value: 'tailwind',
            label:
              "tailwind: tokens built from Tailwind's default theme (colors, spacing, type, shadows)",
          },
          {
            value: 'none',
            label: 'none: a blank slate, no components; import your own tokens afterwards',
          },
        ])) as (typeof TOKEN_CHOICES)[number]
      ]
    // A blank slate has no components to build a starter app from.
    if (preset !== 'none') {
      starter ??= (await io.choose('Which starter app?', [
        { value: 'todo', label: 'todo app: add, tick off and remove todos; kept in the browser' },
        {
          value: 'page',
          label:
            'starter page: a button that counts and a list from an API, to show what Tessera does',
        },
        { value: 'blank', label: 'blank slate: one empty page' },
      ])) as Starter
    }
  } else if (starter === undefined || preset === undefined) {
    const missing = [starter === undefined && '--starter', preset === undefined && '--tokens']
      .filter(Boolean)
      .join(' or ')
    preset ??= 'tailwind'
    starter ??= preset === 'none' ? 'blank' : 'page'
    io.out(
      `No ${missing} given and no terminal to ask in, so using the "${starter}" starter with "${preset}" tokens. Pass --starter todo|page|blank and --tokens tailwind|none to choose.`,
    )
  }
  preset ??= 'tailwind'
  if (preset === 'none') {
    if (starter !== undefined && starter !== 'blank') {
      io.out(
        `The "${starter}" starter is built from components, and the none tokens have none: using the blank page.`,
      )
    }
    starter = 'blank'
  }
  starter ??= 'page'

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
          dependencies: {
            '@pixelscriptio/tessera': dependency(target, link),
          },
        },
        null,
        2,
      ) + '\n',
    )
  }

  for (const [file, content] of Object.entries(presetFiles(preset, starter))) put(file, content)
  put('app/tess.d.ts', TYPES)
  put('tessera.config.ts', configFor(preset))
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
      'Could not write AGENTS.md and llms.txt. Run npx @pixelscriptio/tessera agent-files once the project builds.',
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
    printSummary(io, io.ui, { preset, starter, where, written, skipped, install: !hasDependency })
    return 0
  }
  io.out(
    `Started a Tessera project (${starter} starter, ${preset} tokens) in ${where ?? 'the current folder'}.`,
  )
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
  info: {
    preset: Preset
    starter: Starter
    where?: string
    written: string[]
    skipped: string[]
    install: boolean
  },
): void {
  const place = info.where ?? 'the current folder'
  io.out(
    ui.ok(ui.bold(`Started a Tessera project in ${place}`)) +
      ui.dim(` (${info.starter} starter, ${info.preset} tokens)`),
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
      'The docs for this design system open beside the app. Then: npm run check to validate, npx @pixelscriptio/tessera a11y for accessibility tests, npx @pixelscriptio/tessera add <Name> for more components.',
    ),
  )
}
