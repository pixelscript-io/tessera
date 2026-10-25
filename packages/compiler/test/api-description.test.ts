import { describe, expect, it } from 'vitest'
import {
  describeType,
  fieldOf,
  matchEndpoint,
  parseApiDescription,
  parseTypeString,
  resolveType,
  type ApiDescription,
  type ApiType,
} from '../src/api-description'

const TODOS = `{
  "base": "https://example.com/api",
  "types": {
    "Todo": { "id": "number", "title": "string", "done": "boolean", "due": "string?" },
    "NewTodo": { "title": "string", "done": "boolean?" },
    "Status": "'open' | 'done'"
  },
  "paths": {
    "/todos": {
      "get": { "query": { "done": "boolean?", "page": "number?" }, "returns": "Todo[]" },
      "post": { "body": "NewTodo", "returns": "Todo" }
    },
    "/todos/:id": {
      "get": { "returns": "Todo", "errors": { "404": "There is no such to-do" } },
      "put": { "body": "NewTodo", "returns": "Todo" },
      "delete": {}
    }
  }
}`

const ty = (text: string) => (parseTypeString(text) as { type: ApiType }).type
const parse = (source: string) => parseApiDescription(source, 'app/apis/todos.api.json')
const ok = (source: string): ApiDescription => {
  const result = parse(source)
  expect(result.diagnostics).toEqual([])
  return result.description!
}
const problems = (source: string) =>
  parse(source).diagnostics.map(
    (d) => `${d.code} ${d.line}:${d.column} ${d.message}${d.hint ? ` | ${d.hint}` : ''}`,
  )

describe('type strings', () => {
  it('reads the base types, lists, unions, literals and optional', () => {
    expect(parseTypeString('string')).toEqual({ type: { kind: 'string' }, optional: false })
    expect(parseTypeString('number?')).toEqual({ type: { kind: 'number' }, optional: true })
    expect(parseTypeString('Todo[]')).toEqual({
      type: { kind: 'array', of: { kind: 'ref', name: 'Todo' } },
      optional: false,
    })
    expect(parseTypeString('string[][]?')).toEqual({
      type: { kind: 'array', of: { kind: 'array', of: { kind: 'string' } } },
      optional: true,
    })
    expect(parseTypeString("'open' | 'done'")).toEqual({
      type: {
        kind: 'union',
        of: [
          { kind: 'literal', value: 'open' },
          { kind: 'literal', value: 'done' },
        ],
      },
      optional: false,
    })
    expect(ty('string | null')).toEqual({
      kind: 'union',
      of: [{ kind: 'string' }, { kind: 'null' }],
    })
    expect(ty('object')).toEqual({ kind: 'object' })
    expect(ty('unknown')).toEqual({ kind: 'unknown' })
  })

  it('says what is wrong with a type it cannot read', () => {
    expect(parseTypeString('')).toEqual({ error: 'A type is empty.' })
    expect(parseTypeString('string |')).toEqual({ error: 'A type is missing after "|".' })
    expect(parseTypeString("'open")).toEqual({ error: 'The text "\'open" is not closed.' })
    expect(parseTypeString('Todo[')).toEqual({
      error: '"Todo[" is not a type. A list is written Todo[].',
    })
    expect(parseTypeString('a b')).toEqual({ error: '"a b" is not a type.' })
  })

  it('describes a type the way it is written', () => {
    expect(describeType({ kind: 'array', of: { kind: 'ref', name: 'Todo' } })).toBe('Todo[]')
    expect(describeType(ty("'open' | 'done'"))).toBe("'open' | 'done'")
    expect(describeType({ kind: 'fields', fields: {} })).toBe('an object')
  })
})

