import { describe, expect, it } from 'vitest'
import { parseApiDescription } from '../src/api-description'
import { convertOpenApi } from '../src/openapi'

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const json = (schema: unknown) => ({ content: { 'application/json': { schema } } })

const TODOS = {
  openapi: '3.1.0',
  info: { title: 'Todos', description: 'A to-do list' },
  servers: [{ url: '/api' }],
  paths: {
    '/todos': {
      get: {
        operationId: 'listTodos',
        parameters: [
          { name: 'done', in: 'query', schema: { type: 'boolean' } },
          { name: 'page', in: 'query', required: true, schema: { type: 'integer' } },
          { name: 'x-trace', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'The to-dos', ...json({ type: 'array', items: ref('Todo') }) },
        },
      },
      post: {
        requestBody: { required: true, ...json(ref('NewTodo')) },
        responses: { '201': { description: 'Created', ...json(ref('Todo')) } },
      },
    },
    '/todos/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      get: {
        responses: {
          '200': { description: 'The to-do', ...json(ref('Todo')) },
          '404': { description: 'There is no such to-do' },
        },
      },
      put: {
        requestBody: { required: true, ...json(ref('NewTodo')) },
        responses: { '200': { description: 'Updated', ...json(ref('Todo')) } },
      },
      delete: { responses: { '204': { description: 'Deleted' } } },
    },
  },
  components: {
    schemas: {
      Todo: {
        type: 'object',
        required: ['id', 'title', 'done'],
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          done: { type: 'boolean' },
          due: { type: 'string', format: 'date' },
        },
      },
      NewTodo: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string' }, done: { type: 'boolean' } },
      },
      Status: { type: 'string', enum: ['open', 'done'] },
    },
  },
}

const convert = (document: unknown) => {
  const result = convertOpenApi(document)
  if (!result.ok) throw new Error(result.error)
  return result
}

