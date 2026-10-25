import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseApiDescription } from '../src/api-description'
import { compile, type CompileOptions } from '../src/compile'
import { loadProjectApis } from '../src/node'
import { generateApisDts } from '../src/apis'

const TODOS = `{
  "types": {
    "Todo": { "id": "number", "title": "string", "done": "boolean", "due": "string?", "owner": "User", "note": "string | null" },
    "User": { "name": "string", "email": "string" },
    "NewTodo": { "title": "string", "done": "boolean?" }
  },
  "paths": {
    "/todos": {
      "get": { "query": { "done": "boolean?", "page": "number" }, "returns": "Todo[]" },
      "post": { "body": "NewTodo", "returns": "Todo" }
    },
    "/todos/:id": {
      "get": { "returns": "Todo" },
      "delete": {}
    },
    "/me": { "get": { "returns": "User" } },
    "/ping": { "get": {} }
  }
}`

const description = parseApiDescription(TODOS, 'todos.api.json').description!
const todos = { name: 'todos', file: '/project/app/apis/todos.ts', description }
const plain = { name: 'plain', file: '/project/app/apis/plain.ts' }
const fallback = { name: 'default', file: '/project/app/apis/default.ts', description }

const FILE = 'app/pages/Tasks.tess'
const PATH = '/project/app/pages/Tasks.tess'

const page = (script: string, template = '<div class="root"></div>') =>
  `<script>\n${script}\n</script>\n<template>${template}</template>`

const check = (source: string, options: Partial<CompileOptions> = {}) =>
  compile(source, {
    file: FILE,
    path: PATH,
    kind: 'page',
    apis: [todos, plain, fallback],
    ...options,
  })
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.code} ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a call that the description does not have (T5006)', () => {
  it('passes a call to an endpoint it has, written with the name or with a value in its place', () => {
    expect(
      check(
        page(
          "const a = todos.get('/todos', { page: 1 })\nconst b = todos.get('/todos/:id', { id: 7 })\nconst c = todos.get('/todos/7')",
        ),
      ),
    ).toEqual([])
    expect(
      check(page("const a = todos.post('/todos')\nconst b = todos.del('/todos/:id')")),
    ).toEqual([])
  })

  it('says the path is not there, and the nearest', () => {
    expect(check(page("const a = todos.get('/todo', { page: 1 })"))).toEqual([
      'T5006 The description of "todos" has no GET /todo. | Did you mean "/todos"?',
    ])
    expect(check(page("const a = todos.get('/nothing-like-it')"))).toEqual([
      'T5006 The description of "todos" has no GET /nothing-like-it.',
    ])
  })

  it('says the path is there, with other methods', () => {
    expect(check(page("const a = todos.put('/todos/:id', {})"))).toEqual([
      'T5006 The description of "todos" has no PUT /todos/:id. | /todos/:id has GET and DELETE.',
    ])
    expect(check(page("const a = todos.patch('/todos')"))).toEqual([
      'T5006 The description of "todos" has no PATCH /todos. | /todos has GET and POST.',
    ])
  })

  it('does not judge a full URL, a path that is built, an api with no description, or a call on the shared api', () => {
    expect(check(page("const a = todos.get('https://other.example.com/x')"))).toEqual([])
    expect(check(page("const p = '/todo'\nconst a = todos.get(p)"))).toEqual([])
    expect(check(page("const a = plain.get('/anything')"))).toEqual([])
    expect(check(page("const a = get('/anything')"), { apis: [todos, plain] })).toEqual([])
  })

  it('takes the description of the default api for a call with no name', () => {
    expect(check(page("const a = get('/todo')"))).toEqual([
      'T5006 The description of "default" has no GET /todo. | Did you mean "/todos"?',
    ])
    expect(check(page("const a = get('/todos', { page: 1 })"))).toEqual([])
  })
})