describe('a description', () => {
  it('has endpoints in file order, each with its method, path, query, body and return', () => {
    const d = ok(TODOS)
    expect(d.base).toBe('https://example.com/api')
    expect(d.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
      'GET /todos',
      'POST /todos',
      'GET /todos/:id',
      'PUT /todos/:id',
      'DELETE /todos/:id',
    ])
    const list = d.endpoints[0]!
    expect(list.query.done).toEqual({ type: { kind: 'boolean' }, optional: true })
    expect(list.returns).toEqual({ kind: 'array', of: { kind: 'ref', name: 'Todo' } })
    expect(d.endpoints[1]!.body).toEqual({ kind: 'ref', name: 'NewTodo' })
    expect(d.endpoints[2]!.errors).toEqual({ '404': 'There is no such to-do' })
    expect(d.endpoints[4]!.returns).toBeUndefined()
  })

  it('has types that are objects, or a name for another type', () => {
    const d = ok(TODOS)
    expect(Object.keys(d.types)).toEqual(['Todo', 'NewTodo', 'Status'])
    expect(d.types.Todo).toMatchObject({ kind: 'fields' })
    expect(fieldOf(d, d.types.Todo!, 'due')).toEqual({ type: { kind: 'string' }, optional: true })
    expect(d.types.Status).toMatchObject({ kind: 'union' })
  })

  it('takes a type written as an object, inside a type or at a field', () => {
    const d = ok(`{
      "types": { "User": { "name": "string", "address": { "city": "string", "zip?": "string" }, "tags?": "string[]" } },
      "paths": { "/me": { "get": { "returns": { "user": "User", "count": "number" } } } }
    }`)
    const user = d.types.User!
    expect(describeType(fieldOf(d, user, 'address')!.type)).toBe('an object')
    expect(fieldOf(d, user, 'tags')!.optional).toBe(true)
    const address = fieldOf(d, user, 'address')!.type
    expect(fieldOf(d, address, 'zip')).toEqual({ type: { kind: 'string' }, optional: true })
    expect(fieldOf(d, d.endpoints[0]!.returns!, 'count')).toEqual({
      type: { kind: 'number' },
      optional: false,
    })
  })

  it('does not need types, or a base', () => {
    const d = ok('{ "paths": { "/ping": { "get": {} } } }')
    expect(d.types).toEqual({})
    expect(d.base).toBeUndefined()
    expect(d.endpoints).toHaveLength(1)
  })

  /** Where `snippet` starts in `source`, as `1:column`. */
  const at = (source: string, snippet: string, from = 0) => `1:${source.indexOf(snippet, from) + 1}`

  it('reports a file that is not JSON, at the place', () => {
    const source = '{ "paths": { "/a": { "get": { "returns": } } } }'
    expect(problems(source)).toEqual([
      `T5009 ${at(source, '} } }')} This is not a valid API description: Unexpected character "}".`,
    ])
  })

  it('reports an unknown key, a bad method and a bad path, with the nearest', () => {
    const top = '{ "pahts": {} }'
    expect(problems(top)).toEqual([
      `T5009 ${at(top, '"pahts"')} "pahts" is not a part of an API description. | Did you mean "paths"?`,
    ])
    const method = '{ "paths": { "/a": { "gett": {} } } }'
    expect(problems(method)).toEqual([
      `T5009 ${at(method, '"gett"')} "gett" is not a method. | Did you mean "get"? The methods are get, post, put, patch and delete.`,
    ])
    const path = '{ "paths": { "todos": { "get": {} } } }'
    expect(problems(path)).toEqual([
      `T5009 ${at(path, '"todos"')} The path "todos" must start with "/".`,
    ])
    const part = '{ "paths": { "/a": { "get": { "retruns": "string" } } } }'
    expect(problems(part)).toEqual([
      `T5009 ${at(part, '"retruns"')} "retruns" is not a part of an endpoint. | Did you mean "returns"?`,
    ])
  })

  it('reports a type that does not exist, with the nearest', () => {
    const near =
      '{ "types": { "Todo": { "id": "number" } }, "paths": { "/a": { "get": { "returns": "Todoo[]" } } } }'
    expect(problems(near)).toEqual([
      `T5009 ${at(near, '"Todoo[]"')} Unknown type "Todoo". | Did you mean "Todo"?`,
    ])
    const far = '{ "types": { "Todo": { "owner": "Usr" } } }'
    expect(problems(far)).toEqual([`T5009 ${at(far, '"Usr"')} Unknown type "Usr".`])
  })

  it('allows a type to refer to itself, and to a type further down', () => {
    expect(
      problems(
        '{ "types": { "Node": { "children": "Node[]", "owner": "User" }, "User": { "name": "string" } } }',
      ),
    ).toEqual([])
  })

  it('reports a type string that cannot be read, where it is', () => {
    const source = '{ "types": { "A": { "x": "string |" } } }'
    expect(problems(source)).toEqual([
      `T5009 ${at(source, '"string |"')} A type is missing after "|".`,
    ])
  })

  it('reports a path parameter that the path does not have, in the query', () => {
    const source = '{ "paths": { "/todos/:id": { "get": { "query": { "id": "number" } } } } }'
    expect(problems(source)).toEqual([
      `T5009 ${at(source, '"id": "number"')} "id" is already in the path as :id. A query is for what is not in the path.`,
    ])
  })
})

