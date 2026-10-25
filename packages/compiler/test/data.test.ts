import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyBaseline, applySeverity, createBaseline } from '../src/accountability'
import { compile } from '../src/compile'
import { loadProjectApis } from '../src/node'
import type { CompileOptions } from '../src/compile'

const FILE = 'app/pages/Tasks.tess'
const PATH = '/project/app/pages/Tasks.tess'

const page = (script: string, template: string) =>
  `<script>\n${script}\n</script>\n<template>${template}</template>`

const build = (source: string, options: Partial<CompileOptions> = {}) =>
  compile(source, { file: FILE, path: PATH, kind: 'page', ...options })

const github = { name: 'github', file: '/project/app/apis/github.ts' }
const fallback = { name: 'default', file: '/project/app/apis/default.ts' }

/** `code line:column message | hint` of each diagnostic. */
const issues = (source: string, options: Partial<CompileOptions> = {}) =>
  build(source, options).diagnostics.map(
    (d) =>
      `${d.code} ${d.severity === 'warning' ? 'warn ' : ''}${d.message}${d.hint ? ` | ${d.hint}` : ''}`,
  )

const coreImport = /import \{([^}]*)\} from "@pixelscriptio\/tessera\/core"/

const importedFromCore = (source: string, options: Partial<CompileOptions> = {}) =>
  (coreImport.exec(build(source, options).code)?.[1] ?? '').split(',').map((s) => s.trim())

const LIST =
  '<div class="root"><p if="tasks.loading">Loading</p><p else-if="tasks.error">{tasks.error.message}</p><ul else><li each="t in tasks.data" key="t.id">{t.title}</li></ul></div>'

describe('get, post, put, patch and del need no import', () => {
  it('imports each one a script uses from the core package', () => {
    for (const name of ['get', 'post', 'put', 'patch', 'del']) {
      const result = build(page(`const r = ${name}('/x')`, '<div class="root"></div>'))
      expect(result.diagnostics).toEqual([])
      expect(
        importedFromCore(page(`const r = ${name}('/x')`, '<div class="root"></div>')),
      ).toContain(name)
    }
  })

  it('imports only the ones that are used, and not a name the script declares or imports itself', () => {
    const used = importedFromCore(
      page("const a = get('/a')\nconst b = post('/b')", '<div class="root"></div>'),
    )
    expect(used).toContain('get')
    expect(used).toContain('post')
    expect(used).not.toContain('put')
    expect(
      importedFromCore(
        page('function get(x) { return x }\nconst a = get(1)', '<div class="root"></div>'),
      ),
    ).not.toContain('get')
    expect(
      importedFromCore(
        page("import { get } from './mine'\nconst a = get(1)", '<div class="root"></div>'),
      ),
    ).not.toContain('get')
  })

  it('does not take a method that is called on something else, such as a Map', () => {
    const source = page(
      "const cache = new Map()\nconst v = cache.get('a')",
      '<div class="root"></div>',
    )
    expect(importedFromCore(source)).not.toContain('get')
  })

  it('says what to import when auto-imports are off', () => {
    expect(
      issues(page("const a = get('/a')", '<div class="root"></div>'), { autoImports: false }),
    ).toEqual([
      'T5003 "get" is not defined. Auto-imports are off, so it must be imported. | Add: import { get } from "@pixelscriptio/tessera/core"',
    ])
  })
})

