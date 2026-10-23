import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { diffSnapshots, type Change, type Snapshot } from '@tessera/compiler'
import type { Project } from '@tessera/compiler/project'

/**
 * A change, worked out before anything is written. A plan holds the files as they would be, what the compiler says
 * about the project with the change in place, and what the change means for the people using the system. Nothing
 * here writes a file; `applyPlan` does, and only if the files are still as the plan found them.
 */
export interface PlanFile {
  /** Path relative to the project, forward slashes: what a person sees. */
  file: string
  abs: string
  /** The text now. Null when the file does not exist yet. */
  before: string | null
  /** The text after the change. Null when the file would be deleted. */
  after: string | null
  /** A hash of `before`, so a save can tell the file changed in between. */
  hash: string | null
}

export interface PlanProblem {
  code: string
  file: string
  message: string
  hint?: string
}

export interface Plan {
  id: string
  /** One sentence for the change. */
  summary: string
  files: PlanFile[]
  /** Errors this change would introduce. Any of these means the change is refused. */
  blocking: PlanProblem[]
  /** Warnings the change adds, and anything else worth saying. */
  notes: string[]
  /** `tessera diff` classification of the change. */
  changes: Change[]
}

export const sha = (text: string): string => createHash('sha1').update(text).digest('hex')
const forward = (p: string) => p.replaceAll('\\', '/')

/** A refusal with a sentence a person can read. */
export class PlanError extends Error {}

const problemKey = (p: { file: string; code: string; message: string }) =>
  `${p.file}|${p.code}|${p.message}`

/**
 * Every error `tessera check` would report for the project's `.tess` files, as the CLI reports them (after severity
 * and the baseline). The project decides which tokens and components the files are checked against.
 */
export function checkSources(project: Project): Map<string, PlanProblem> {
  const out = new Map<string, PlanProblem>()
  for (const abs of new Set(project.files().map(forward))) {
    let source: string
    try {
      source = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    for (const d of project.compileFile(abs, source).diagnostics) {
      if (d.severity !== 'error') continue
      const p: PlanProblem = {
        code: d.code,
        file: project.display(abs),
        message: d.message,
        ...(d.hint ? { hint: d.hint } : {}),
      }
      out.set(problemKey(p), p)
    }
  }
  return out
}

function snapshot(project: Project): Snapshot {
  const tokens = project.tokens()
  return {
    components: project.agentManifest().components,
    ...(tokens?.ok ? { tokens: tokens.manifest } : {}),
  }
}

/**
 * Finish a plan: ask the compiler about the project as it would be (`after`, a project over the changed files)
 * and classify the change. Errors the project already had do not block a change that did not cause them: only
 * errors the change introduces do.
 */
export function finishPlan(
  project: Project,
  base: Pick<Plan, 'summary' | 'files'>,
  after: Project,
): Plan {
  const before = checkSources(project)
  const blocking = [...checkSources(after)]
    .filter(([key]) => !before.has(key))
    .map(([, problem]) => problem)
  return {
    id: randomUUID(),
    summary: base.summary,
    files: base.files,
    blocking,
    notes: [],
    changes: diffSnapshots(snapshot(project), snapshot(after), {
      contrastMinimum: project.agentManifest().rules.contrastMinimum,
    }),
  }
}

// --- applying -----------------------------------------------------------------------------------------------

/** What a save wrote, so it can be taken back. */
export interface Applied {
  id: string
  summary: string
  files: Array<{ abs: string; file: string; before: string | null; after: string | null }>
}

/** A file is not as the plan found it, or the plan has blocking problems. */
export class StaleError extends PlanError {}

function writeAtomic(abs: string, text: string): void {
  mkdirSync(dirname(abs), { recursive: true })
  const temp = `${abs}.tessera-${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(temp, text)
  renameSync(temp, abs)
}

/** Write a plan. Refused if it has blocking problems, or if any file changed on disk since the plan was made. */
export function applyPlan(plan: Plan): Applied {
  if (plan.blocking.length) {
    throw new StaleError('This change would break the project, so it was not saved.')
  }
  for (const f of plan.files) {
    const now = existsSync(f.abs) ? readFileSync(f.abs, 'utf8') : null
    const hash = now === null ? null : sha(now)
    if (hash !== f.hash) {
      throw new StaleError(
        `${f.file} changed on disk after this change was prepared. Nothing was saved; prepare it again.`,
      )
    }
  }
  for (const f of plan.files) {
    if (f.after === null) rmSync(f.abs, { force: true })
    else writeAtomic(f.abs, f.after)
  }
  return {
    id: plan.id,
    summary: plan.summary,
    files: plan.files.map((f) => ({ abs: f.abs, file: f.file, before: f.before, after: f.after })),
  }
}

/** Take back a save, if every file is still as that save left it. */
export function undoApplied(applied: Applied): void {
  for (const f of applied.files) {
    const now = existsSync(f.abs) ? readFileSync(f.abs, 'utf8') : null
    if (now !== f.after) {
      throw new StaleError(
        `${f.file} changed after it was saved, so the change cannot be undone from here. Use git to go back.`,
      )
    }
  }
  for (const f of applied.files) {
    if (f.before === null) rmSync(f.abs, { force: true })
    else writeAtomic(f.abs, f.before)
  }
}