describe('finding the endpoint of a call', () => {
  const d = () => ok(TODOS)

  it('matches a pattern, a value in place of a :name, and ignores a query or a trailing slash', () => {
    expect(matchEndpoint(d(), 'GET', '/todos/:id')).toMatchObject({
      kind: 'found',
      endpoint: { path: '/todos/:id' },
    })
    expect(matchEndpoint(d(), 'GET', '/todos/7')).toMatchObject({
      kind: 'found',
      endpoint: { path: '/todos/:id' },
    })
    expect(matchEndpoint(d(), 'GET', '/todos?done=true')).toMatchObject({
      kind: 'found',
      endpoint: { path: '/todos' },
    })
    expect(matchEndpoint(d(), 'GET', '/todos/')).toMatchObject({
      kind: 'found',
      endpoint: { path: '/todos' },
    })
  })

  it('says the method is not there, and what the path has', () => {
    expect(matchEndpoint(d(), 'DELETE', '/todos')).toEqual({
      kind: 'method',
      path: '/todos',
      has: ['GET', 'POST'],
    })
    expect(matchEndpoint(d(), 'PATCH', '/todos/:id')).toEqual({
      kind: 'method',
      path: '/todos/:id',
      has: ['GET', 'PUT', 'DELETE'],
    })
  })

  it('says there is no such path, and the nearest one', () => {
    expect(matchEndpoint(d(), 'GET', '/todo')).toEqual({ kind: 'none', nearest: '/todos' })
    expect(matchEndpoint(d(), 'GET', '/todos/:idd')).toMatchObject({ kind: 'found' })
    expect(matchEndpoint(d(), 'GET', '/users')).toEqual({ kind: 'none', nearest: undefined })
  })

  it('does not judge a path that is not a path of this api', () => {
    expect(matchEndpoint(d(), 'GET', 'https://other.example.com/x')).toEqual({ kind: 'outside' })
  })
})

describe('what a type has', () => {
  const d = () => ok(TODOS)

  it('resolves a name to its type, through another name', () => {
    expect(resolveType(d(), { kind: 'ref', name: 'Todo' })).toMatchObject({ kind: 'fields' })
    const aliased = ok('{ "types": { "A": "B", "B": { "x": "string" } } }')
    expect(resolveType(aliased, { kind: 'ref', name: 'A' })).toMatchObject({ kind: 'fields' })
    expect(resolveType(d(), { kind: 'string' } as ApiType)).toEqual({ kind: 'string' })
  })

  it('has the fields of a type, and nothing for one that has none', () => {
    expect(fieldOf(d(), { kind: 'ref', name: 'Todo' }, 'title')).toEqual({
      type: { kind: 'string' },
      optional: false,
    })
    expect(fieldOf(d(), { kind: 'ref', name: 'Todo' }, 'titel')).toBeUndefined()
    expect(fieldOf(d(), { kind: 'string' }, 'length')).toBeUndefined()
  })
})
