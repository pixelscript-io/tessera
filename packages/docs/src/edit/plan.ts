import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  applyToTess,
  diffSnapshots,
  type Change,
  type Renames,
  type Snapshot,
} from '@tessera/compiler'
import { Project } from '@tessera/compiler/project'
import { describeOp, editContract, OpError, type ContractOp } from './contract-ops'

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
  /** Uses of what changed, by file, for the person to weigh. */
  usage: Array<{ label: string; uses: Array<{ file: string; count: number }> }>
  /** Whether the change carries a codemod (a rename), and how many uses it rewrites. */
  codemod?: { edits: number; files: number }
}

export const sha = (text: string): string => createHash('sha1').update(text).digest('hex')
const forward = (p: string) => p.replaceAll('\\', '/')

/** A refusal with a sentence a person can read. */
export class PlanError extends OpError {}

/** The text range between `<contract>` and `</contract>` in a `.tess` file. */
function contractRange(source: string): { start: number; end: number } | undefined {
  const open = /<contract(?:\s[^>]*)?>/.exec(source)
  if (!open) return undefined
  const start = open.index + open[0].length
  const end = source.indexOf('</contract>', start)
  return end === -1 ? undefined : { start, end }
}

const problemKey = (p: { file: string; code: string; message: string }) =>
  `${p.file}|${p.code}|${p.message}`

/**
 * Every error `tessera check` would report for the project's `.tess` files, with some files' sources replaced
 * (and files added). The errors are what the project reports after severity and the baseline, the same as the CLI.
 */