describe('parameters that the endpoint does not take (T5007)', () => {
  it('says a parameter is not one, with the nearest', () => {
    expect(check(page("const a = todos.get('/todos', { page: 1, pge: 2 })"))).toEqual([
      'T5007 "pge" is not a parameter of GET /todos. | Did you mean "page"?',
    ])
    expect(check(page("const a = todos.get('/todos', { page: 1, nothing: 2 })"))).toEqual([
      'T5007 "nothing" is not a parameter of GET /todos. | GET /todos takes done and page.',
    ])
  })

  it('says a parameter in the path has no value, and a query that is required', () => {
    expect(check(page("const a = todos.get('/todos/:id')"))).toEqual([
      'T5007 GET /todos/:id needs a value for "id".',
    ])
    expect(check(page("const a = todos.get('/todos/:id', {})"))).toEqual([
      'T5007 GET /todos/:id needs a value for "id".',
    ])
    expect(check(page("const a = todos.get('/todos', { done: true })"))).toEqual([
      'T5007 GET /todos needs a value for "page".',
    ])
    expect(check(page("const a = todos.get('/todos')"))).toEqual([
      'T5007 GET /todos needs a value for "page".',
    ])
  })

  it('takes a shorthand name, a computed value and a signal as a value', () => {
    expect(check(page("const page = state(1)\nconst a = todos.get('/todos', { page })"))).toEqual(
      [],
    )
    expect(
      check(page("const id = state(1)\nconst a = todos.get('/todos/:id', { id: id.value + 1 })")),
    ).toEqual([])
  })

  it('does not judge parameters it cannot see: a function, a variable or a spread', () => {
    expect(check(page("const a = todos.get('/todos', () => ({ whatever: 1 }))"))).toEqual([])
    expect(check(page("const p = { whatever: 1 }\nconst a = todos.get('/todos', p)"))).toEqual([])
    expect(
      check(page("const p = { page: 1 }\nconst a = todos.get('/todos', { ...p, whatever: 1 })")),
    ).toEqual([])
  })

  it('does not ask for what a value in the path already gives', () => {
    expect(check(page("const a = todos.get('/todos/7')"))).toEqual([])
  })
})

describe('fields that the answer does not have (T5008)', () => {
  const LIST = (field: string) =>
    `<div class="root"><p if="tasks.loading">…</p><p else-if="tasks.error">{tasks.error.message}</p><ul else><li each="t in tasks.data" key="t.id">{t.${field}}</li></ul></div>`
  const read = "const tasks = todos.get('/todos', { page: 1 })"

  it('passes the fields the type has, in a list, in an item and in what the item refers to', () => {
    expect(check(page(read, LIST('title')))).toEqual([])
    expect(check(page(read, LIST('owner.name')))).toEqual([])
    expect(check(page(read, LIST('due')))).toEqual([])
    expect(check(page(read, '<div class="root">{tasks.data.length}</div>'))).toEqual([])
  })

  it('says a field is not there, with the nearest, and what the type has', () => {
    expect(check(page(read, LIST('titel')))).toEqual([
      'T5008 "Todo" has no field "titel". | Did you mean "title"?',
    ])
    expect(check(page(read, LIST('owner.nmae')))).toEqual([
      'T5008 "User" has no field "nmae". | Did you mean "name"?',
    ])
    expect(check(page(read, LIST('zzzzzzzz')))).toEqual([
      'T5008 "Todo" has no field "zzzzzzzz". | It has id, title, done, due, owner and note.',
    ])
  })

  it('knows the error of a read: status, message, body, method and url', () => {
    expect(
      check(
        page(
          read,
          '<div class="root"><p if="tasks.error">{tasks.error.status} {tasks.error.body}</p></div>',
        ),
      ),
    ).toEqual([])
    expect(
      check(page(read, '<div class="root"><p if="tasks.error">{tasks.error.statuss}</p></div>')),
    ).toEqual(['T5008 "ApiError" has no field "statuss". | Did you mean "status"?'])
  })

  it('follows a read that is taken apart', () => {
    const taken = "const { data: tasks, error } = todos.get('/todos', { page: 1 })"
    const template = (field: string) =>
      `<div class="root"><p if="error">{error.message}</p><ul else><li each="t in tasks" key="t.id">{t.${field}}</li></ul></div>`
    expect(check(page(taken, template('title')))).toEqual([])
    expect(check(page(taken, template('titel')))).toEqual([
      'T5008 "Todo" has no field "titel". | Did you mean "title"?',
    ])
  })

  it('follows a read of one thing, and of a field that can be empty', () => {
    const one = "const me = todos.get('/me')"
    expect(check(page(one, '<div class="root"><p>{me.data.name}</p></div>'))).toEqual([])
    expect(check(page(one, '<div class="root"><p>{me.data.nmae}</p></div>'))).toEqual([
      'T5008 "User" has no field "nmae". | Did you mean "name"?',
    ])
    expect(check(page(read, LIST('note')))).toEqual([])
  })

  it('says nothing when it cannot know: an api with no description, an answer that is nothing, a call on the data', () => {
    expect(check(page("const tasks = plain.get('/todos')", LIST('whatever')))).toEqual([])
    expect(
      check(
        page(
          "const ping = todos.get('/ping')",
          '<div class="root"><p>{ping.data.anything}</p></div>',
        ),
      ),
    ).toEqual([])
    expect(
      check(page(read, '<div class="root"><p>{tasks.data.map((t) => t.whatever)}</p></div>')),
    ).toEqual([])
  })

  it('does not stop at a field of something it did not type', () => {
    expect(check(page(read, '<div class="root">{tasks.refresh}</div>'))).toEqual([])
    expect(
      check(page(read + '\nconst other = { a: 1 }', '<div class="root">{other.zzz}</div>')),
    ).toEqual([])
  })
})