describe('a read in a template', () => {
  it('unwraps data, error, loading and refreshing, and leaves refresh() alone', () => {
    const code = build(
      page(
        "const tasks = get('/tasks')",
        LIST.replace('</div>', '<button @click="tasks.refresh()">Reload</button></div>'),
      ),
    ).code
    expect(code).toContain('tasks.loading.value')
    expect(code).toContain('tasks.error.value.message')
    expect(code).toContain('tasks.data.value')
    expect(code).toContain('tasks.refresh()')
    expect(code).not.toContain('$u(tasks)')
    expect(code).not.toContain('tasks.refresh.value')
  })

  it('knows a read written with a type argument, and a read of another api', () => {
    const typed = build(page("const tasks = get<Task[]>('/tasks')", LIST)).code
    expect(typed).toContain('tasks.data.value')
    const other = build(page("const tasks = github.get('/tasks')", LIST), { apis: [github] }).code
    expect(other).toContain('tasks.data.value')
    expect(other).toContain('import github from "../apis/github.ts"')
  })

  it('does not take any other call named get for a read', () => {
    const code = build(
      page(
        "const params = new URLSearchParams()\nconst tasks = params.get('x')",
        '<div class="root">{tasks.length}</div>',
      ),
    ).code
    expect(code).toContain('$u(tasks).length')
    expect(code).not.toContain('tasks.data')
  })

  it('does not take a get the script defines for a read', () => {
    const code = build(
      page(
        'function get() { return { data: [1] } }\nconst tasks = get()',
        '<div class="root">{tasks.data.length}</div>',
      ),
    ).code
    expect(code).not.toContain('tasks.data.value')
  })

  it('gives the whole read to a function, as it is', () => {
    const code = build(
      page(
        "const tasks = get('/tasks')\nconst describe = (r) => r",
        '<div class="root" :title="describe(tasks)"></div>',
      ),
    ).code
    // The name is the read itself, not a signal to unwrap.
    expect(code).toContain('describe(tasks)')
    expect(code).not.toContain('$u(tasks)')
    expect(code).not.toContain('tasks.value')
  })

  it('unwraps what is destructured from a read, by what each name is', () => {
    const code = build(
      page(
        "const { data: tasks, loading, error, refresh } = get('/tasks')",
        '<div class="root"><p if="loading">…</p><p else-if="error">{error.message}</p><ul else><li each="t in tasks" key="t.id">{t.title}</li></ul><button @click="refresh()">Reload</button></div>',
      ),
    ).code
    expect(code).toContain('loading.value')
    expect(code).toContain('error.value.message')
    expect(code).toContain('tasks.value')
    expect(code).toContain('refresh()')
    expect(code).not.toContain('$u(refresh)')
    expect(code).not.toContain('refresh.value')
  })
})

describe('a write in a template', () => {
  it('unwraps pending, error and data, and calls the write as a function', () => {
    const code = build(
      page(
        "const add = post('/tasks')",
        '<div class="root"><button :disabled="add.pending" @click="add({ title: \'x\' })">Add</button><p if="add.error">{add.error.message}</p><p>{add.data}</p></div>',
      ),
    ).code
    expect(code).toContain('add.pending.value')
    expect(code).toContain('add.error.value.message')
    expect(code).toContain('add.data.value')
    expect(code).toContain("add({ title: 'x' })")
    expect(code).not.toContain('$u(add)')
  })

  it('unwraps what is destructured from a write', () => {
    const code = build(
      page(
        "const { pending, error: failure } = post('/tasks')",
        '<div class="root"><p if="pending">…</p><p else-if="failure">{failure.message}</p></div>',
      ),
    ).code
    expect(code).toContain('pending.value')
    expect(code).toContain('failure.value.message')
  })
})

describe('the apis of the project', () => {
  it('imports an api a script names, relative to the file, and no other', () => {
    const code = build(
      page("const a = github.get('/users/:name', { name: 'x' })", '<div class="root"></div>'),
      {
        apis: [github, { name: 'weather', file: '/project/app/apis/weather.ts' }],
      },
    ).code
    expect(code).toContain('import github from "../apis/github.ts"')
    expect(code).not.toContain('weather')
  })

  it('leaves a name alone that the script declares or imports itself', () => {
    const own = build(
      page("const github = makeApi()\nconst a = github.get('/x')", '<div class="root"></div>'),
      { apis: [github] },
    ).code
    expect(own).not.toContain('../apis/github')
    const imported = build(
      page(
        "import github from './elsewhere'\nconst a = github.get('/x')",
        '<div class="root"></div>',
      ),
      { apis: [github] },
    ).code
    expect(imported).not.toContain('../apis/github')
  })

  it('suggests the api when its name is mistyped', () => {
    expect(
      issues(page("const a = gihub.get('/users/x')", '<div class="root"></div>'), {
        apis: [github],
      }),
    ).toEqual(['T5004 "gihub" is not an API. | Did you mean "github"?'])
  })

  it('does not call a name an unknown api when nothing is close to it', () => {
    expect(
      issues(
        page(
          "const v = Reflect.get({}, 'a')\nconst s = localStorage.get('a')",
          '<div class="root"></div>',
        ),
        { apis: [github] },
      ),
    ).toEqual([])
  })

  it('makes get, post and the rest use app/apis/default.ts when there is one', () => {
    const code = build(page("const tasks = get('/tasks')\nconst add = post('/tasks')", LIST), {
      apis: [fallback],
    }).code
    expect(code).toContain('import $defaultApi from "../apis/default.ts"')
    expect(code).toMatch(/const \{[^}]*\bget\b[^}]*\} = \$defaultApi/)
    expect(code).toMatch(/const \{[^}]*\bpost\b[^}]*\} = \$defaultApi/)
    expect(
      importedFromCore(page("const tasks = get('/tasks')", LIST), { apis: [fallback] }),
    ).not.toContain('get')
    // And it is still a read, so its data unwraps.
    expect(code).toContain('tasks.data.value')
  })

  it('leaves the shared api alone when there is no default', () => {
    const code = build(page("const tasks = get('/tasks')", LIST), { apis: [github] }).code
    expect(code).not.toContain('$defaultApi')
    expect(
      importedFromCore(page("const tasks = get('/tasks')", LIST), { apis: [github] }),
    ).toContain('get')
  })
})

