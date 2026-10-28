import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { formatDiagnostic } from '@tessera/compiler'
import type { Args } from '../args'
import { flag, has } from '../args'
import { checkProject } from '../check-project'
import { refreshAgentFiles } from './agent'
import type { Io } from '../io'
import { CliError } from '../io'
import { openProject } from '../project'
import {
  checksum,
  isComponentName,
  RegistryError,
  type RegistryFile,
  type RegistryItem,
} from '../registry/schema'
import { openSource, type RegistrySource } from '../registry/source'
import {
  addMissingTokens,
  applyMap,
  describeFit,
  FIT_FILE,
  fitOf,
  hasProblems,
  needsOf,
  parseMap,
  type SystemFit,
} from '../token-fit'
import { VERSION } from '../version'

const LOCK_FILE = 'tessera.lock.json'
const FOLDER_NAME = /^[a-z][a-z0-9-]*$/

interface Lock {
  version: 1
  items: Record<string, { item: string; registry: string; sha256: string; files: string[] }>
}

/** A folder registry is recorded relative to the project, so the lock file means the same on every computer. */
const portable = (root: string, label: string): string =>
  isAbsolute(label) ? relative(root, label).replaceAll('\\', '/') || '.' : label

const compareVersions = (a: string, b: string): number => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x![i]! !== y![i]!) return x![i]! < y![i]! ? -1 : 1
  return 0
}

/** The framework version the project builds with: the installed package's, else the CLI's own. */
function frameworkVersion(root: string): string {
  try {
    const manifest = join(root, 'node_modules', '@pixelscriptio', 'tessera', 'package.json')
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version
  } catch {
    return VERSION
  }
}

function readLock(root: string): Lock {
  try {
    return JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8')) as Lock
  } catch {
    return { version: 1, items: {} }
  }
}

/** Give a component another name: its files, its contract, and the tags and words that mean itself. */
function renameComponent(item: RegistryItem, name: string): RegistryFile[] {
  const word = new RegExp(`\\b${item.name}\\b`, 'g')
  return item.files.map((file) => {
    if (file.path === `${item.name}.tess`) {
      const content = file.content
        .replace(new RegExp(`("name"\\s*:\\s*)"${item.name}"`), `$1"${name}"`)
        .replace(new RegExp(`(</?)${item.name}\\b`, 'g'), `$1${name}`)
      return { path: `${name}.tess`, content }
    }
    if (file.path === `${item.name}.docs.md`)
      return { path: `${name}.docs.md`, content: file.content.replace(word, name) }
    return file
  })
}

/** A line-by-line comparison, `-` for yours and `+` for the registry's, with two lines around each change. */
export function lineDiff(yours: string, theirs: string): string[] {
  const a = yours.split('\n')
  const b = theirs.split('\n')
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  const all: Array<[' ' | '-' | '+', string]> = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) (all.push([' ', a[i++]!]), j++)
    else if (j < b.length && (i === a.length || table[i]![j + 1]! >= table[i + 1]![j]!))
      all.push(['+', b[j++]!])
    else all.push(['-', a[i++]!])
  }
  const show = new Set<number>()
  all.forEach(([mark], index) => {
    if (mark !== ' ') for (let k = index - 2; k <= index + 2; k++) show.add(k)
  })
  const out: string[] = []
  let last = -1
  all.forEach(([mark, text], index) => {
    if (!show.has(index)) return
    if (last !== -1 && index !== last + 1) out.push('  ...')
    out.push(`${mark} ${text}`)
    last = index
  })
  return out
}

interface Step {
  item: RegistryItem
  /** What it is installed as: the component's name, or the token set's folder. */
  as: string
  files: RegistryFile[]
  /** Where each file goes, relative to the project. */
  dir: string
  action: 'add' | 'replace'
}

/** `tessera add`: install components and token sets from a registry into the project. */
export async function add(args: Args, io: Io): Promise<number> {
  const from = flag(args, 'from')
  if (from !== undefined && typeof from !== 'string')
    throw new CliError('"--from" needs a folder or an address.')
  let source: RegistrySource
  try {
    source = openSource(from, io.cwd)
  } catch (error) {
    if (error instanceof RegistryError) throw new CliError(error.message)
    throw error
  }
  try {
    return await run(args, io, source)
  } catch (error) {
    if (error instanceof RegistryError) throw new CliError(error.message)
    throw error
  }
}