describe('app/apis with descriptions', () => {
  const project = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'tessera-desc-')).replaceAll('\\', '/')
    mkdirSync(join(root, 'app', 'apis'), { recursive: true })
    for (const [name, content] of Object.entries(files))
      writeFileSync(join(root, 'app', 'apis', name), content)
    return root
  }

  it('reads the description that sits beside an api', () => {
    const root = project({
      'todos.ts': 'export default 1',
      'todos.api.json': TODOS,
      'plain.ts': 'export default 1',
    })
    const loaded = loadProjectApis(root)
    expect(loaded.diagnostics).toEqual([])
    const [plainApi, todosApi] = loaded.apis
    expect(plainApi!.name).toBe('plain')
    expect(plainApi!.description).toBeUndefined()
    expect(todosApi!.description!.endpoints).toHaveLength(6)
  })

  it('reports a description that is wrong, at its file, and still has the api', () => {
    const root = project({ 'todos.ts': 'export default 1', 'todos.api.json': '{ "pahts": {} }' })
    const loaded = loadProjectApis(root)
    expect(loaded.apis.map((a) => a.name)).toEqual(['todos'])
    expect(loaded.apis[0]!.description).toBeUndefined()
    expect(loaded.diagnostics.map((d) => `${d.code} ${d.file} ${d.message}`)).toEqual([
      'T5009 app/apis/todos.api.json "pahts" is not a part of an API description.',
    ])
  })

  it('says a description has no api, and the one it is probably for', () => {
    const root = project({ 'todos.ts': 'export default 1', 'todoz.api.json': TODOS })
    const loaded = loadProjectApis(root)
    expect(loaded.diagnostics.map((d) => `${d.code} ${d.file} ${d.message} | ${d.hint}`)).toEqual([
      'T5009 app/apis/todoz.api.json There is no API for this description: app/apis/todoz.ts does not exist. | Did you mean "todos"?',
    ])
  })
})

describe('types for the editor and for TypeScript', () => {
  it('writes each type of each description, and the endpoints', () => {
    const text = generateApisDts([todos, plain])
    expect(text).toContain('declare namespace TesseraApis {')
    expect(text).toContain('namespace todos {')
    expect(text).toContain('interface Todo {')
    expect(text).toContain('id: number')
    expect(text).toContain('due?: string')
    expect(text).toContain('owner: User')
    expect(text).toContain('note: string | null')
    expect(text).toContain('interface NewTodo {')
    expect(text).toContain(
      "'GET /todos': { query: { done?: boolean; page: number }; returns: Todo[] }",
    )
    expect(text).toContain("'POST /todos': { body: NewTodo; returns: Todo }")
    expect(text).toContain("'DELETE /todos/:id': { returns: void }")
    expect(text).not.toContain('namespace plain')
  })
})