describe('OpenAPI into the small format', () => {
  it('turns paths, parameters, bodies and answers into endpoints, and schemas into types', () => {
    const { description, notes } = convert(TODOS)
    expect(description).toEqual({
      base: '/api',
      description: 'A to-do list',
      types: {
        Todo: { id: 'number', title: 'string', done: 'boolean', due: 'string?' },
        NewTodo: { title: 'string', done: 'boolean?' },
        Status: "'open' | 'done'",
      },
      paths: {
        '/todos': {
          get: {
            query: { done: 'boolean?', page: 'number' },
            returns: 'Todo[]',
            description: 'The to-dos',
          },
          post: { body: 'NewTodo', returns: 'Todo', description: 'Created' },
        },
        '/todos/:id': {
          get: {
            returns: 'Todo',
            errors: { '404': 'There is no such to-do' },
            description: 'The to-do',
          },
          put: { body: 'NewTodo', returns: 'Todo', description: 'Updated' },
          delete: { description: 'Deleted' },
        },
      },
    })
    expect(notes).toEqual([])
  })

  it('makes a file that the compiler reads without a problem', () => {
    const { description } = convert(TODOS)
    const parsed = parseApiDescription(JSON.stringify(description), 'todos.api.json')
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.description!.endpoints).toHaveLength(5)
  })

  it('reads a parameter and a body that are named in the components', () => {
    const { description } = convert({
      openapi: '3.0.3',
      info: { title: 'x' },
      paths: {
        '/a/{id}': {
          put: {
            parameters: [{ $ref: '#/components/parameters/Id' }],
            requestBody: { $ref: '#/components/requestBodies/Edit' },
            responses: { '200': { $ref: '#/components/responses/Ok' } },
          },
        },
      },
      components: {
        parameters: { Id: { name: 'id', in: 'path', required: true, schema: { type: 'string' } } },
        requestBodies: { Edit: json({ type: 'object', properties: { name: { type: 'string' } } }) },
        responses: { Ok: { description: 'Fine', ...json({ type: 'string' }) } },
      },
    })
    expect(description.paths['/a/:id'].put).toEqual({
      body: { name: 'string?' },
      returns: 'string',
      description: 'Fine',
    })
  })

  it('knows null in both ways it is written, lists, enums, maps and an object with no fields', () => {
    const { description } = convert({
      openapi: '3.1.0',
      info: { title: 'x' },
      paths: {},
      components: {
        schemas: {
          T: {
            type: 'object',
            required: ['a', 'b', 'c', 'd', 'e', 'f'],
            properties: {
              a: { type: ['string', 'null'] },
              b: { type: 'string', nullable: true },
              c: { type: 'array', items: { type: 'integer' } },
              d: { enum: [1, 2] },
              e: { type: 'object', additionalProperties: { type: 'string' } },
              f: { type: 'object' },
            },
          },
        },
      },
    })
    expect(description.types.T).toEqual({
      a: 'string | null',
      b: 'string | null',
      c: 'number[]',
      d: 'number',
      e: 'object',
      f: 'object',
    })
  })

  it('merges allOf of objects, and says what it does not read', () => {
    const { description, notes } = convert({
      openapi: '3.1.0',
      info: { title: 'x' },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            responses: {
              '200': json({ type: 'array', items: { oneOf: [ref('Cat'), ref('Dog')] } }),
            },
          },
        },
        '/upload': {
          post: {
            requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          Base: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
          Cat: {
            allOf: [ref('Base'), { type: 'object', properties: { lives: { type: 'integer' } } }],
          },
          Dog: {
            allOf: [ref('Base'), { type: 'object', properties: { bark: { type: 'boolean' } } }],
          },
        },
      },
    })
    expect(description.types.Cat).toEqual({ id: 'string', lives: 'number?' })
    expect(description.paths['/pets'].get.returns).toBe('unknown[]')
    expect(notes).toEqual([
      'GET /pets: oneOf is not read, so each item is unknown.',
      'POST /upload: a body of type multipart/form-data is not read.',
    ])
  })

  it('gives a name to an object that is written in place inside a list', () => {
    const { description } = convert({
      openapi: '3.1.0',
      info: { title: 'x' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': json({
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' } },
                },
              }),
            },
          },
        },
      },
    })
    expect(description.types).toEqual({ ListUsersItem: { name: 'string' } })
    expect(description.paths['/users'].get.returns).toBe('ListUsersItem[]')
  })

  it('takes a text answer as text, and no answer as none', () => {
    const { description } = convert({
      openapi: '3.1.0',
      info: { title: 'x' },
      paths: {
        '/v': {
          get: {
            responses: { '200': { content: { 'text/plain': { schema: { type: 'string' } } } } },
          },
        },
        '/n': { post: { responses: { '204': { description: 'none' } } } },
      },
    })
    expect(description.paths['/v'].get.returns).toBe('string')
    expect(description.paths['/n'].post.returns).toBeUndefined()
  })

  it('says it cannot read Swagger 2, or a file that is not an API description', () => {
    expect(convertOpenApi({ swagger: '2.0', paths: {} })).toEqual({
      ok: false,
      error:
        'This is Swagger 2.0. Only OpenAPI 3 is read: convert it first (the Swagger editor does it).',
    })
    expect(convertOpenApi({ hello: 'world' })).toEqual({
      ok: false,
      error: 'This is not an OpenAPI description: it has no "openapi" version.',
    })
    expect(convertOpenApi('text')).toEqual({
      ok: false,
      error: 'This is not an OpenAPI description: it is not an object.',
    })
  })

  it('names a reference it cannot follow', () => {
    const { description, notes } = convert({
      openapi: '3.1.0',
      info: { title: 'x' },
      paths: { '/a': { get: { responses: { '200': json(ref('Missing')) } } } },
    })
    expect(description.paths['/a'].get.returns).toBe('unknown')
    expect(notes).toEqual(['GET /a: the schema "Missing" is not in the file, so it is unknown.'])
  })
})
