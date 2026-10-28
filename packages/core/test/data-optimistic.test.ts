import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllApis, createApi, createRoot, flush } from '../src'

// An optimistic write shows its result before the server has answered, and puts things back if the server refuses.

interface Todo {
  id: number
  title: string
  done?: boolean
}

/** A server with a list of todos. A write waits `delay` ms, and fails with 500 when `failNext` is set. */
function todos(delay = 50) {
  let list: Todo[] = [{ id: 1, title: 'one' }]
  const calls: string[] = []
  const control = { failNext: false, list: () => list }
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const url = String(input)
    calls.push(`${method} ${url}`)
    if (delay) await new Promise((r) => setTimeout(r, delay))
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (method !== 'GET') {
      if (control.failNext) {
        control.failNext = false
        return json({ message: 'no' }, 500)
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { title: string }
        const todo = { id: list.length + 1, title: body.title }
        list = [...list, todo]
        return json(todo)
      }
      if (method === 'DELETE') {
        const id = Number(url.split('/').pop())
        list = list.filter((t) => t.id !== id)
        return json({})
      }
    }
    if (url === '/api/todos' || url.startsWith('/api/todos?')) return json(list)
    return json({ message: 'nothing' }, 404)
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls, control }
}

beforeEach(() =>
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  }),
)
afterEach(() => {
  clearAllApis()
  vi.useRealTimers()
})

const settle = async (ms = 200) => {
  await vi.advanceTimersByTimeAsync(ms)
  flush()
}

/** A page that shows the list and has the app's api. */
function setup(delay = 50) {
  const server = todos(delay)
  const api = createApi({ base: '/api', fetch: server.fetch, retryDelay: () => 1 })
  let stop!: () => void
  const list = createRoot((dispose) => {
    stop = dispose
    return api.get<Todo[]>('/todos')
  })
  return { server, api, list, stop }
}

describe('optimistic: the result is shown before the server answers', () => {
  it('changes the list at once, and keeps it while the list is asked for again', async () => {
    const { api, list, stop } = setup()
    flush()
    await settle()
    expect(list.data.value).toEqual([{ id: 1, title: 'one' }])

    const add = api.post<Todo, { title: string }>('/todos', {
      optimistic: {
        '/todos': (current: Todo[], input: { title: string }) => [...current, { id: 0, ...input }],
      },
    })
    void add({ title: 'two' })
    flush()
    // Nothing has come back yet, and the list already shows it.
    expect(list.data.value).toEqual([
      { id: 1, title: 'one' },
      { id: 0, title: 'two' },
    ])
    expect(add.pending.value).toBe(true)

    // The write is over; the list is asked for again, and the guess stays on screen until the truth arrives.
    await vi.advanceTimersByTimeAsync(60)
    flush()
    expect(list.data.value).toEqual([
      { id: 1, title: 'one' },
      { id: 0, title: 'two' },
    ])
    await settle()
    expect(list.data.value).toEqual([
      { id: 1, title: 'one' },
      { id: 2, title: 'two' },
    ])
    stop()
  })

  it('puts the list back, and says why, when the server refuses', async () => {
    const { server, api, list, stop } = setup()
    flush()
    await settle()
    server.control.failNext = true
    const add = api.post<Todo, { title: string }>('/todos', {
      optimistic: {
        '/todos': (current: Todo[], input: { title: string }) => [...current, { id: 0, ...input }],
      },
    })
    const result = add({ title: 'two' })
    flush()
    expect(list.data.value).toHaveLength(2)
    const refused = expect(result).rejects.toMatchObject({ status: 500 })
    await settle()
    await refused
    flush()
    expect(list.data.value).toEqual([{ id: 1, title: 'one' }])
    expect((add.error.value as { status: number }).status).toBe(500)
    stop()
  })

  it('fills :name in the path from what is sent, and changes only the list at that path', async () => {
    const { api, list, stop } = setup()
    const detail = createRoot(() => api.get('/todos/1'))
    flush()
    await settle()
    const remove = api.del<unknown, { id: number }>('/todos/:id', {
      optimistic: {
        '/todos': (current: Todo[], input: { id: number }) =>
          current.filter((t) => t.id !== input.id),
      },
    })
    void remove({ id: 1 })
    flush()
    expect(list.data.value).toEqual([])
    // The read of one todo is another address: it is not touched.
    expect(detail.data.value).toBeUndefined()
    await settle()
    stop()
  })

  it('changes every read of the list, whatever its query', async () => {
    const { api, list, stop } = setup()
    const filtered = createRoot(() => api.get<Todo[]>('/todos', { done: false }))
    flush()
    await settle()
    const add = api.post<Todo, { title: string }>('/todos', {
      optimistic: {
        '/todos': (current: Todo[], input: { title: string }) => [...current, { id: 0, ...input }],
      },
    })
    void add({ title: 'two' })
    flush()
    expect(list.data.value).toHaveLength(2)
    expect(filtered.data.value).toHaveLength(2)
    await settle()
    stop()
  })
})

