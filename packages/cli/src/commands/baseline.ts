import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createBaseline, pruneBaseline, type Baseline } from '@tessera/compiler'
import type { Args } from '../args'
import { has } from '../args'
import { checkProject } from '../check-project'
import type { Io } from '../io'
import { CliError } from '../io'
import { openProject } from '../project'

const sorted = (b: Baseline): Baseline => ({
  version: 1,
  files: Object.fromEntries(
    Object.entries(b.files)
      .sort(([a], [z]) => a.localeCompare(z))
      .map(([file, codes]) => [file, Object.fromEntries(Object.entries(codes).sort())]),
  ),
})

const write = (path: string, baseline: Baseline) =>
  writeFileSync(path, JSON.stringify(sorted(baseline), null, 2) + '\n')

export const totalViolations = (b: Baseline): number =>
  Object.values(b.files).reduce(
    (n, codes) => n + Object.values(codes).reduce((a, c) => a + c, 0),
    0,
  )

/**
 * `tessera baseline` records today's violations so existing code can adopt Tessera with errors on: `check`
 * and builds then fail only on violations beyond the recorded counts. `--prune` lowers the counts to what
 * files have now and never raises them.
 */
export async function baseline(args: Args, io: Io): Promise<number> {
  const project = await openProject(io.cwd, args)
  const path = project.baselinePath()
  // Measure against no baseline, but with severity: an exempted path has no violations to record.
  const report = checkProject(project, { baseline: null })
  const results = report.files
    .filter((f) => f.checked)
    .map((f) => ({ file: f.file, diagnostics: f.checked!.adjusted }))

  if (has(args, 'prune')) {
    if (!existsSync(path)) {
      throw new CliError('There is no baseline to prune.', 'Run `tessera baseline` first.')
    }
    const before = JSON.parse(readFileSync(path, 'utf8')) as Baseline
    const pruned = pruneBaseline(before, results)
    write(path, pruned)
    const message = `Pruned the baseline from ${totalViolations(before)} to ${totalViolations(pruned)} violations.`
    io.out(io.ui ? io.ui.ok(message) : message)
    return 0
  }

  const created = createBaseline(results)
  write(path, created)
  const count = totalViolations(created)
  const recorded = `Recorded ${count} existing ${count === 1 ? 'violation' : 'violations'} in ${Object.keys(created.files).length} files in ${project.display(path)}.`
  const advice =
    'Commit it. From now on `tessera check` and builds fail only on violations beyond these counts.'
  io.out(io.ui ? io.ui.ok(recorded) : recorded)
  io.out(io.ui ? io.ui.dim(advice) : advice)
  return 0
}