describe('data that can fail, in a template that does not say so (W4105)', () => {
  const warn = (script: string, template: string, options: Partial<CompileOptions> = {}) =>
    build(page(script, template), options).diagnostics.filter((d) => d.code === 'W4105')

  it('warns when data is shown and neither loading nor error is', () => {
    const [d] = warn(
      "const tasks = get('/tasks')",
      '<div class="root"><ul><li each="t in tasks.data" key="t.id">{t.title}</li></ul></div>',
    )
    expect(d!.severity).toBe('warning')
    expect(d!.message).toBe(
      "get('/tasks') can be slow and can fail, but this template never shows loading or error.",
    )
    expect(d!.hint).toContain('<p if="tasks.loading">')
    expect(d!.hint).toContain('tasks.error')
    expect([d!.line, d!.column]).toEqual([2, 15])
  })

  it('names the one that is missing', () => {
    const [noError] = warn(
      "const tasks = get('/tasks')",
      '<div class="root"><p if="tasks.loading">…</p><ul else><li each="t in tasks.data" key="t.id">{t.title}</li></ul></div>',
    )
    expect(noError!.message).toContain('never shows error.')
    const [noLoading] = warn(
      "const tasks = get('/tasks')",
      '<div class="root"><p if="tasks.error">{tasks.error.message}</p><ul else><li each="t in tasks.data" key="t.id">{t.title}</li></ul></div>',
    )
    expect(noLoading!.message).toContain('never shows loading.')
  })

  it('is quiet when both are handled, or when the data is not shown, or when the whole read is given to someone else', () => {
    expect(warn("const tasks = get('/tasks')", LIST)).toEqual([])
    expect(
      warn(
        "const tasks = get('/tasks')",
        '<div class="root"><button @click="tasks.refresh()">Again</button></div>',
      ),
    ).toEqual([])
    expect(
      warn(
        "const tasks = get('/tasks')\nconst describe = (r) => r",
        '<div class="root"><p>{describe(tasks)}</p></div>',
      ),
    ).toEqual([])
  })

  it('does not count refreshing as loading', () => {
    const [d] = warn(
      "const tasks = get('/tasks')",
      '<div class="root"><p if="tasks.refreshing">…</p><p if="tasks.error">x</p><ul><li each="t in tasks.data" key="t.id">{t.title}</li></ul></div>',
    )
    expect(d!.message).toContain('never shows loading.')
  })

  it('reads the same through destructuring, and names a part that was never taken', () => {
    const [d] = warn(
      "const { data: tasks, loading } = get('/tasks')",
      '<div class="root"><p if="loading">…</p><ul else><li each="t in tasks" key="t.id">{t.title}</li></ul></div>',
    )
    expect(d!.message).toContain('never shows error.')
    expect(
      warn(
        "const { data: tasks, loading, error } = get('/tasks')",
        '<div class="root"><p if="loading">…</p><p else-if="error">x</p><ul else><li each="t in tasks" key="t.id">{t.title}</li></ul></div>',
      ),
    ).toEqual([])
  })

  it('says it for each read, with the api it is made on', () => {
    const found = warn(
      "const a = github.get('/users/x')\nconst b = get('/tasks')",
      '<div class="root"><p>{a.data.name}</p><p>{b.data.length}</p></div>',
      { apis: [github] },
    )
    expect(found.map((d) => d.message.split(' can be')[0])).toEqual([
      "github.get('/users/x')",
      "get('/tasks')",
    ])
  })

  it('is not about a write', () => {
    expect(warn("const add = post('/tasks')", '<div class="root"><p>{add.data}</p></div>')).toEqual(
      [],
    )
  })

  it('can be turned off for a path, or made an error that a baseline can hold', () => {
    const diagnostics = build(
      page("const tasks = get('/tasks')", '<div class="root"><p>{tasks.data}</p></div>'),
    ).diagnostics
    expect(diagnostics.map((d) => d.code)).toEqual(['W4105'])
    const off = applySeverity(
      FILE,
      diagnostics,
      { severity: [{ files: 'app/pages/**', rules: 'W4105', level: 'off', reason: 'later' }] },
      '2026-10-25',
    )
    expect(off).toEqual([])
    const strict = applySeverity(
      FILE,
      diagnostics,
      { severity: [{ files: 'app/**', rules: '*', level: 'error' }] },
      '2026-10-25',
    )
    expect(strict.map((d) => d.severity)).toEqual(['error'])
    const baseline = createBaseline([{ file: FILE, diagnostics: strict }])
    expect(baseline.files[FILE]).toEqual({ W4105: 1 })
    const held = applyBaseline(FILE, strict, baseline)
    expect(held.diagnostics).toEqual([])
  })
})

