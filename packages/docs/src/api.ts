import { execFileSync } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Project } from '@tessera/compiler/project'
import type { InterchangeFile, InterchangeFormat } from '@tessera/tokens'
import { planTokenImport } from './edit/import-plan'
import { applyPlan, PlanError, StaleError, undoApplied, type Applied, type Plan } from './edit/plan'

/**
 * The write interface of the docs app (the system manager). It is a function from a request to a response, with no
 * server in it, so tests call it directly and the Vite plugin adapts it. Nothing here runs unless the docs were
 * started with `--edit`, and every request must pass `authorize` before any handler sees it.
 */
export interface ApiRequest {
  method: string
  /** The path and query, such as `/__tessera/plan`. */
  url: string
  headers: Record<string, string | undefined>
  /** The request body, already read, if any. */
  body?: string
}

export interface ApiResponse {
  status: number
  body: unknown
}

export interface ApiOptions {
  /** Whether write mode is on. Without it every route answers 404 and writes nothing. */
  edit: boolean
  /** The per-run secret a request must carry in `x-tessera-key`. */
  secret: string
}

export const API_PREFIX = '/__tessera/'

/** A fresh secret for one run of the server. */
export const newSecret = (): string => randomBytes(24).toString('base64url')

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/**
 * Who may call the write interface: the secret, from a local `Host`, from the page itself (an `Origin`, if the
 * browser sent one, that is the same local host), and with a JSON body on writes (so a plain form post from another
 * page cannot trigger it). The checks are in this order so a refused request learns as little as possible.
 */
