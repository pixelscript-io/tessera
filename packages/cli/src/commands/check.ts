import { readFileSync, writeFileSync } from 'node:fs'
import { applyFixes, formatDiagnostic } from '@tessera/compiler'
import type { Args } from '../args'
import { has } from '../args'
import { checkProject, countBy, type ProjectReport } from '../check-project'
import type { Io } from '../io'
import { openProject } from '../project'
import type { Ui } from '../ui'

const MAX_FIX_PASSES = 5

/** `tessera check`: run every validation. Exit 1 on errors, so CI fails. `--fix` applies unambiguous fixes first. */
export async function check(args: Args, io: Io): Promise<number> {
  const project = await openProject(io.cwd, args)
  let fixed = 0
  if (has(args, 'fix')) {
    // A fix can reveal the next problem, so run again until nothing more applies.
    for (let pass = 0; pass < MAX_FIX_PASSES; pass++) {
      const report = checkProject(project)
      let applied = 0
      for (const f of report.files) {
        if (!f.checked || !f.diagnostics.some((d) => d.fix)) continue
        const path = `${project.root}/${f.file}`
        const result = applyFixes(readFileSync(path, 'utf8'), f.diagnostics)
        if (result.applied > 0) {
          writeFileSync(path, result.source)
          applied += result.applied
        }
      }
      fixed += applied
      if (applied === 0) break
      project.resetAll()
    }
  }

  const started = performance.now()
  const report = checkProject(project)
  const seconds = (performance.now() - started) / 1000
  const errors = countBy(report, 'error') + report.messages.length
  const warnings = countBy(report, 'warning')

  if (has(args, 'json')) {
    io.out(JSON.stringify(toJson(report, fixed), null, 2))
    return errors > 0 ? 1 : 0
  }

  if (io.ui) {
    printPretty(io, io.ui, report, project.root, { fixed, errors, warnings, seconds })
    return errors > 0 ? 1 : 0
  }

  for (const message of report.messages) io.out(message + '\n')
  for (const f of report.files) {
    for (const d of f.diagnostics) io.out(formatDiagnostic(d) + '\n')
  }
  const suppressed = report.files.reduce((n, f) => n + (f.checked?.baseline.suppressed ?? 0), 0)
  const improved = report.files.reduce((n, f) => n + (f.checked?.baseline.improved.length ?? 0), 0)

  if (fixed) io.out(`Fixed ${fixed} ${fixed === 1 ? 'problem' : 'problems'}.`)
  io.out(
    `${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'} in ${report.files.length} files.`,
  )
  if (suppressed) io.out(`${suppressed} existing violations are covered by the baseline.`)
  if (improved) io.out('The baseline can be lowered: run `tessera baseline --prune`.')
  return errors > 0 ? 1 : 0
}

function toJson(report: ProjectReport, fixed: number) {
  return {
    errors: countBy(report, 'error') + report.messages.length,
    warnings: countBy(report, 'warning'),
    fixed,
    messages: report.messages,
    files: report.files
      .filter((f) => f.diagnostics.length)
      .map((f) => ({
        file: f.file,
        diagnostics: f.diagnostics.map((d) => ({ ...d, fix: undefined })),
      })),
  }
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The line a diagnostic is on, with the line before it and a caret under the column. */
export function frame(ui: Ui, source: string | undefined, line: number, column: number): string[] {
  if (source === undefined || line < 1) return []
  const lines = source.split(/\r?\n/)
  if (lines[line - 1] === undefined) return []
  const from = Math.max(1, line - 1)
  const gutter = String(line).length
  const out: string[] = []
  for (let n = from; n <= line; n++) {
    const text = lines[n - 1]!.replace(/\t/g, '  ')
    out.push(`      ${ui.gray(String(n).padStart(gutter))} ${ui.gray(ui.sym.bar)} ${text}`)
  }
  const pointer = ' '.repeat(Math.max(0, column - 1)) + '^'
  out.push(`      ${' '.repeat(gutter)} ${ui.gray(ui.sym.bar)} ${ui.red(pointer)}`)
  return out
}

/** The report as a person reads it: files with their problems, then one line saying how it went. */
function printPretty(
  io: Io,
  ui: Ui,
  report: ProjectReport,
  root: string,
  totals: { fixed: number; errors: number; warnings: number; seconds: number },
): void {
  const codes = new Set<string>()
  for (const message of report.messages) {
    const [first, ...rest] = message.split('\n')
    io.out(ui.fail(ui.bold(first!)))
    for (const line of rest) io.out(`  ${ui.dim(line.trim())}`)
    io.out('')
  }
  for (const f of report.files) {
    if (!f.diagnostics.length) continue
    let source: string | undefined
    try {
      source = readFileSync(`${root}/${f.file}`, 'utf8')
    } catch {
      source = undefined
    }
    io.out(`${ui.underline(ui.bold(f.file))} ${ui.dim(`(${f.diagnostics.length})`)}`)
    for (const d of f.diagnostics) {
      codes.add(d.code)
      const paint = d.severity === 'error' ? ui.red : ui.yellow
      const mark = d.severity === 'error' ? ui.sym.fail : ui.sym.warn
      io.out(
        `  ${paint(mark)} ${paint(ui.bold(d.code))}  ${ui.dim(`${d.line}:${d.column}`)}  ${d.message}`,
      )
      for (const line of frame(ui, source, d.line, d.column)) io.out(line)
      if (d.hint) io.out(`      ${ui.cyan(ui.sym.arrow)} ${d.hint}`)
      io.out('')
    }
  }
  const suppressed = report.files.reduce((n, f) => n + (f.checked?.baseline.suppressed ?? 0), 0)
  const improved = report.files.reduce((n, f) => n + (f.checked?.baseline.improved.length ?? 0), 0)
  const seconds = totals.seconds < 10 ? totals.seconds.toFixed(2) : totals.seconds.toFixed(1)
  const time = ui.dim(`(${seconds}s)`)
  if (totals.fixed) io.out(ui.ok(`Fixed ${plural(totals.fixed, 'problem')}.`))
  if (totals.errors === 0 && totals.warnings === 0) {
    io.out(`${ui.ok(ui.bold(`No problems in ${plural(report.files.length, 'file')}`))} ${time}`)
  } else {
    const counts = `${plural(totals.errors, 'error')}, ${plural(totals.warnings, 'warning')}`
    const head = totals.errors > 0 ? ui.fail(ui.bold(counts)) : ui.warn(ui.bold(counts))
    io.out(`${head} ${ui.dim(`in ${plural(report.files.length, 'file')}`)} ${time}`)
  }
  if (suppressed)
    io.out(ui.dim(`${plural(suppressed, 'existing violation')} covered by the baseline.`))
  if (improved) io.out(ui.dim('The baseline can be lowered: run `tessera baseline --prune`.'))
  if (codes.size)
    io.out(ui.dim(`Learn more about a code: ${ui.bold(`tessera explain ${[...codes][0]}`)}`))
}
