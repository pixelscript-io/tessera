import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  buildTokens,
  detectFormat,
  exportTokens,
  formatDiagnostic,
  importTokens,
  resolverRefs,
  type InterchangeFile,
  type InterchangeFormat,
  type TokenDiagnostic,
} from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import type { Args } from '../args'
import { flag, has } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import { figmaTokenFromEnv, isFigmaLink, tokensFromFigma } from '../figma-styles'
import { openProject } from '../project'

const FORMATS = ['dtcg', 'tokens-studio']

/** The project's tokens folder, or where one would go: a project is not needed to import into a fresh folder. */
async function tokensFolder(io: Io, args: Args): Promise<{ dir: string; root: string }> {
  try {
    const project = await openProject(io.cwd, args)
    return {
      dir: project.tokensDirOrDefault(),
      root: project.root,
    }
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    const root = resolve(
      io.cwd,
      typeof flag(args, 'root') === 'string' ? String(flag(args, 'root')) : '.',
    )
    return { dir: join(root, 'system', 'tokens'), root }
  }
}

const forward = (p: string) => p.replaceAll('\\', '/')

/** What the styles of a Figma file made, as the report says it for one. */
const SINGULAR: Record<string, string> = {
  colors: 'color',
  shadows: 'shadow',
  blurs: 'blur',
  'text styles': 'text style',
  'font families': 'font family',
}

/** Every `.json` file under a path, as paths relative to the working folder (a Resolver names its files relatively). */
function readInputs(io: Io, inputs: string[]): InterchangeFile[] {
  const out: InterchangeFile[] = []
  const add = (abs: string) => {
    out.push({ path: forward(relative(io.cwd, abs)), content: readFileSync(abs, 'utf8') })
    // A Resolver document names the files it combines: read those too.
    for (const ref of resolverRefs(out[out.length - 1]!.content)) {
      const target = resolve(dirname(abs), ref)
      // Only files in the Resolver's own folder (or below it): a downloaded export must not be able to read others.
      // A reference that points elsewhere is left out, and the importer reports the file as missing (T1017).
      const inside = relative(dirname(abs), target)
      if (/^\.\.([\\/]|$)/.test(inside) || isAbsolute(inside)) continue
      if (existsSync(target) && !out.some((f) => resolve(io.cwd, f.path) === target)) add(target)
    }
  }
  const walk = (abs: string) => {
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        if (name === 'node_modules') continue
        const child = join(abs, name)
        if (statSync(child).isDirectory() || name.endsWith('.json')) walk(child)
      }
    } else if (!out.some((f) => resolve(io.cwd, f.path) === abs)) add(abs)
  }
  for (const input of inputs) {
    const abs = resolve(io.cwd, input)
    if (!existsSync(abs)) throw new CliError(`There is no file or folder "${input}".`)
    walk(abs)
  }
  return out
}

function formatOf(args: Args, files?: InterchangeFile[]): InterchangeFormat {
  const given = flag(args, 'format')
  if (given === undefined && files) return detectFormat(files)
  if (given === undefined) return 'dtcg'
  if (typeof given !== 'string' || !FORMATS.includes(given)) {
    throw new CliError(`Unknown format "${String(given)}".`, `Formats: ${FORMATS.join(', ')}.`)
  }
  return given as InterchangeFormat
}

const lines = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * `tessera tokens build | import | export`. `build` resolves the design tokens and writes what other tools read.
 * `import` reads tokens from DTCG, a DTCG Resolver document, or Tokens Studio and Penpot files into token files.
 * `export` writes them the other way.
 */
export async function tokens(args: Args, io: Io): Promise<number> {
  const [sub, ...rest] = args.positional
  if (sub === 'import') return importCommand(args, rest, io)
  if (sub === 'export') return exportCommand(args, io)
  if (sub !== 'build') {
    throw new CliError(
      sub ? `Unknown tokens command "${sub}".` : 'Say what to do with the tokens.',
      'Available: tessera tokens build | import <file...> | export',
    )
  }
  const project = await openProject(io.cwd, args)
  const dir = project.tokensDir()
  if (!dir) {
    throw new CliError(
      'No design tokens found.',
      'Put *.tokens.json files in a "system/tokens" folder, or set "tokens" in tessera.config.ts.',
    )
  }
  const result = buildTokens(loadTokenDir(dir))
  if (!result.ok) {
    io.err(result.diagnostics.map(formatDiagnostic).join('\n\n'))
    return 1
  }
  const given = flag(args, 'out')
  const out =
    typeof given === 'string' ? resolve(io.cwd, given) : join(project.root, '.tessera', 'tokens')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'tokens.css'), result.css)
  writeFileSync(join(out, 'tokens.d.ts'), result.dts)
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n')
  const count = result.manifest!.tokens.length
  io.out(
    `Built ${count} tokens into ${project.display(out) || '.'}: tokens.css, tokens.d.ts, manifest.json.`,
  )
  return 0
}