describe('optimistic: what is left alone', () => {
  it('skips a read that has no answer yet, and a rule that gives nothing back or throws', async () => {
    const { api, list, stop } = setup()
    // Not fetched yet: there is nothing to change.
    const add = api.post<Todo, { title: string }>('/todos', {
      optimistic: { '/todos': () => [{ id: 9, title: 'guess' }] },
    })
    void add({ title: 'a' })
    flush()
    expect(list.data.value).toBeUndefined()
    await settle()

    const nothing = api.post<Todo, { title: string }>('/todos', {
      optimistic: { '/todos': () => undefined },
    })
    void nothing({ title: 'b' })
    flush()
    expect(list.data.value).toHaveLength(2)
    await settle()
    const before = list.data.value
    const boom = api.post<Todo, { title: string }>('/todos', {
      optimistic: {
        '/todos': () => {
          throw new Error('bug in the rule')
        },
      },
    })
    void boom({ title: 'c' })
    flush()
    expect(list.data.value).toBe(before)
    await settle()
    stop()
  })

  it('is not undone by an answer that was already on its way when the write began', async () => {
    const { server, api, list, stop } = setup(100)
    flush()
    await settle(150)
    // A new request for the list is on its way (and would answer without the new todo).
    void list.refresh()
    await vi.advanceTimersByTimeAsync(10)
    const add = api.post<Todo, { title: string }>('/todos', {
      optimistic: {
        '/todos': (current: Todo[], input: { title: string }) => [...current, { id: 0, ...input }],
      },
      invalidates: false,
    })
    void add({ title: 'two' })
    flush()
    await vi.advanceTimersByTimeAsync(95)
    flush()
    expect(list.data.value).toEqual([
      { id: 1, title: 'one' },
      { id: 0, title: 'two' },
    ])
    expect(server.calls.filter((c) => c.startsWith('GET'))).toHaveLength(2)
    stop()
  })

  it('keeps the guess when the write worked and nothing asks for the list again', async () => {
    const { api, list, stop } = setup()
    flush()
    await settle()
    const add = api.post<Todo, { title: string }>('/todos', {
      optimistic: {
        '/todos': (current: Todo[], input: { title: string }) => [...current, { id: 0, ...input }],
      },
      invalidates: false,
    })
    void add({ title: 'two' })
    await settle()
    expect(list.data.value).toHaveLength(2)
    stop()
  })
})

describe('optimistic: two writes at once', () => {
  it('undoes only the one that failed', async () => {
    const { server, api, list, stop } = setup()
    flush()
    await settle()
    const add = api.post<Todo, { title: string }>('/todos', {
      optimistic: {
        '/todos': (current: Todo[], input: { title: string }) => [...current, { id: 0, ...input }],
      },
      invalidates: false,
    })
    server.control.failNext = true
    const first = add({ title: 'fails' })
    const second = add({ title: 'works' })
    flush()
    expect(list.data.value!.map((t) => t.title)).toEqual(['one', 'fails', 'works'])
    const refused = expect(first).rejects.toBeDefined()
    await settle()
    await refused
    await second
    flush()
    expect(list.data.value!.map((t) => t.title)).toEqual(['one', 'works'])
    stop()
  })
})