export function checkSources(
  project: Project,
  overrides: Map<string, string>,
): Map<string, PlanProblem> {
  const out = new Map<string, PlanProblem>()
  const files = new Set(project.files().map(forward))
  for (const abs of overrides.keys()) files.add(abs)
  for (const abs of files) {
    let source = overrides.get(abs)
    if (source === undefined) {
      try {
        source = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
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

/** Static uses of a value: `<Comp variant="value"`. */
function valueUses(component: string, variant: string, value: string): RegExp {
  const esc = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<${component}(?=[\\s/>])[^>]*\\s${variant}=(["'])${esc}\\1`, 'g')
}

function countUses(
  sources: Map<string, string>,
  pattern: RegExp,
  except?: string,
): Array<{ file: string; count: number }> {
  return [...sources]
    .filter(([file]) => file !== except)
    .map(([file, source]) => ({ file, count: source.match(pattern)?.length ?? 0 }))
    .filter((u) => u.count > 0)
}

/** The project's `.tess` files with their text, by display path. */
function readAll(project: Project, overrides: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const abs of new Set([...project.files().map(forward), ...overrides.keys()])) {
    const source = overrides.get(abs) ?? safeRead(abs)
    if (source !== undefined) out.set(project.display(abs), source)
  }
  return out
}

const safeRead = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** A project with some component sources replaced, to ask the compiler about a change that has not been made. */
function overlay(project: Project, overrides: Map<string, string>): Project {
  const components = [...overrides].filter(
    ([abs]) => /\/(system|app)\/components\//.test(abs) || abs.includes('/components/'),
  )
  return new Project(project.root, {
    ...project.options,
    extraComponents: [
      ...(project.options.extraComponents ?? []),
      ...components.map(([file, source]) => ({ file, source })),
    ],
  })
}

/**
 * Finish a plan: ask the compiler what the project looks like with `after` in place, and classify the change.
 * `files` carry the text before and after; the overlay compares errors before and after, so errors the project
 * already had do not block a change that did not cause them.
 */
export function finishPlan(
  project: Project,
  base: Pick<Plan, 'summary' | 'files'> & { usage?: Plan['usage']; codemod?: Plan['codemod'] },
  options: { after?: Project } = {},
): Plan {
  // Only component, page and layout sources are compiled; a token file is read as tokens, by the project that has them.
  const overrides = new Map(
    base.files
      .filter((f) => f.after !== null && f.abs.endsWith('.tess'))
      .map((f) => [f.abs, f.after!]),
  )
  const after = options.after ?? overlay(project, overrides)

  const before = checkSources(project, new Map())
  const now = checkSources(after, overrides)
  const introduced = [...now].filter(([key]) => !before.has(key)).map(([, p]) => p)
  // A contract that no longer parses makes every use of the component an error too: say the contract's own problem.
  const own = new Set(base.files.map((f) => f.file))
  const contractErrors = introduced.filter((p) => /^T30/.test(p.code) && own.has(p.file))
  const blocking = contractErrors.length ? contractErrors : introduced

  const changes = contractErrors.length
    ? []
    : diffSnapshots(snapshot(project), snapshot(after), {
        contrastMinimum: project.agentManifest().rules.contrastMinimum,
      })
  const notes: string[] = []
  return {
    id: randomUUID(),
    summary: base.summary,
    files: base.files,
    blocking,
    notes,
    changes,
    usage: base.usage ?? [],
    ...(base.codemod ? { codemod: base.codemod } : {}),
  }
}

/** Plan a change to one component's contract. */
export function planContractChange(project: Project, component: string, op: ContractOp): Plan {
  const entry = project.components().registry.entries.get(component)
  if (!entry) throw new PlanError(`There is no component named ${component}.`)
  const abs = forward(entry.file)
  // Only the project's own components, and the design system's (`system/components`): not the router's, which ship in a package.
  if (!abs.startsWith(`${forward(project.root)}/`) && !abs.includes('/system/components/')) {
    throw new PlanError(
      `${component} comes from an installed package, not from this project, so it cannot be edited here.`,
    )
  }
  const source = readFileSync(abs, 'utf8')
  const range = contractRange(source)
  if (!range) throw new PlanError(`${component} has no <contract> block to edit.`)

  const edited = editContract(source.slice(range.start, range.end), op)
  const afterSource = source.slice(0, range.start) + edited + source.slice(range.end)
  const files: PlanFile[] = [
    { file: project.display(abs), abs, before: source, after: afterSource, hash: sha(source) },
  ]

  const sources = readAll(project, new Map())
  const usage: Plan['usage'] = []
  let codemod: Plan['codemod']

  if (op.kind === 'renameValue') {
    // Every use of the old value is rewritten in the same save, as `tessera codemod` would.
    const renames: Renames = {
      components: [],
      values: [{ component, variant: op.variant, from: op.from, to: op.to }],
      tokens: [],
    }
    let edits = 0
    let touched = 0
    const uses: Array<{ file: string; count: number }> = []
    for (const abs2 of project.files().map(forward)) {
      const current = abs2 === abs ? afterSource : safeRead(abs2)
      if (current === undefined) continue
      const result = applyToTess(current, renames)
      if (!result.edits.length) continue
      edits += result.edits.length
      touched++
      uses.push({ file: project.display(abs2), count: result.edits.length })
      const existing = files.find((f) => f.abs === abs2)
      if (existing) existing.after = result.source
      else {
        const text = safeRead(abs2)!
        files.push({
          file: project.display(abs2),
          abs: abs2,
          before: text,
          after: result.source,
          hash: sha(text),
        })
      }
    }
    usage.push({ label: `Uses of "${op.from}" that are rewritten`, uses })
    codemod = { edits, files: touched }
  } else if (op.kind === 'removeValue' || op.kind === 'deprecateValue') {
    usage.push({
      label: `Uses of ${component}.${op.variant} "${op.value}"`,
      uses: countUses(sources, valueUses(component, op.variant, op.value), project.display(abs)),
    })
  } else if (op.kind === 'setDefault') {
    const tag = new RegExp(`<${component}(?=[\\s/>])[^>]*>`, 'g')
    const sets = new RegExp(`\\s:?${op.variant}=`)
    const uses = [...sources]
      .filter(([file]) => file !== project.display(abs))
      .map(([file, text]) => ({
        file,
        count: (text.match(tag) ?? []).filter((t) => !sets.test(t)).length,
      }))
      .filter((u) => u.count > 0)
    usage.push({ label: `Uses that do not set ${op.variant} and will change`, uses })
  }

  return finishPlan(project, {
    summary: describeOp(component, op),
    files,
    usage,
    ...(codemod ? { codemod } : {}),
  })
}

/** The starter for a new component, with a style only if the project has the tokens it names. */
export function componentStarter(project: Project, name: string, description: string): string {
  const tokens = project.tokens()
  const has = (path: string) =>
    !!(tokens?.ok && tokens.manifest.tokens.some((t) => t.path === path))
  const style =
    has('space.4') && has('color.text.default')
      ? '\n<style>\n.root {\n  padding: $space.4;\n  color: $color.text.default;\n}\n</style>\n'
      : ''
  return `<contract>
{
  "name": ${JSON.stringify(name)},
  "role": "group",
  "description": ${JSON.stringify(description)},
  "parts": ["root"],
  "slots": { "default": "content" }
}
</contract>

<template>
  <div class="root">
    <slot />
  </div>
</template>
${style}`
}

/** Plan a new component in `app/components`. */
export function planNewComponent(project: Project, name: string, description: string): Plan {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw new PlanError(
      `"${name}" is not a valid component name. Use PascalCase with letters and numbers, such as UserCard.`,
    )
  }
  if (project.components().registry.entries.has(name)) {
    throw new PlanError(`A component named ${name} already exists.`)
  }
  const abs = forward(join(project.root, 'app', 'components', `${name}.tess`))
  if (existsSync(abs)) throw new PlanError(`app/components/${name}.tess already exists.`)
  const after = componentStarter(project, name, description)
  return finishPlan(project, {
    summary: `Add the component ${name}`,
    files: [{ file: project.display(abs), abs, before: null, after, hash: null }],
  })
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
