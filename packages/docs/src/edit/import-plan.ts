import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Project } from '@tessera/compiler/project'
import {
  formatDiagnostic,
  importTokens,
  type InterchangeFile,
  type InterchangeFormat,
} from '@tessera/tokens'
import { finishPlan, PlanError, sha, type Plan, type PlanFile, type PlanProblem } from './plan'

const forward = (p: string) => p.replaceAll('\\', '/')

/** Every `*.tokens.json` under a folder, absolute with forward slashes. */
function tokenFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? tokenFiles(join(dir, e.name))
        : e.name.endsWith('.tokens.json')
          ? [forward(join(dir, e.name))]
          : [],
    )
  } catch {
    return []
  }
}

/** The same tokens, whatever the layout of the file: a file the import only reformats is not a change. */
function sameTokens(a: string, b: string): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b))
  } catch {
    return a === b
  }
}

const SUMMARY = 'Bring in the token export'

const empty = (blocking: PlanProblem[], notes: string[]): Plan => ({
  id: randomUUID(),
  summary: SUMMARY,
  files: [],
  blocking,
  notes,
  changes: [],
})

/**
 * Plan bringing a token export in: what `tessera tokens import` would write, what it would skip, and what it
 * would do to the project. The import replaces the token set, so token files it does not produce are listed as
 * deletions. Tokens themselves are edited in the design tool; this is how a new export arrives.
 */
export function planTokenImport(
  project: Project,
  files: InterchangeFile[],
  format: InterchangeFormat | 'auto' = 'auto',
): Plan {
  if (!files.length) throw new PlanError('Choose the files of a token export first.')
  const result = importTokens(files, format)
  const notes = result.diagnostics
    .filter((d) => d.severity === 'warning')
    .map((d) => formatDiagnostic(d))
  const errors: PlanProblem[] = result.diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => ({
      code: d.code,
      file: d.file ?? '',
      message: d.message + (d.path ? ` (${d.path})` : ''),
      ...(d.hint ? { hint: d.hint } : {}),
    }))
  // The import itself failed: nothing to compare, and nothing can be saved.
  if (errors.length) return empty(errors, notes)

  const dir = forward(project.tokensDirOrDefault())
  const produced = [...result.base, ...result.themes].map((f) => ({
    abs: `${dir}/${forward(f.path)}`,
    text: f.content,
  }))
  const planFiles: PlanFile[] = []
  for (const f of produced) {
    let before: string | null = null
    try {
      before = readFileSync(f.abs, 'utf8')
    } catch {
      /* a new file */
    }
    if (before === null || !sameTokens(before, f.text)) {
      planFiles.push({
        file: project.display(f.abs),
        abs: f.abs,
        before,
        after: f.text,
        hash: before === null ? null : sha(before),
      })
    }
  }
  const keep = new Set(produced.map((f) => f.abs))
  for (const abs of tokenFiles(dir)) {
    if (keep.has(abs)) continue
    const before = readFileSync(abs, 'utf8')
    planFiles.push({ file: project.display(abs), abs, before, after: null, hash: sha(before) })
  }
  if (!planFiles.length) {
    return empty([], [...notes, 'Nothing would change: the project already has these tokens.'])
  }

  // The project as it would be: the new token set in a scratch folder, and the same components.
  const scratch = mkdtempSync(join(tmpdir(), 'tessera-import-'))
  try {
    for (const f of produced) {
      const path = join(scratch, f.abs.slice(dir.length + 1))
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, f.text)
    }
    const after = new Project(project.root, { ...project.options, tokens: scratch })
    const plan = finishPlan(project, { summary: SUMMARY, files: planFiles }, after)
    plan.notes.push(...notes)
    return plan
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
