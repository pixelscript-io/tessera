import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { API_PREFIX, authorize, Editor, newSecret, type ApiRequest } from '../src/api'

const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const made: string[] = []
afterAll(() =>
  made.forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })),
)

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    stdio: 'pipe',
  })
    .toString()
    .trim()

/** The kitchen-sink app in a git repository, with an editor on it. */
function session(options: { edit?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tessera-api-')).replaceAll('\\', '/')
  made.push(root)
  cpSync(join(repo, 'examples/kitchen-sink/app'), join(root, 'app'), {
    recursive: true,
    filter: (src) => !/(\.browser\.test\.ts|__screenshots__|seeded|\.d\.ts)/.test(src),
  })
  cpSync(join(repo, 'system/components/Button.tess'), join(root, 'app/components/Button.tess'))
  const tokens = join(repo, 'system/tokens').replaceAll('\\', '/')
  writeFileSync(join(root, 'package.json'), '{ "name": "scratch" }\n')
  git(root, 'init', '-b', 'main', '-q')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'start')
  const secret = newSecret()
  let changes = 0
  const editor = new Editor(
    new Project(root, { tokens, today: '2026-10-22' }),
    { edit: options.edit ?? true, secret },
    () => changes++,
  )
  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    editor.handle({
      method,
      url: API_PREFIX + path,
      headers: {
        host: 'localhost:5173',
        'x-tessera-key': secret,
        'content-type': 'application/json',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return {
    root,
    secret,
    editor,
    call,
    changes: () => changes,
    read: (f: string) => readFileSync(join(root, f), 'utf8'),
  }
}

const plan = (s: ReturnType<typeof session>, op: object) =>
  s.call('POST', 'plan', { kind: 'contract', component: 'Button', op })

describe('who may use the write interface', () => {
  const request = (headers: Record<string, string | undefined>, method = 'GET'): ApiRequest => ({
    method,
    url: API_PREFIX + 'state',
    headers,
  })
  const options = { edit: true, secret: 'secret-value' }
  const good = {
    host: 'localhost:5173',
    'x-tessera-key': 'secret-value',
    'content-type': 'application/json',
  }

  it('answers 404 to everything when editing is off, and writes nothing', () => {
    const s = session({ edit: false })
    for (const [method, path] of [
      ['GET', 'state'],
      ['POST', 'plan'],
      ['POST', 'apply'],
      ['POST', 'undo'],
      ['POST', 'propose'],
    ] as const) {
      const res = s.call(method, path, {
        kind: 'contract',
        component: 'Button',
        op: { kind: 'description', value: 'x' },
      })
      expect(res.status, `${method} ${path}`).toBe(404)
    }
    expect(s.read('app/components/Button.tess')).not.toContain('"description": "x"')
  })

  it('accepts a local host with the key, and refuses everything else', () => {
    expect(authorize(request(good), options)).toBeUndefined()
    expect(authorize(request({ ...good, host: '127.0.0.1:5173' }), options)).toBeUndefined()
    expect(authorize(request({ ...good, host: '[::1]:5173' }), options)).toBeUndefined()
    // A key that is missing, wrong, or of the wrong length.
    expect(authorize(request({ ...good, 'x-tessera-key': undefined }), options)?.status).toBe(401)
    expect(authorize(request({ ...good, 'x-tessera-key': 'secret-valuX' }), options)?.status).toBe(
      401,
    )
    expect(authorize(request({ ...good, 'x-tessera-key': 'x' }), options)?.status).toBe(401)
  })

  it('refuses a host that is not local, which is how DNS rebinding arrives', () => {
    for (const host of [
      'evil.example',
      'localhost.evil.example:5173',
      '192.168.1.5:5173',
      '127.0.0.1.evil.com',
      undefined,
    ]) {
      expect(authorize(request({ ...good, host }), options)?.status, String(host)).toBe(403)
    }
  })

  it('refuses a request from another page, even with the key', () => {
    expect(
      authorize(request({ ...good, origin: 'http://localhost:5173' }), options),
    ).toBeUndefined()
    expect(authorize(request({ ...good, origin: 'https://evil.example' }), options)?.status).toBe(
      403,
    )
    expect(authorize(request({ ...good, origin: 'http://localhost:9999' }), options)?.status).toBe(
      403,
    )
    expect(authorize(request({ ...good, origin: 'null' }), options)?.status).toBe(403)
  })

  it('needs a JSON body on a write, so a plain form post cannot trigger one', () => {
    expect(
      authorize(request({ ...good, 'content-type': 'text/plain' }, 'POST'), options)?.status,
    ).toBe(415)
    expect(
      authorize(
        request({ ...good, 'content-type': 'application/x-www-form-urlencoded' }, 'POST'),
        options,
      )?.status,
    ).toBe(415)
    expect(authorize(request(good, 'POST'), options)).toBeUndefined()
  })

  it('gives each run its own secret', () => {
    expect(newSecret()).not.toBe(newSecret())
    expect(newSecret().length).toBeGreaterThanOrEqual(30)
  })
})

describe('planning, saving and undoing through the interface', () => {
  it('plans, saves, and reports what changed, then undoes', () => {
    const s = session()
    const before = s.read('app/components/Button.tess')
    const prepared = plan(s, { kind: 'description', value: 'Starts something.' })
    expect(prepared.status).toBe(200)
    const { id, summary, blocking } = prepared.body as {
      id: string
      summary: string
      blocking: unknown[]
    }
    expect(summary).toBe('Change the description of Button')
    expect(blocking).toEqual([])
    // Planning wrote nothing.
    expect(s.read('app/components/Button.tess')).toBe(before)

    const saved = s.call('POST', 'apply', { id })
    expect(saved.status).toBe(200)
    expect(s.read('app/components/Button.tess')).toContain('"Starts something."')
    expect(s.changes()).toBe(1)
    expect((s.call('GET', 'state').body as { undo: { summary: string } }).undo.summary).toBe(
      summary,
    )

    expect(s.call('POST', 'undo', {}).status).toBe(200)
    expect(s.read('app/components/Button.tess')).toBe(before)
    expect(s.call('POST', 'undo', {}).status).toBe(400)
  })

  it('refuses to save a plan that would break the project (400 from planning is not needed: the plan says so)', () => {
    const s = session()
    const prepared = plan(s, { kind: 'removeValue', variant: 'tone', value: 'danger' })
    const body = prepared.body as { id: string; blocking: Array<{ code: string }> }
    expect(body.blocking.map((b) => b.code)).toContain('T4008')
    const before = s.read('app/components/Button.tess')
    const res = s.call('POST', 'apply', { id: body.id })
    expect(res.status).toBe(409)
    expect((res.body as { error: string }).error).toBe(
      'This change would break the project, so it was not saved.',
    )
    expect(s.read('app/components/Button.tess')).toBe(before)
  })

  it('refuses to save when the file changed after the plan, and does not accept a plan twice', () => {
    const s = session()
    const { id } = plan(s, { kind: 'description', value: 'Mine.' }).body as { id: string }
    writeFileSync(
      join(s.root, 'app/components/Button.tess'),
      s.read('app/components/Button.tess') + '\n',
    )
    const res = s.call('POST', 'apply', { id })
    expect(res.status).toBe(409)
    expect((res.body as { error: string }).error).toContain(
      'changed on disk after this change was prepared',
    )
    const fresh = plan(s, { kind: 'description', value: 'Mine.' }).body as { id: string }
    expect(s.call('POST', 'apply', { id: fresh.id }).status).toBe(200)
    expect(s.call('POST', 'apply', { id: fresh.id }).status).toBe(400)
  })

  it('says what is wrong with a request, in a sentence', () => {
    const s = session()
    expect((s.call('POST', 'plan', { kind: 'nope' }).body as { error: string }).error).toBe(
      'Say what to change.',
    )
    expect(
      (plan(s, { kind: 'addValue', variant: 'x', value: 'y' }).body as { error: string }).error,
    ).toContain('x is not a variant')
    expect((s.call('POST', 'apply', { id: 'nope' }).body as { error: string }).error).toBe(
      'That change is no longer waiting. Prepare it again.',
    )
    expect(s.call('POST', 'plan', undefined, { 'content-type': 'application/json' }).status).toBe(
      400,
    )
    expect(s.call('GET', 'nowhere').status).toBe(404)
  })

  it('creates a component', () => {
    const s = session()
    const { id } = s.call('POST', 'plan', {
      kind: 'newComponent',
      name: 'Panel',
      description: 'A panel.',
    }).body as { id: string }
    expect(s.call('POST', 'apply', { id }).status).toBe(200)
    expect(s.read('app/components/Panel.tess')).toContain('"name": "Panel"')
  })
})

describe('proposing a change through git', () => {
  it('commits exactly the files the manager changed, on a new branch, and does not push', () => {
    const s = session()
    // Something else the person is working on, changed and staged: it must stay out of the commit.
    writeFileSync(
      join(s.root, 'app/pages/about.tess'),
      s.read('app/pages/about.tess') + '\n<!-- mine -->\n',
    )
    git(s.root, 'add', 'app/pages/about.tess')
    const { id } = plan(s, { kind: 'description', value: 'Starts something.' }).body as {
      id: string
    }
    s.call('POST', 'apply', { id })

    const status = s.call('GET', 'git').body as { repo: boolean; branch: string; changed: string[] }
    expect(status).toMatchObject({
      repo: true,
      branch: 'main',
      changed: ['app/components/Button.tess'],
    })

    const res = s.call('POST', 'propose', { message: 'Reword the Button description' })
    expect(res.status).toBe(200)
    const { branch } = res.body as { branch: string }
    expect(branch).toMatch(/^tessera\/reword-the-button-description-\d{8}$/)
    expect(git(s.root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(branch)
    expect(git(s.root, 'show', '--name-only', '--format=%s', 'HEAD').split('\n')).toEqual([
      'Reword the Button description',
      '',
      'app/components/Button.tess',
    ])
    // The staged file of the person's own is still staged, not committed.
    expect(git(s.root, 'diff', '--cached', '--name-only')).toBe('app/pages/about.tess')
    expect(git(s.root, 'remote')).toBe('')
  })

  it('refuses with nothing to propose, with no message, and outside a git repository', () => {
    const s = session()
    expect((s.call('POST', 'propose', { message: 'x' }).body as { error: string }).error).toBe(
      'The manager has not changed anything to propose.',
    )
    const { id } = plan(s, { kind: 'description', value: 'A.' }).body as { id: string }
    s.call('POST', 'apply', { id })
    expect(s.call('POST', 'propose', { message: '   ' }).status).toBe(400)
    expect(s.call('POST', 'propose', { message: 'x'.repeat(201) }).status).toBe(400)
    // A second proposal with the same message gets its own branch name.
    expect(s.call('POST', 'propose', { message: 'Same' }).status).toBe(200)
    const again = plan(s, { kind: 'description', value: 'B.' }).body as { id: string }
    s.call('POST', 'apply', { id: again.id })
    expect(
      (s.call('POST', 'propose', { message: 'Same' }).body as { branch: string }).branch,
    ).toMatch(/-2$/)

    const loose = session()
    rmSync(join(loose.root, '.git'), { recursive: true, force: true })
    const p = plan(loose, { kind: 'description', value: 'C.' }).body as { id: string }
    loose.call('POST', 'apply', { id: p.id })
    expect((loose.call('POST', 'propose', { message: 'x' }).body as { error: string }).error).toBe(
      'This project is not in a git repository, so there is nowhere to propose the change.',
    )
    expect((loose.call('GET', 'git').body as { repo: boolean }).repo).toBe(false)
  })
})
