import { describe, expect, it } from 'vitest'
import { parseApiDescription } from '../src/api-description'
import { mockResponse, parseMockMode } from '../src/mock'

// A development mock answers from the description of an API, so a page can be built before the server exists.

const parsed = parseApiDescription(
  JSON.stringify({
    types: {
      Todo: { id: 'number', title: 'string', done: 'boolean', note: 'string?', owner: 'User' },
      User: { id: 'number', name: 'string', email: 'string', avatarUrl: 'string' },
      Status: "'open' | 'closed'",
    },
    paths: {
      '/todos': {
        get: { query: { done: 'boolean?' }, returns: 'Todo[]' },
        post: { body: { title: 'string' }, returns: 'Todo' },
      },
      '/todos/:id': {
        get: { returns: 'Todo', errors: { '404': 'No such todo' } },
        delete: {},
      },
      '/status': { get: { returns: 'Status' } },
      '/count': { get: { returns: 'number' } },
    },
  }),
  'app/apis/todos.api.json',
)
if (!parsed.description) throw new Error('the sample description must be valid')
const description = parsed.description

const ask = (
  method: string,
  path: string,
  options: { body?: unknown; mode?: string; query?: Record<string, string> } = {},
) =>
  mockResponse(description, method as 'GET', path, {
    body: options.body,
    mode: parseMockMode(options.mode),
    query: options.query ?? {},
  })

describe('mockResponse: data made from the types', () => {
  it('answers a list with several items of the type, each with every field', () => {
    const answer = ask('GET', '/todos')
    expect(answer.status).toBe(200)
    const list = answer.body as Array<Record<string, unknown>>
    expect(list.length).toBeGreaterThanOrEqual(3)
    for (const todo of list) {
      expect(typeof todo.id).toBe('number')
      expect(typeof todo.title).toBe('string')
      expect(typeof todo.done).toBe('boolean')
      expect(todo.owner).toMatchObject({ id: expect.any(Number), name: expect.any(String) })
    }
    // Items differ, so a list with a `key` shows three rows and not one three times.
    expect(new Set(list.map((t) => t.id)).size).toBe(list.length)
  })

  it('gives fields values that look like what the name says', () => {
    const owner = (ask('GET', '/todos').body as Array<{ owner: Record<string, string> }>)[0]!.owner
    expect(owner.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/)
    expect(owner.avatarUrl).toMatch(/^https?:\/\//)
    expect(owner.name.length).toBeGreaterThan(2)
  })

  it('is the same every time, so a page does not change on reload', () => {
    expect(ask('GET', '/todos').body).toEqual(ask('GET', '/todos').body)
  })

  it('takes the value of :name from the path, and the first choice of a union', () => {
    expect((ask('GET', '/todos/42').body as { id: number }).id).toBe(42)
    expect(ask('GET', '/status').body).toBe('open')
    expect(typeof ask('GET', '/count').body).toBe('number')
  })

  it('leaves out an optional field, so a page is built for it being missing', () => {
    const todo = ask('GET', '/todos/1').body as Record<string, unknown>
    expect('note' in todo).toBe(false)
  })

  it('answers a write with what it sent put into the answer', () => {
    const answer = ask('POST', '/todos', { body: { title: 'Buy milk' } })
    expect(answer.status).toBe(200)
    expect(answer.body).toMatchObject({ title: 'Buy milk', id: expect.any(Number) })
  })

  it('answers a write with no answer in the description with no body', () => {
    const answer = ask('DELETE', '/todos/3')
    expect(answer.status).toBe(204)
    expect(answer.body).toBeUndefined()
  })
})

describe('mockResponse: what is not in the description', () => {
  it('says 404 for a path it does not have, and names the nearest', () => {
    const answer = ask('GET', '/todo')
    expect(answer.status).toBe(404)
    expect((answer.body as { message: string }).message).toContain('/todos')
  })

  it('says 405 for a method the path does not have, and which it has', () => {
    const answer = ask('PUT', '/todos')
    expect(answer.status).toBe(405)
    expect((answer.body as { message: string }).message).toContain('GET')
  })
})

describe('mockResponse: the states a page has to handle', () => {
  it('error: fails with a status and a message, 500 by default', () => {
    const answer = ask('GET', '/todos', { mode: 'error' })
    expect(answer.status).toBe(500)
    expect(answer.body).toMatchObject({ message: expect.any(String) })
  })

  it('error:404 fails with the status given, and the description’s message if it has one', () => {
    const answer = ask('GET', '/todos/1', { mode: 'error:404' })
    expect(answer.status).toBe(404)
    expect(answer.body).toEqual({ message: 'No such todo' })
  })

  it('empty: a list is empty, and anything else has no body', () => {
    expect(ask('GET', '/todos', { mode: 'empty' }).body).toEqual([])
    const one = ask('GET', '/todos/1', { mode: 'empty' })
    expect(one.status).toBe(204)
    expect(one.body).toBeUndefined()
  })

  it('loading: the answer is the same, but it comes very late', () => {
    const answer = ask('GET', '/todos', { mode: 'loading' })
    expect(answer.status).toBe(200)
    expect(answer.delay).toBeGreaterThanOrEqual(30_000)
  })

  it('slow: the same answer after a delay a person can notice', () => {
    expect(ask('GET', '/todos', { mode: 'slow' }).delay).toBe(1500)
    expect(ask('GET', '/todos', { mode: 'slow:300' }).delay).toBe(300)
  })
})

describe('parseMockMode', () => {
  it('reads the modes, and ignores what is not one', () => {
    expect(parseMockMode('error')).toEqual({ kind: 'error', status: 500 })
    expect(parseMockMode('error:503')).toEqual({ kind: 'error', status: 503 })
    expect(parseMockMode('empty')).toEqual({ kind: 'empty' })
    expect(parseMockMode('loading')).toEqual({ kind: 'loading' })
    expect(parseMockMode('slow:200')).toEqual({ kind: 'slow', ms: 200 })
    expect(parseMockMode('nonsense')).toBeUndefined()
    expect(parseMockMode(undefined)).toBeUndefined()
    // A status outside what HTTP has, or a delay that would hold a connection for a long time, is not taken.
    expect(parseMockMode('error:99999')).toBeUndefined()
    expect(parseMockMode('slow:99999999')).toBeUndefined()
  })
})
