import { readFileSync, writeFileSync } from 'node:fs'
import { applyFixes, formatDiagnostic } from '@tessera/compiler'
import type { Args } from '../args'
import { has } from '../args'
import { checkProject, countBy, type ProjectReport } from '../check-project'
import type { Io } from '../io'
import { openProject } from '../project'

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

  const report = checkProject(project)
  const errors = countBy(report, 'error') + report.messages.length
  const warnings = countBy(report, 'warning')

  if (has(args, 'json')) {
    io.out(JSON.stringify(toJson(report, fixed), null, 2))
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
