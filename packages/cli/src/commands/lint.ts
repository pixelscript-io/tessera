import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import {
  applyBaseline,
  applyFixes,
  applySeverity,
  createBaseline,
  formatDiagnostic,
  lintKind,
  lintSource,
  pruneBaseline,
  StyleTokens,
  type Baseline,
  type CompilerDiagnostic,
  type TesseraConfig,
} from '@tessera/compiler'
import { loadConfigFile } from '@tessera/compiler/project'
import { buildTokens, formatDiagnostic as formatTokenDiagnostic } from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import type { Args } from '../args'
import { flag, has } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import type { Ui } from '../ui'
import { frame, plural } from './check'

const forward = (path: string) => path.replaceAll('\\', '/')

/** Folders no project keeps its own styles in. */
const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.tessera',
  '.vite',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
])

const MAX_FIX_PASSES = 5
const BASELINE_FILE = 'tessera.lint-baseline.json'

/** The project to lint: `--root`, else the nearest folder above this one that has a Tessera config or a package.json. */
function lintRoot(cwd: string, args: Args): string {
  const given = flag(args, 'root')
  if (typeof given === 'string') return resolve(cwd, given)
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (
      ['tessera.config.ts', 'tessera.config.mjs', 'tessera.config.js', 'package.json'].some((n) =>
        existsSync(join(dir, n)),
      )
    )
      return dir
    if (dirname(dir) === dir) return cwd
  }
}

/** Every file with styles under these paths: a file is itself, a folder is searched. */
function collect(root: string, paths: string[]): { files: string[]; unsupported: string[] } {
  const files: string[] = []
  const unsupported: string[] = []
  const visit = (path: string) => {
    const info = statSync(path)
    if (info.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (SKIP.has(name) || (name.startsWith('.') && name !== '.')) continue
        visit(join(path, name))
      }
    } else {
      const kind = lintKind(path)
      if (kind === 'css' || kind === 'markup') files.push(forward(path))
      else if (kind === 'unsupported') unsupported.push(forward(path))
    }
  }
  for (const p of paths) {
    const abs = resolve(root, p)
    if (!existsSync(abs)) throw new CliError(`There is no file or folder "${p}".`)
    visit(abs)
  }
  return { files, unsupported }
}

/** The design tokens: a folder given, the project's configured one, or `system/tokens`. */
function loadTokens(root: string, given: string | undefined, configured: string | undefined) {
  const dir = given
    ? resolve(root, given)
    : (configured ??
      (existsSync(join(root, 'system', 'tokens')) ? join(root, 'system', 'tokens') : undefined))
  if (!dir || !existsSync(dir)) {
    throw new CliError(
      'There are no design tokens to check against.',
      'Pass --tokens <folder> with DTCG token files, or put them in system/tokens (see `tessera tokens import`).',
    )
  }
  const built = buildTokens(loadTokenDir(dir))
  if (!built.manifest) {
    throw new CliError(
      `The design tokens in ${forward(relative(root, dir)) || '.'} do not build.`,
      built.diagnostics.map(formatTokenDiagnostic).join('\n\n'),
    )
  }
  return StyleTokens.fromManifest(built.manifest)
}

interface Linted {
  file: string
  /** What is left after severity and the baseline. */
  diagnostics: CompilerDiagnostic[]
  /** After severity, before the baseline: what a baseline would record. */
  adjusted: CompilerDiagnostic[]
  suppressed: number
  improved: number
}

/**
 * `tessera lint`: the style rules of `tessera check`, on the CSS of any project. It reads `.css` files and the `<style>`
 * of `.vue`, `.svelte`, `.astro` and `.html` files, with design tokens as custom properties (`var(--t-space-4)`), and
 * checks raw values off the token scale, colors that are not tokens, `var()` names that are not tokens, tokens of the
 * wrong kind, primitives used directly and contrast. Per-path severity, expiring exemptions, `--fix` and a baseline
 * work as they do for `.tess` files.
 */