describe('the app/apis folder', () => {
  const project = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'tessera-apis-')).replaceAll('\\', '/')
    mkdirSync(join(root, 'app', 'apis'), { recursive: true })
    for (const [name, content] of Object.entries(files))
      writeFileSync(join(root, 'app', 'apis', name), content)
    return root
  }

  it('makes an api of each script file, named after the file', () => {
    const root = project({
      'github.ts': 'export default 1',
      'weather.js': 'export default 1',
      'maps.mts': 'export default 1',
      'default.ts': 'export default 1',
    })
    const loaded = loadProjectApis(root)
    expect(loaded.apis.map((a) => a.name)).toEqual(['default', 'github', 'maps', 'weather'])
    expect(loaded.apis[1]).toEqual({ name: 'github', file: `${root}/app/apis/github.ts` })
    expect(loaded.diagnostics).toEqual([])
  })

  it('leaves out what is not an api: declarations, tests, descriptions, notes', () => {
    const root = project({
      'github.ts': 'export default 1',
      'github.d.ts': '',
      'github.test.ts': '',
      'github.spec.ts': '',
      'github.api.json': '{}',
      'README.md': '',
    })
    expect(loadProjectApis(root).apis.map((a) => a.name)).toEqual(['github'])
  })

  it('says when a file name is not a name a script can use, or is taken by Tessera', () => {
    const root = project({
      'my-api.ts': 'export default 1',
      '2fast.ts': 'export default 1',
      'state.ts': 'export default 1',
      'get.ts': 'export default 1',
      'class.ts': 'export default 1',
      'ok.ts': 'export default 1',
    })
    const loaded = loadProjectApis(root)
    expect(loaded.apis.map((a) => a.name)).toEqual(['ok'])
    expect(loaded.diagnostics.map((d) => `${d.code} ${d.file} ${d.message}`)).toEqual([
      'T5005 app/apis/2fast.ts "2fast" cannot be the name of an api: it is not a name a script can use.',
      'T5005 app/apis/class.ts "class" cannot be the name of an api: it is not a name a script can use.',
      'T5005 app/apis/get.ts "get" cannot be the name of an api: Tessera already uses it.',
      'T5005 app/apis/my-api.ts "my-api" cannot be the name of an api: it is not a name a script can use.',
      'T5005 app/apis/state.ts "state" cannot be the name of an api: Tessera already uses it.',
    ])
  })

  it('has no apis when the folder is not there', () => {
    const root = mkdtempSync(join(tmpdir(), 'tessera-noapis-')).replaceAll('\\', '/')
    expect(loadProjectApis(root)).toMatchObject({ apis: [], diagnostics: [] })
  })
})
