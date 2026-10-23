import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import {
  diffSnapshots,
  renderChangelog,
  summarize,
  type Change,
  type Snapshot,
} from '@tessera/compiler'
import { Project } from '@tessera/compiler/project'
import { formatDiagnostic } from '@tessera/tokens'
import type { Args } from '../args'
import { flag, has } from '../args'
import { CliError, type Io } from '../io'
import { openProject } from '../project'

function git(cwd: string, args: string[], env?: Record<string, string>): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    }).trim()
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer | string }).stderr ?? '').trim()
    throw new CliError(stderr || `git ${args.join(' ')} failed.`)
  }
}

/** The snapshot of a project: its components and its token manifest. Tokens that do not build are an error. */
export function snapshotOf(project: Project): Snapshot {
  const tokens = project.tokens()
  if (tokens && !tokens.ok) {
    throw new CliError(
      `The design tokens in ${project.display(project.tokensDir() ?? project.root) || '.'} do not build.`,
      tokens.diagnostics.map(formatDiagnostic).join('\n\n'),
    )
  }
  return {
    components: project.agentManifest().components,
    ...(tokens?.ok ? { tokens: tokens.manifest } : {}),
  }
}

/**
 * The project as it was at a git ref, without touching the working tree or the index: the ref is exported to a
 * temporary folder (`git read-tree` into a throwaway index, then `checkout-index`) and opened there with the same options. Call `cleanup` when done.
 */
function projectAt(
  project: Project,
  gitRoot: string,
  ref: string,
): { project: Project; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-diff-'))
  const cleanup = () =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  try {
    const tree = join(dir, 'tree')
    mkdirSync(tree)
    // A throwaway index reads the ref and writes its files into `tree`: the real index and working tree are never touched.
    const env = { GIT_INDEX_FILE: join(dir, 'index') }
    git(gitRoot, ['read-tree', ref], env)
    const prefix = `${tree.replaceAll('\\', '/')}/`
    git(gitRoot, ['checkout-index', '--all', '--force', `--prefix=${prefix}`], env)
    const inside = relative(gitRoot, project.root)
    const options = { ...project.options }
    // A tokens folder given by the config is an absolute path in the working tree: find it in the old tree.
    if (options.tokens) {
      const inRepo = relative(gitRoot, options.tokens)
      // A tokens folder outside the repository is shared by both sides.
      if (!inRepo.startsWith('..')) options.tokens = join(tree, inRepo)
    }
    if (options.baseline) delete options.baseline
    return { project: new Project(join(tree, inside), options), cleanup }
  } catch (error) {
    cleanup()
    throw error
  }
}

const TITLES: Array<[Change['kind'], string]> = [
  ['breaking', 'Breaking'],
  ['additive', 'Additive'],
  ['cosmetic', 'Cosmetic'],
]

/**
 * `tessera diff <ref>`: what changed in the design system since a git ref, classified as breaking, additive or
 * cosmetic. A value change that flips contrast in any theme, or moves a token past its neighbours in a scale, is
 * breaking. `--changelog` prints it as a changelog section.
 */
export async function diff(args: Args, io: Io): Promise<number> {
  const [from] = args.positional
  if (!from) {
    throw new CliError(
      'Say which git ref to compare with.',
      'tessera diff main   (a branch, a tag such as v0.2.0, or a commit)',
    )
  }
  const project = await openProject(io.cwd, args)
  const gitRoot = resolve(git(project.root, ['rev-parse', '--show-toplevel']))
  const toRef = flag(args, 'to')
  for (const ref of [from, ...(typeof toRef === 'string' ? [toRef] : [])]) {
    try {
      git(gitRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    } catch {
      throw new CliError(`Git does not know the ref "${ref}".`, 'Use a branch, a tag or a commit.')
    }
  }

  const cleanups: Array<() => void> = []
  try {
    const old = projectAt(project, gitRoot, from)
    cleanups.push(old.cleanup)
    let current: Project = project
    if (typeof toRef === 'string') {
      const next = projectAt(project, gitRoot, toRef)
      cleanups.push(next.cleanup)
      current = next.project
    }
    const changes = diffSnapshots(snapshotOf(old.project), snapshotOf(current), {
      contrastMinimum: project.agentManifest().rules.contrastMinimum,
    })
    const counts = summarize(changes)

    if (has(args, 'json')) {
      io.out(JSON.stringify({ from, to: toRef ?? 'working tree', ...counts, changes }, null, 2))
    } else if (has(args, 'changelog')) {
      const version = flag(args, 'version')
      io.out(
        renderChangelog(changes, {
          version: typeof version === 'string' ? version : undefined,
          date: new Date().toISOString().slice(0, 10),
        }).trimEnd(),
      )
    } else {
      io.out(`Comparing ${from} with ${typeof toRef === 'string' ? toRef : 'the working tree'}.`)
      for (const [kind, title] of TITLES) {
        const items = changes.filter((c) => c.kind === kind)
        if (!items.length) continue
        io.out(`\n${title.toUpperCase()} (${items.length})`)
        for (const c of items) io.out(`  ${c.message}${c.codemod ? '  [tessera codemod]' : ''}`)
      }
      io.out(
        changes.length
          ? `\n${counts.breaking} breaking, ${counts.additive} additive, ${counts.cosmetic} cosmetic.`
          : '\nNo changes to the design system.',
      )
    }
    return has(args, 'fail-on-breaking') && counts.breaking > 0 ? 1 : 0
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
}