export async function lint(args: Args, io: Io): Promise<number> {
  const root = lintRoot(io.cwd, args)
  const loaded = await loadConfigFile(root)
  const config: TesseraConfig = loaded?.config ?? {}
  const today = loaded?.options.today ?? new Date().toISOString().slice(0, 10)
  const given = flag(args, 'tokens')
  const prefix = flag(args, 'var-prefix')
  if (typeof prefix === 'string' && !/^--[\w-]*$/.test(prefix)) {
    throw new CliError(
      `"${prefix}" is not a custom property prefix.`,
      'Use something like --var-prefix --ds- (two hyphens, then letters).',
    )
  }
  const tokens = loadTokens(
    root,
    typeof given === 'string' ? given : undefined,
    loaded?.options.tokens,
  )
  const varPrefix = typeof prefix === 'string' ? prefix : undefined

  const targets = args.positional.length ? args.positional : ['.']
  const { files, unsupported } = collect(root, targets)
  const display = (abs: string) => forward(relative(root, abs))

  const baselinePath = join(root, BASELINE_FILE)
  const baseline: Baseline | undefined = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline)
    : undefined

  const run = (useBaseline: boolean): Linted[] =>
    files.map((abs) => {
      const file = display(abs)
      const source = readFileSync(abs, 'utf8')
      const { diagnostics } = lintSource(file, source, {
        tokens,
        config,
        today,
        ...(varPrefix ? { varPrefix } : {}),
      })
      const adjusted = applySeverity(file, diagnostics, config, today)
      const held = applyBaseline(file, adjusted, useBaseline ? baseline : undefined)
      return {
        file,
        diagnostics: held.diagnostics,
        adjusted,
        suppressed: held.suppressed,
        improved: held.improved.length,
      }
    })

  // Recording or lowering the baseline measures against no baseline, but with severity.
  if (has(args, 'baseline') || has(args, 'prune')) {
    const results = run(false)
    const rows = results.map((r) => ({ file: r.file, diagnostics: r.adjusted }))
    let out: Baseline
    if (has(args, 'prune')) {
      if (!baseline)
        throw new CliError(
          'There is no lint baseline to prune.',
          'Run `tessera lint --baseline` first.',
        )
      out = pruneBaseline(baseline, rows)
    } else out = createBaseline(rows)
    const sorted: Baseline = {
      version: 1,
      files: Object.fromEntries(
        Object.entries(out.files)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([f, codes]) => [f, Object.fromEntries(Object.entries(codes).sort())]),
      ),
    }
    writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n')
    const count = Object.values(sorted.files).reduce(
      (n, codes) => n + Object.values(codes).reduce((a, c) => a + c, 0),
      0,
    )
    const message = has(args, 'prune')
      ? `Lowered the lint baseline to ${plural(count, 'violation')} in ${BASELINE_FILE}.`
      : `Recorded ${plural(count, 'existing violation')} in ${plural(Object.keys(sorted.files).length, 'file')} in ${BASELINE_FILE}.`
    io.out(io.ui ? io.ui.ok(message) : message)
    io.out(
      io.ui
        ? io.ui.dim(
            'Commit it. From now on `tessera lint` fails only on violations beyond these counts.',
          )
        : 'Commit it. From now on `tessera lint` fails only on violations beyond these counts.',
    )
    return 0
  }

  let fixed = 0
  if (has(args, 'fix')) {
    for (let pass = 0; pass < MAX_FIX_PASSES; pass++) {
      let applied = 0
      for (const r of run(false)) {
        if (!r.adjusted.some((d) => d.fix)) continue
        const abs = join(root, r.file)
        const result = applyFixes(readFileSync(abs, 'utf8'), r.adjusted)
        if (result.applied > 0) {
          writeFileSync(abs, result.source)
          applied += result.applied
        }
      }
      fixed += applied
      if (applied === 0) break
    }
  }

  const results = run(true)
  const withProblems = results.filter((r) => r.diagnostics.length)
  const errors = results.reduce(
    (n, r) => n + r.diagnostics.filter((d) => d.severity === 'error').length,
    0,
  )
  const warnings = results.reduce(
    (n, r) => n + r.diagnostics.filter((d) => d.severity === 'warning').length,
    0,
  )
  const suppressed = results.reduce((n, r) => n + r.suppressed, 0)
  const improved = results.reduce((n, r) => n + r.improved, 0)

  if (has(args, 'json')) {
    io.out(
      JSON.stringify(
        {
          errors,
          warnings,
          fixed,
          files: withProblems.map((r) => ({
            file: r.file,
            diagnostics: r.diagnostics.map((d) => ({ ...d, fix: undefined })),
          })),
        },
        null,
        2,
      ),
    )
    return errors > 0 ? 1 : 0
  }

  const note = unsupported.length
    ? `${plural(unsupported.length, 'Sass, Less or Stylus file')} not read: they are not plain CSS.`
    : ''
  if (io.ui) {
    printPretty(io, io.ui, root, withProblems, {
      files: results.length,
      errors,
      warnings,
      fixed,
      suppressed,
      improved,
      note,
    })
  } else {
    for (const r of withProblems) for (const d of r.diagnostics) io.out(formatDiagnostic(d) + '\n')
    if (fixed) io.out(`Fixed ${plural(fixed, 'problem')}.`)
    io.out(
      `${plural(errors, 'error')}, ${plural(warnings, 'warning')} in ${plural(results.length, 'file')}.`,
    )
    if (suppressed)
      io.out(`${plural(suppressed, 'existing violation')} covered by the lint baseline.`)
    if (improved) io.out('The baseline can be lowered: run `tessera lint --prune`.')
    if (note) io.out(note)
  }
  return errors > 0 ? 1 : 0
}