async function run(args: Args, io: Io, source: RegistrySource): Promise<number> {
  const index = await source.index()
  const names = args.positional
  const ui = io.ui

  if (has(args, 'list')) {
    const root = (await openProject(io.cwd, args).catch(() => undefined))?.root
    const installed = new Set(root ? Object.values(readLock(root).items).map((i) => i.item) : [])
    const items = index.items.map((i) => ({ ...i, installed: installed.has(i.name) }))
    if (has(args, 'json')) {
      io.out(JSON.stringify({ registry: source.label, items }, null, 2))
      return 0
    }
    io.out(`${index.name} (${source.label})`)
    for (const i of items)
      io.out(`  ${i.name.padEnd(18)} ${i.installed ? '[installed] ' : ''}${i.description}`)
    return 0
  }

  if (!names.length)
    throw new CliError(
      'Say what to add.',
      'For example: tessera add Button    (tessera add --list shows what there is)',
    )
  const as = flag(args, 'as')
  if (as !== undefined && (typeof as !== 'string' || names.length > 1))
    throw new CliError('"--as" needs a name, and works with one item at a time.')
  const fitFlag = flag(args, 'fit')
  if (fitFlag !== undefined && fitFlag !== 'add' && fitFlag !== 'set' && fitFlag !== 'skip')
    throw new CliError(
      '"--fit" is add, set or skip.',
      'add puts the missing tokens in a file of their own, set installs the whole reference set as another design system, skip leaves the tokens alone.',
    )
  const mapFlag = flag(args, 'map')
  let map = new Map<string, string>()
  if (mapFlag !== undefined) {
    try {
      map = parseMap(typeof mapFlag === 'string' ? mapFlag : '')
    } catch (error) {
      throw new CliError(error instanceof Error ? error.message : String(error))
    }
  }

  const project = await openProject(io.cwd, args)
  const root = project.root
  const componentsDir = join(root, 'system', 'components')
  const version = frameworkVersion(root)
  const have = new Map<string, string>(
    [...project.components().registry.entries.values()].map((e) => [
      e.name,
      project.display(e.file),
    ]),
  )

  // A file in system/components takes its name even if its contract is broken, so the registry alone would miss it.
  if (existsSync(componentsDir)) {
    for (const file of readdirSync(componentsDir)) {
      const name = file.endsWith('.tess') ? file.slice(0, -'.tess'.length) : undefined
      if (name && !have.has(name)) have.set(name, `system/components/${file}`)
    }
  }

  const fetched = new Map<string, RegistryItem>()
  const fetchItem = async (name: string): Promise<RegistryItem> => {
    if (!fetched.has(name)) {
      if (!index.items.some((i) => i.name === name)) {
        const near = index.items
          .map((i) => i.name)
          .filter(
            (n) =>
              n.toLowerCase() === name.toLowerCase() ||
              n.toLowerCase().startsWith(name.toLowerCase().slice(0, 3)),
          )
        throw new CliError(
          `${source.label} has no "${name}".`,
          near.length
            ? `Did you mean ${near.slice(0, 3).join(', ')}?`
            : 'tessera add --list shows what there is.',
        )
      }
      fetched.set(name, await source.item(name))
    }
    return fetched.get(name)!
  }

  const steps: Step[] = []
  const kept: string[] = []
  const queued = new Set<string>()

  /** Decide what to do with the main item when its name is taken. */
  const resolveName = async (
    item: RegistryItem,
  ): Promise<{ as: string; action: 'add' | 'replace' } | undefined> => {
    const isTokens = item.type === 'tokens'
    const label = item.name
    const wanted = isTokens ? label.slice('tokens:'.length) : label
    const targetDir = isTokens ? join(root, 'system', wanted, 'tokens') : componentsDir
    const existing = isTokens
      ? existsSync(targetDir) && readdirSync(targetDir).length
        ? project.display(targetDir)
        : undefined
      : have.get(wanted)
    const valid = (n: string) => (isTokens ? FOLDER_NAME.test(n) : isComponentName(n))
    const free = (n: string) =>
      isTokens
        ? !(
            existsSync(join(root, 'system', n, 'tokens')) &&
            readdirSync(join(root, 'system', n, 'tokens')).length
          )
        : !have.has(n)
    const kind = isTokens ? 'token set' : 'component'

    // A comparison writes nothing, so a taken name is the point, not a problem.
    if (has(args, 'diff')) return { as: typeof as === 'string' ? as : wanted, action: 'replace' }
    if (typeof as === 'string') {
      if (!valid(as))
        throw new CliError(
          `"${as}" is not a valid ${isTokens ? 'folder name (lower case, digits and hyphens)' : 'component name (capitalized, letters and digits)'}.`,
        )
      if (!free(as))
        throw new CliError(
          `There is already a ${kind} named "${as}" in this project. Pick another name with --as.`,
        )
      return { as, action: 'add' }
    }
    if (!existing) return { as: wanted, action: 'add' }
    // Replacing writes into system/components, so a component that lives elsewhere (app/components) cannot be replaced.
    const replaceable = isTokens || existing.startsWith('system/components/')
    if (has(args, 'replace')) {
      if (!replaceable)
        throw new CliError(
          `Your ${wanted} is in ${existing}, which Tessera UI does not write to. Use --as <Name> to add the new one beside it.`,
        )
      return { as: wanted, action: 'replace' }
    }
    if (!io.choose || has(args, 'yes')) {
      throw new CliError(
        `There is already a ${kind} named "${wanted}" in this project (${existing}).`,
        `Say what to do: --replace to overwrite yours with the new one, or --as <${isTokens ? 'folder' : 'Name'}> to add the new one under another name.`,
      )
    }
    const choice = await io.choose(
      `A ${kind} named "${wanted}" already exists. Existing: ${existing} (yours). New: ${wanted} from ${source.label}. What now?`,
      [
        ...(replaceable
          ? [
              {
                value: 'replace',
                label: `replace: Overwrite your existing ${wanted} (${existing}) with the new one`,
              },
            ]
          : []),
        {
          value: 'rename',
          label: `rename: Keep your existing ${wanted}, and add the new one under another name`,
        },
        { value: 'cancel', label: 'cancel: Change nothing' },
      ],
    )
    if (choice === 'cancel') return undefined
    if (choice === 'replace') return { as: wanted, action: 'replace' }
    for (let attempt = 0; attempt < 3; attempt++) {
      const answer = (
        await (io.ask?.(`Name for the new ${kind}, so your existing "${wanted}" stays as it is:`) ??
          Promise.resolve(''))
      ).trim()
      if (!answer) return undefined
      if (valid(answer) && free(answer)) return { as: answer, action: 'add' }
      io.out(
        `"${answer}" is ${valid(answer) ? 'already used' : 'not a valid name'}. Try another, or press Enter to cancel.`,
      )
    }
    return undefined
  }

  const plan = async (name: string, main: boolean): Promise<boolean> => {
    if (queued.has(name)) return true
    const item = await fetchItem(name)
    if (item.minTessera && compareVersions(version, item.minTessera) < 0) {
      throw new CliError(
        `${name} needs @pixelscriptio/tessera ${item.minTessera} or newer, and this project has ${version}.`,
        'Update the package (npm install @pixelscriptio/tessera@latest), then add it again.',
      )
    }
    for (const dep of item.components ?? []) {
      if (queued.has(dep)) continue
      if (have.has(dep)) {
        kept.push(dep)
        queued.add(dep)
        continue
      }
      await plan(dep, false)
    }
    queued.add(name)
    const chosen = main
      ? await resolveName(item)
      : item.type === 'tokens'
        ? { as: name.slice('tokens:'.length), action: 'add' as const }
        : { as: name, action: 'add' as const }
    if (!chosen) return false
    const files =
      chosen.as === name || item.type === 'tokens' ? item.files : renameComponent(item, chosen.as)
    steps.push({
      item,
      as: chosen.as,
      files,
      dir:
        item.type === 'tokens' ? join('system', chosen.as, 'tokens') : join('system', 'components'),
      action: chosen.action,
    })
    return true
  }

  // Support files a component brings (the icon set) are shared: the same content is skipped, different content is a conflict.
  for (const name of names) {
    if (!(await plan(name, true))) {
      io.out('Cancelled. Nothing was changed.')
      return 1
    }
  }

  if (has(args, 'diff')) {
    for (const step of steps) {
      for (const file of step.files) {
        const path = join(root, step.dir, file.path)
        if (!existsSync(path)) {
          io.out(`${join(step.dir, file.path).replaceAll('\\', '/')}: not in your project`)
          continue
        }
        const yours = readFileSync(path, 'utf8')
        if (yours === file.content)
          io.out(`${join(step.dir, file.path).replaceAll('\\', '/')}: same as ${source.label}`)
        else {
          io.out(`--- yours: ${join(step.dir, file.path).replaceAll('\\', '/')}`)
          io.out(`+++ ${source.label}: ${step.item.name}`)
          for (const line of lineDiff(yours, file.content)) io.out(line)
        }
      }
    }
    return 0
  }

  // Token fit: do the design systems have the tokens the new components use?
  const componentSteps = steps.filter((s) => s.item.type === 'component')
  if (map.size) {
    const used = new Set(needsOf(componentSteps.flatMap((s) => s.files)).map((n) => n.path))
    for (const from of map.keys()) {
      if (!used.has(from))
        throw new CliError(
          `"--map ${from}=${map.get(from)}": no component you are adding uses ${from}.`,
          'Check the spelling of the token; the report lists the tokens the components use.',
        )
    }
    for (const step of componentSteps) step.files = applyMap(step.files, map)
  }
  let fix: 'add' | 'set' | undefined = fitFlag === 'add' || fitFlag === 'set' ? fitFlag : undefined
  let fits: SystemFit[] = []
  if (fitFlag !== 'skip' && componentSteps.length) {
    fits = fitOf(project, needsOf(componentSteps.flatMap((s) => s.files)))
    if (hasProblems(fits)) {
      io.out(
        'The new components use tokens that some of your design systems lack or define differently:',
      )
      for (const line of describeFit(fits)) io.out(line)
      io.out('')
      const canAdd = fits.some((f) => f.missing.length)
      if (!fix && !map.size && io.choose && !has(args, 'yes')) {
        const choice = await io.choose('How should the tokens be made to fit?', [
          ...(canAdd
            ? [
                {
                  value: 'add',
                  label: `add: Add the missing tokens to a file of their own (${FIT_FILE}) in each system`,
                },
              ]
            : []),
          {
            value: 'set',
            label:
              'set: Install the whole reference set (tokens:tailwind) as another design system',
          },
          {
            value: 'continue',
            label: 'continue: Write the components as they are and fix the tokens yourself',
          },
          { value: 'cancel', label: 'cancel: Change nothing' },
        ])
        if (choice === 'cancel') {
          io.out('Cancelled. Nothing was changed.')
          return 1
        }
        if (choice === 'add' || choice === 'set') fix = choice
      } else if (!fix) {
        io.out(
          `To make them fit: --fit add puts the missing tokens in ${FIT_FILE} in each system; --map from=to rewrites the component to use a token you have; --fit set installs the whole reference set (tokens:tailwind) as another design system.`,
        )
      }
    }
  }
  if (fix === 'set' && !queued.has('tokens:tailwind')) {
    const folder = join(root, 'system', 'tailwind', 'tokens')
    if (existsSync(folder) && readdirSync(folder).length)
      io.out(
        'system/tailwind/tokens is already there, so the reference set was not installed again.',
      )
    else await plan('tokens:tailwind', false)
  }

  // Shared files already there with other content would be overwritten without the person choosing it.
  const written: string[] = []
  const skipped: string[] = []
  const lock = readLock(root)
  for (const step of steps) {
    for (const file of step.files) {
      const path = join(root, step.dir, file.path)
      const shown = join(step.dir, file.path).replaceAll('\\', '/')
      if (existsSync(path)) {
        if (readFileSync(path, 'utf8') === file.content) {
          skipped.push(shown)
          continue
        }
        const own =
          file.path === `${step.as}.tess` ||
          file.path === `${step.as}.docs.md` ||
          step.item.type === 'tokens'
        if (!(own && step.action === 'replace')) {
          throw new CliError(
            `${shown} already exists with different content, and is not part of what you asked to replace.`,
            'Move it, or add under another name with --as.',
          )
        }
      }
    }
  }
  for (const step of steps) {
    for (const file of step.files) {
      const path = join(root, step.dir, file.path)
      const shown = join(step.dir, file.path).replaceAll('\\', '/')
      if (skipped.includes(shown)) continue
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, file.content)
      written.push(shown)
    }
    lock.items[step.as] = {
      item: step.item.name,
      registry: portable(root, source.label),
      sha256: checksum(step.files),
      files: step.files.map((f) => f.path).sort(),
    }
  }
  lock.items = Object.fromEntries(Object.entries(lock.items).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(join(root, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n')

  for (const w of written) io.out(ui ? `  ${ui.green(ui.sym.ok)} ${w}` : `Wrote ${w}`)
  for (const s of skipped)
    io.out(
      ui ? `  ${ui.dim(`${ui.sym.bullet} ${s} (already the same)`)}` : `Already the same: ${s}`,
    )
  for (const k of kept)
    io.out(`Kept your ${k}: a component it needs, which this project already has.`)

  // npm packages: the ones the project lacks.
  const manifestPath = join(root, 'package.json')
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >)
    : {}
  const owned = (pkg: string) =>
    ['dependencies', 'devDependencies', 'peerDependencies'].some(
      (f) => manifest[f]?.[pkg] !== undefined,
    )
  const needed = Object.fromEntries(
    steps.flatMap((s) => Object.entries(s.item.npm ?? {})).filter(([pkg]) => !owned(pkg)),
  )
  const install = Object.entries(needed).map(([pkg, range]) => `${pkg}@${range}`)
  if (install.length) {
    if (has(args, 'install')) {
      io.out(`Installing ${install.join(', ')}...`)
      execFileSync('npm', ['install', ...install], {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      })
    } else {
      io.out('')
      io.out(
        `It needs ${install.length === 1 ? 'a package' : 'packages'} your project does not have. Install with:`,
      )
      io.out(`  npm install ${install.join(' ')}`)
    }
  }

  if (fix === 'add') {
    for (const fit of fits) {
      if (!fit.missing.length) continue
      const result = addMissingTokens(root, fit)
      if (result.added.length)
        io.out(
          `Added ${result.added.length} ${result.added.length === 1 ? 'token' : 'tokens'} to ${fit.name}: ${result.files.join(', ')}`,
        )
      if (result.unknown.length)
        io.out(
          `Not added, because the reference set does not define them: ${result.unknown.join(', ')}`,
        )
    }
  }

  const tokenSets = steps.filter((s) => s.item.type === 'tokens')
  for (const set of tokenSets) {
    const name = set.as
    io.out('')
    io.out(`Add the design system to tessera.config.ts so the app and the docs can use it:`)
    io.out(
      `  systems: [..., { name: '${name[0]!.toUpperCase()}${name.slice(1)}', path: '/${name}' }]`,
    )
  }
  if (componentSteps.length) {
    io.out('')
    project.resetAll()
    // The next AI session reads AGENTS.md, so it must list what was just added; a file the person wrote is left alone.
    try {
      const updated = refreshAgentFiles(project)
      if (updated.length)
        io.out(`Updated ${updated.join(' and ')}, so they list the new components.`)
    } catch {
      // A project that cannot build its manifest right now has the checks below to say why.
    }
    if (project.tokensDir()) {
      const names = componentSteps.map((s) => s.as)
      const report = checkProject(project)
      const mine = new Set(
        written.filter((w) => w.endsWith('.tess')).map((w) => w.replace(/^.*\//, '')),
      )
      const diagnostics = report.files
        .filter((f) => mine.has(f.file.replace(/^.*\//, '')))
        .flatMap((f) => f.diagnostics)
      const errors = diagnostics.filter((d) => d.severity === 'error').length
      const warnings = diagnostics.filter((d) => d.severity === 'warning').length
      for (const message of report.messages) io.out(message)
      if (!diagnostics.length) io.out(`Checked ${names.join(', ')}: no problems.`)
      else {
        io.out(
          `Checked ${names.join(', ')}: ${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}.`,
        )
        for (const d of diagnostics) io.out(formatDiagnostic(d))
      }
      io.out(
        existsSync(join(root, 'system', 'components', 'a11y.browser.test.ts'))
          ? 'Accessibility: npm run test:a11y runs the generated tests on them, in each design system the tests were set up for.'
          : 'Accessibility: npx @pixelscriptio/tessera a11y --system all sets up the generated tests, which then cover these components in every design system.',
      )
    } else {
      io.out(
        'Next: npm run check    (it reports any token the new component needs that your design system lacks)',
      )
    }
  }
  return 0
}
