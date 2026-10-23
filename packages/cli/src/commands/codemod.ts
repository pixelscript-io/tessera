import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyToTess,
  applyToTokens,
  collectRenames,
  hasRenames,
  type CodemodEdit,
} from '@tessera/compiler'
import type { Args } from '../args'
import { has } from '../args'
import type { Io } from '../io'
import { openProject } from '../project'

const KIND_LABEL: Record<CodemodEdit['kind'], string> = {
  component: 'component',
  value: 'variant value',
  token: 'token',
}

/** Every `*.tokens.json` file under a folder. */
function tokenFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? tokenFiles(join(dir, e.name))
        : e.name.endsWith('.tokens.json')
          ? [join(dir, e.name)]
          : [],
    )
  } catch {
    return []
  }
}

/**
 * The token renames the token files declare, read from the files themselves. A rename leaves aliases that still
 * name the old token, which stops the tokens from building: the codemod has to work before they do.
 */
function tokenRenames(
  files: string[],
): Array<{ path: string; extensions: Record<string, unknown> }> {
  const out: Array<{ path: string; extensions: Record<string, unknown> }> = []
  const walk = (node: unknown, segments: string[]) => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return
    const doc = node as Record<string, unknown>
    if ('$value' in doc) {
      const extensions = doc.$extensions
      if (typeof extensions === 'object' && extensions !== null) {
        out.push({ path: segments.join('.'), extensions: extensions as Record<string, unknown> })
      }
      return
    }
    for (const [key, child] of Object.entries(doc)) {
      if (!key.startsWith('$') || key === '$root') walk(child, [...segments, key])
    }
  }
  for (const file of files) {
    try {
      walk(JSON.parse(readFileSync(file, 'utf8')), [])
    } catch {
      // A file that is not JSON is the tokens build's to report.
    }
  }
  return out
}

/**
 * `tessera codemod`: bring the project up to date with renames the design system declares. A component says
 * `"renamedFrom": "Old"`, a contract says `"renamedValues": { "tone": { "danger": "destructive" } }`, a token says
 * `$extensions.tessera.renamedFrom`. Without `--write` it only lists what it would change.
 */
export async function codemod(args: Args, io: Io): Promise<number> {
  const project = await openProject(io.cwd, args)
  const tokenFileList = project.tokensDir() ? tokenFiles(project.tokensDir()!) : []
  const renames = collectRenames(project.agentManifest().components, tokenRenames(tokenFileList))
  if (!hasRenames(renames)) {
    io.out(
      'Nothing to do: no component, variant value or token says it was renamed (renamedFrom, renamedValues).',
    )
    return 0
  }

  const write = has(args, 'write')
  const files: Array<{ path: string; apply: typeof applyToTess }> = [
    ...project.files().map((path) => ({ path, apply: applyToTess })),
    ...tokenFileList.map((path) => ({
      path,
      apply: applyToTokens,
    })),
  ]

  let edited = 0
  let changed = 0
  let manual = 0
  const report: Array<{
    file: string
    edits: CodemodEdit[]
    manual: Array<{ line: number; message: string }>
  }> = []
  for (const { path, apply } of files) {
    const before = readFileSync(path, 'utf8')
    const result = apply(before, renames)
    if (!result.edits.length && !result.manual.length) continue
    const file = project.display(path)
    report.push({ file, edits: result.edits, manual: result.manual })
    edited += result.edits.length
    manual += result.manual.length
    if (result.edits.length) {
      changed++
      if (write) writeFileSync(path, result.source)
    }
  }

  if (has(args, 'json')) {
    io.out(JSON.stringify({ write, files: report, edits: edited, manual }, null, 2))
    return 0
  }
  for (const f of report) {
    for (const e of f.edits)
      io.out(`${f.file}:${e.line}  ${KIND_LABEL[e.kind]}  ${e.from} → ${e.to}`)
    for (const m of f.manual) io.out(`${f.file}:${m.line}  MANUAL  ${m.message}`)
  }
  io.out(
    edited || manual
      ? `\n${write ? 'Updated' : 'Would update'} ${edited} ${edited === 1 ? 'use' : 'uses'} in ${changed} ${changed === 1 ? 'file' : 'files'}${manual ? `; ${manual} ${manual === 1 ? 'needs' : 'need'} a hand` : ''}.${write ? ' Run `tessera check` to confirm.' : ' Run it again with --write to apply.'}`
      : 'Every use is already up to date.',
  )
  return 0
}