function printPretty(
  io: Io,
  ui: Ui,
  root: string,
  withProblems: Linted[],
  totals: {
    files: number
    errors: number
    warnings: number
    fixed: number
    suppressed: number
    improved: number
    note: string
  },
): void {
  const codes = new Set<string>()
  for (const r of withProblems) {
    let source: string | undefined
    try {
      source = readFileSync(join(root, r.file), 'utf8')
    } catch {
      source = undefined
    }
    io.out(`${ui.underline(ui.bold(r.file))} ${ui.dim(`(${r.diagnostics.length})`)}`)
    for (const d of r.diagnostics) {
      codes.add(d.code)
      const paint = d.severity === 'error' ? ui.red : ui.yellow
      const mark = d.severity === 'error' ? ui.sym.fail : ui.sym.warn
      io.out(
        `  ${paint(mark)} ${paint(ui.bold(d.code))}  ${ui.dim(`${d.line}:${d.column}`)}  ${d.message}`,
      )
      for (const line of frame(ui, source, d.line, d.column)) io.out(line)
      if (d.hint) io.out(`      ${ui.cyan(ui.sym.arrow)} ${d.hint}`)
      if (d.fix) io.out(`      ${ui.dim('fixable with --fix')}`)
      io.out('')
    }
  }
  if (totals.fixed) io.out(ui.ok(`Fixed ${plural(totals.fixed, 'problem')}.`))
  if (totals.errors === 0 && totals.warnings === 0) {
    io.out(ui.ok(ui.bold(`No problems in ${plural(totals.files, 'file')}`)))
  } else {
    const counts = `${plural(totals.errors, 'error')}, ${plural(totals.warnings, 'warning')}`
    io.out(
      `${totals.errors > 0 ? ui.fail(ui.bold(counts)) : ui.warn(ui.bold(counts))} ${ui.dim(`in ${plural(totals.files, 'file')}`)}`,
    )
  }
  if (totals.suppressed)
    io.out(
      ui.dim(`${plural(totals.suppressed, 'existing violation')} covered by the lint baseline.`),
    )
  if (totals.improved) io.out(ui.dim('The baseline can be lowered: run `tessera lint --prune`.'))
  if (totals.note) io.out(ui.dim(totals.note))
  if (codes.size)
    io.out(ui.dim(`Learn more about a code: ${ui.bold(`tessera explain ${[...codes][0]}`)}`))
}