export function authorize(req: ApiRequest, options: ApiOptions): ApiResponse | undefined {
  if (!options.edit) {
    return {
      status: 404,
      body: { error: 'Editing is off. Start the docs with --edit to turn it on.' },
    }
  }
  const host = req.headers['host']
  if (!host || !LOCAL_HOST.test(host)) {
    return { status: 403, body: { error: 'This address is not allowed.' } }
  }
  const origin = req.headers['origin']
  if (origin !== undefined) {
    let same: boolean
    try {
      same = new URL(origin).host === host
    } catch {
      same = false
    }
    if (!same)
      return { status: 403, body: { error: 'This page is not allowed to use the editor.' } }
  }
  const given = Buffer.from(req.headers['x-tessera-key'] ?? '')
  const wanted = Buffer.from(options.secret)
  // A missing secret is a mistake in whoever set this up, never a way in: an empty key would match an empty secret.
  if (!wanted.length || given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return {
      status: 401,
      body: { error: 'The editor key is missing or wrong. Open the address the command printed.' },
    }
  }
  if (req.method !== 'GET' && !(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return { status: 415, body: { error: 'Send JSON.' } }
  }
  return undefined
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'change'

/** The state of one editing session: plans waiting to be saved, the last save, and what the manager has changed. */
export class Editor {
  private readonly pending = new Map<string, Plan>()
  private last: Applied | undefined
  /** Files the manager wrote, absolute, for "propose this change". */
  private readonly changed = new Set<string>()

  constructor(
    readonly project: Project,
    readonly options: ApiOptions,
    /** Called after a save or an undo, so a host can refresh what it shows. */
    private readonly onChange: () => void = () => {},
  ) {}

  /** Handle a request. Never throws: a failure is a response. */
  handle(req: ApiRequest): ApiResponse {
    const refused = authorize(req, this.options)
    if (refused) return refused
    const path = req.url.split('?')[0]!.slice(API_PREFIX.length)
    try {
      switch (`${req.method} ${path}`) {
        case 'GET state':
          return ok(this.state())
        case 'POST plan':
          return ok(this.plan(parse(req.body)))
        case 'POST apply':
          return ok(this.apply(parse(req.body)))
        case 'POST undo':
          return ok(this.undo())
        case 'GET git':
          return ok(this.gitStatus())
        case 'POST propose':
          return ok(this.propose(parse(req.body)))
        default:
          return { status: 404, body: { error: 'There is nothing at this address.' } }
      }
    } catch (error) {
      if (error instanceof StaleError) return { status: 409, body: { error: error.message } }
      if (error instanceof PlanError || error instanceof BadRequest) {
        return { status: 400, body: { error: error.message } }
      }
      return { status: 500, body: { error: 'Something went wrong in the editor.' } }
    }
  }

  private state() {
    return {
      edit: true,
      undo: this.last
        ? { summary: this.last.summary, files: this.last.files.map((f) => f.file) }
        : null,
      changed: [...this.changed].map((p) => this.project.display(p)),
    }
  }

  private plan(body: Record<string, unknown>): Plan {
    // Read the project as it is now, not as it was when the page opened.
    this.project.resetAll()
    let plan: Plan
    switch (body.kind) {
      case 'tokenImport':
        plan = planTokenImport(
          this.project,
          files(body.files),
          (typeof body.format === 'string' ? body.format : 'auto') as InterchangeFormat | 'auto',
        )
        break
      default:
        throw new BadRequest('Say what to change.')
    }
    // A few plans may wait (one per open panel); the oldest go first.
    this.pending.set(plan.id, plan)
    for (const id of [...this.pending.keys()].slice(0, Math.max(0, this.pending.size - 20)))
      this.pending.delete(id)
    return plan
  }

  private apply(body: Record<string, unknown>) {
    const id = str(body.id, 'id')
    const plan = this.pending.get(id)
    if (!plan) throw new BadRequest('That change is no longer waiting. Prepare it again.')
    const applied = applyPlan(plan)
    this.pending.delete(id)
    this.last = applied
    for (const f of applied.files) this.changed.add(f.abs)
    this.project.resetAll()
    this.onChange()
    return {
      applied: {
        id: applied.id,
        summary: applied.summary,
        files: applied.files.map((f) => f.file),
      },
    }
  }

  private undo() {
    if (!this.last) throw new BadRequest('There is nothing to undo.')
    undoApplied(this.last)
    const undone = this.last
    this.last = undefined
    for (const f of undone.files) this.changed.delete(f.abs)
    this.project.resetAll()
    this.onChange()
    return { undone: { summary: undone.summary, files: undone.files.map((f) => f.file) } }
  }

  private gitStatus() {
    try {
      const root = git(this.project.root, ['rev-parse', '--show-toplevel'])
      const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const status = git(root, ['status', '--porcelain'])
        .split('\n')
        .filter(Boolean)
        .map((line) => ({ code: line.slice(0, 2).trim() || '?', path: line.slice(3) }))
      return {
        repo: true,
        branch,
        status,
        changed: [...this.changed].map((p) => this.project.display(p)),
      }
    } catch {
      return {
        repo: false,
        branch: null,
        status: [],
        changed: [...this.changed].map((p) => this.project.display(p)),
      }
    }
  }

  /** A branch and a commit of exactly the files the manager changed. It does not push. */
  private propose(body: Record<string, unknown>) {
    const message = str(body.message, 'message').trim()
    if (!message || message.length > 200)
      throw new BadRequest('Write a short message for the change (up to 200 characters).')
    const paths = [...this.changed]
    if (!paths.length) throw new BadRequest('The manager has not changed anything to propose.')
    let root: string
    try {
      root = git(this.project.root, ['rev-parse', '--show-toplevel'])
    } catch {
      throw new BadRequest(
        'This project is not in a git repository, so there is nowhere to propose the change.',
      )
    }
    const base = `tessera/${slug(message)}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`
    let branch = base
    for (let n = 2; ; n++) {
      try {
        git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
        branch = `${base}-${n}`
      } catch {
        break
      }
    }
    const original = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    git(root, ['checkout', '-b', branch])
    try {
      git(root, ['add', '--all', '--', ...paths])
      // Only these paths: anything else the person has staged or changed stays out of the commit.
      git(root, [
        '-c',
        'user.name=' + userName(root),
        '-c',
        'user.email=' + userEmail(root),
        'commit',
        '-m',
        message,
        '--',
        ...paths,
      ])
    } catch (error) {
      // A commit that failed (a hook, say) must not leave the person on a new, empty branch.
      git(root, ['checkout', original])
      git(root, ['branch', '-D', branch])
      throw new BadRequest(
        `The commit failed: ${String((error as { stderr?: unknown }).stderr ?? error).trim() || 'git refused it'}`,
      )
    }
    const commit = git(root, ['rev-parse', '--short', 'HEAD'])
    this.changed.clear()
    return { branch, commit }
  }
}

const userName = (cwd: string) => tryGit(cwd, ['config', 'user.name']) || 'Tessera system manager'
const userEmail = (cwd: string) =>
  tryGit(cwd, ['config', 'user.email']) || 'manager@tessera.invalid'
function tryGit(cwd: string, args: string[]): string {
  try {
    return git(cwd, args)
  } catch {
    return ''
  }
}

class BadRequest extends Error {}

const ok = (body: unknown): ApiResponse => ({ status: 200, body })

function parse(text: string | undefined): Record<string, unknown> {
  try {
    const value = JSON.parse(text ?? '{}') as unknown
    if (typeof value === 'object' && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>
  } catch {
    /* falls through */
  }
  throw new BadRequest('The request was not valid JSON.')
}

function str(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') throw new BadRequest(`"${name}" is missing.`)
  return value
}

function files(value: unknown): InterchangeFile[] {
  if (!Array.isArray(value)) throw new BadRequest('"files" must be a list of files.')
  return value.map((f) => {
    const file = f as { path?: unknown; content?: unknown }
    if (typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new BadRequest('Each file needs a path and its text.')
    }
    return { path: file.path, content: file.content }
  })
}