async function importCommand(args: Args, inputs: string[], io: Io): Promise<number> {
  if (!inputs.length) {
    throw new CliError(
      'Say which file or folder to import.',
      'tessera tokens import tokens.resolver.json   (or a Tokens Studio export, a DTCG file, or a link to a Figma page)',
    )
  }
  // A link to a page or frame of a Figma file is read through its API: the styles under it become one DTCG file.
  const links = inputs.filter(isFigmaLink)
  const files = readInputs(
    io,
    inputs.filter((i) => !isFigmaLink(i)),
  )
  const notes: TokenDiagnostic[] = []
  if (links.length) {
    const made = await tokensFromFigma(links, figmaTokenFromEnv())
    files.push(made.file)
    notes.push(...made.diagnostics)
    io.out(
      `Read the styles under ${lines(links.length, 'Figma link')}: ${
        Object.entries(made.counts)
          .map(([kind, n]) => `${n} ${n === 1 ? (SINGULAR[kind] ?? kind) : kind}`)
          .join(', ') || 'nothing that can be a token'
      }.`,
    )
  }
  const result = importTokens(files, flag(args, 'format') === undefined ? 'auto' : formatOf(args))
  result.diagnostics.unshift(...notes)
  for (const d of result.diagnostics)
    (d.severity === 'error' ? io.err : io.out)(formatDiagnostic(d) + '\n')
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length
  if (errors) {
    io.err(`Nothing was written: the import has ${lines(errors, 'error')}.`)
    return 1
  }

  const given = flag(args, 'out')
  const out =
    typeof given === 'string' ? resolve(io.cwd, given) : (await tokensFolder(io, args)).dir
  const targets = [
    ...result.base.map((f) => ({ path: join(out, f.path), content: f.content })),
    ...result.themes.map((f) => ({ path: join(out, f.path), content: f.content })),
  ]
  const existing = targets.filter((t) => existsSync(t.path))
  if (existing.length && !has(args, 'force')) {
    throw new CliError(
      `Not importing: ${existing.map((t) => forward(relative(io.cwd, t.path))).join(', ')} already ${existing.length === 1 ? 'exists' : 'exist'}.`,
      'Import into a new folder with --out <folder>, or replace the files with --force.',
    )
  }
  for (const t of targets) {
    mkdirSync(dirname(t.path), { recursive: true })
    writeFileSync(t.path, t.content)
  }
  const warnings = result.diagnostics.length
  io.out(
    `Imported ${lines(result.base.length, 'token file')} and ${lines(result.themes.length, 'theme')} into ${forward(relative(io.cwd, out)) || '.'}` +
      (warnings ? `, with ${lines(warnings, 'note')} above.` : '.'),
  )
  return 0
}

async function exportCommand(args: Args, io: Io): Promise<number> {
  const project = await openProject(io.cwd, args)
  const dir = project.tokensDir()
  if (!dir) {
    throw new CliError(
      'No design tokens found.',
      'Put *.tokens.json files in a "system/tokens" folder, or set "tokens" in tessera.config.ts.',
    )
  }
  const format = formatOf(args)
  const result = exportTokens(loadTokenDir(dir), format)
  if (result.diagnostics.some((d) => d.severity === 'error')) {
    io.err(result.diagnostics.map(formatDiagnostic).join('\n\n'))
    return 1
  }
  for (const d of result.diagnostics) io.out(formatDiagnostic(d) + '\n')
  const given = flag(args, 'out')
  const out =
    typeof given === 'string'
      ? resolve(io.cwd, given)
      : join(project.root, '.tessera', 'export', format)
  for (const f of result.files) {
    mkdirSync(dirname(join(out, f.path)), { recursive: true })
    writeFileSync(join(out, f.path), f.content)
  }
  io.out(
    `Exported ${lines(result.files.length, 'file')} as ${format === 'dtcg' ? 'DTCG 2025.10 with a Resolver document' : 'Tokens Studio sets'} into ${project.display(out) || '.'}.`,
  )
  return 0
}
