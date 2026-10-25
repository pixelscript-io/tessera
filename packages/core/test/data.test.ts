import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApi, createRoot, flush, state, type ApiOptions } from '../src'

/** What a fake server was asked, in order. */
interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: string | undefined
  signal: AbortSignal | null | undefined
}

type Reply = Response | object | string | number | undefined

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

/** A server made of one function. A plain value is a 200 JSON reply; a number is an empty reply with that status. */
function server(handler: (call: Call) => Reply | Promise<Reply>) {
  const calls: Call[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v))
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal,
    }
    calls.push(call)
    const aborted = new Promise<never>((_, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      )
    })
    const reply = await Promise.race([Promise.resolve(handler(call)), aborted])
    if (reply instanceof Response) return reply
    if (typeof reply === 'number') return new Response(null, { status: reply })
    if (typeof reply === 'string') return new Response(reply, { status: 200 })
    return json(reply)
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Let requests finish and effects run. */
const settle = async (ms = 10) => {
  await sleep(ms)
  flush()
}

const api = (s: ReturnType<typeof server>, options: ApiOptions = {}) =>
  createApi({ fetch: s.fetch, retryDelay: () => 1, ...options })

describe('get: the request', () => {
  it('fetches at once, and goes from loading to data', async () => {
    const s = server(() => ({ name: 'Ada' }))
    const { get } = api(s)
    const user = get<{ name: string }>('/users/1')
    expect(user.loading.value).toBe(true)
    expect(user.data.value).toBeUndefined()
    expect(user.error.value).toBeUndefined()
    await settle()
    expect(user.loading.value).toBe(false)
    expect(user.data.value).toEqual({ name: 'Ada' })
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0]).toMatchObject({ method: 'GET', url: '/users/1' })
    expect(s.calls[0]!.headers.accept).toContain('application/json')
  })

  it('puts the base in front, fills :names from the params, and makes the rest the query string', async () => {
    const s = server(() => ({}))
    const { get } = api(s, { base: 'https://api.example.com/v1/' })
    get('/users/:id/posts', {
      id: 'a b/c',
      page: 2,
      q: 'x y',
      tags: ['a', 'b'],
      skip: undefined,
      none: null,
    })
    await settle()
    expect(s.calls[0]!.url).toBe(
      'https://api.example.com/v1/users/a%20b%2Fc/posts?page=2&q=x+y&tags=a&tags=b',
    )
  })

  it('leaves an absolute URL alone and does not mistake a port for a parameter', async () => {
    const s = server(() => ({}))
    const { get } = api(s, { base: '/api' })
    get('http://localhost:8080/things/:id', { id: 3 })
    await settle()
    expect(s.calls[0]!.url).toBe('http://localhost:8080/things/3')
  })

  it('follows signals in the params: a change fetches again, and the old request is cancelled', async () => {
    const id = state(1)
    const s = server(async (call) => {
      if (call.url === '/users/1') await sleep(30)
      return { id: call.url.split('/').pop() }
    })
    const { get } = api(s)
    const { user, stop: dispose } = createRoot((stop) => ({
      user: get<{ id: string }>('/users/:id', { id }),
      stop,
    }))
    await sleep(5)
    id.value = 2
    await settle(50)
    expect(s.calls.map((c) => c.url)).toEqual(['/users/1', '/users/2'])
    expect(s.calls[0]!.signal!.aborted).toBe(true)
    // The slow first answer never replaces the second.
    expect(user.data.value).toEqual({ id: '2' })
    expect(user.loading.value).toBe(false)
    dispose()
  })

  it('also takes a function for the params', async () => {
    const page = state(1)
    const s = server(() => [])
    const { get } = api(s)
    createRoot(() => get('/items', () => ({ page: page.value * 10 })))
    await settle()
    page.value = 2
    await settle()
    expect(s.calls.map((c) => c.url)).toEqual(['/items?page=10', '/items?page=20'])
  })

  it('waits while a parameter has no value yet, and starts when it has one', async () => {
    const id = state<number | undefined>(undefined)
    const s = server(() => ({ ok: true }))
    const { get } = api(s)
    const r = createRoot(() => get('/users/:id', { id }))
    await settle()
    expect(s.calls).toHaveLength(0)
    expect(r.loading.value).toBe(false)
    expect(r.data.value).toBeUndefined()
    id.value = 7
    await settle()
    expect(s.calls.map((c) => c.url)).toEqual(['/users/7'])
    expect(r.data.value).toEqual({ ok: true })
  })

  it('reads json, text and an empty reply', async () => {
    const s = server((call) => {
      if (call.url === '/text')
        return new Response('hello', { headers: { 'content-type': 'text/plain' } })
      if (call.url === '/empty') return 204
      return { a: 1 }
    })
    const { get } = api(s)
    const text = get<string>('/text')
    const empty = get('/empty')
    const data = get('/data')
    await settle()
    expect(text.data.value).toBe('hello')
    expect(empty.data.value).toBeUndefined()
    expect(empty.error.value).toBeUndefined()
    expect(empty.loading.value).toBe(false)
    expect(data.data.value).toEqual({ a: 1 })
  })

  it('lets a request parse the reply itself', async () => {
    const s = server(() => 'a,b,c')
    const { get } = api(s)
    const r = get<string[]>('/csv', {}, { parse: async (res) => (await res.text()).split(',') })
    await settle()
    expect(r.data.value).toEqual(['a', 'b', 'c'])
  })

  it('sends the headers of the api and of the request, and asks for them when they are a function', async () => {
    const s = server(() => ({}))
    const token = vi.fn(async () => ({ authorization: 'Bearer t' }))
    const { get } = api(s, { headers: token, credentials: 'include' })
    get('/me', {}, { headers: { 'x-trace': '1' } })
    await settle()
    expect(s.calls[0]!.headers).toMatchObject({ authorization: 'Bearer t', 'x-trace': '1' })
    expect(token).toHaveBeenCalledTimes(1)
  })
})

describe('get: errors and retries', () => {
  it('turns a failed status into an ApiError with what the server said', async () => {
    const s = server(() => json({ message: 'no such user' }, 404))
    const { get } = api(s)
    const r = get('/users/9')
    await settle()
    const error = r.error.value as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toBeInstanceOf(Error)
    expect(error.status).toBe(404)
    expect(error.body).toEqual({ message: 'no such user' })
    expect(error.url).toBe('/users/9')
    expect(error.method).toBe('GET')
    expect(error.message).toBe('GET /users/9 failed: 404')
    expect(r.loading.value).toBe(false)
    expect(r.data.value).toBeUndefined()
    // A request that was wrong is not asked again.
    expect(s.calls).toHaveLength(1)
  })

  it('tries a server error and a network failure again, then gives up with the last error', async () => {
    let n = 0
    const s = server(() => (++n < 3 ? 503 : { ok: true }))
    const { get } = api(s)
    const recovered = get('/flaky')
    await settle(30)
    expect(s.calls).toHaveLength(3)
    expect(recovered.data.value).toEqual({ ok: true })
    expect(recovered.error.value).toBeUndefined()

    const down = server(() => 500)
    const failing = api(down).get('/down')
    await settle(30)
    expect(down.calls).toHaveLength(3)
    expect((failing.error.value as ApiError).status).toBe(500)
  })

  it('reports a network failure as status 0, and lets a request choose not to retry', async () => {
    const s = server(() => {
      throw new TypeError('Failed to fetch')
    })
    const { get } = api(s)
    const r = get('/x', {}, { retry: false })
    await settle()
    expect(s.calls).toHaveLength(1)
    const error = r.error.value as ApiError
    expect(error.status).toBe(0)
    expect(error.message).toContain('Failed to fetch')
  })

  it('keeps what it had when asking again fails, and says so', async () => {
    let fail = false
    const s = server(() => (fail ? 400 : { v: 1 }))
    const { get } = api(s)
    const r = get('/thing', {}, { retry: false })
    await settle()
    fail = true
    await r.refresh()
    flush()
    expect(r.data.value).toEqual({ v: 1 })
    expect((r.error.value as ApiError).status).toBe(400)
    fail = false
    await r.refresh()
    flush()
    expect(r.error.value).toBeUndefined()
  })
})

describe('get: sharing, freshness and cleaning up', () => {
  it('shares one request and one answer between everyone who asks for the same thing', async () => {
    const s = server(async () => {
      await sleep(10)
      return { n: 1 }
    })
    const { get } = api(s)
    const a = get('/shared')
    const b = get('/shared')
    expect(b.loading.value).toBe(true)
    await settle(30)
    expect(s.calls).toHaveLength(1)
    expect(a.data.value).toBe(b.data.value)
  })

  it('shows what it has at once to a later asker, and asks again only when it is old', async () => {
    let n = 0
    const s = server(() => ({ n: ++n }))
    const { get } = api(s, { staleAfter: 40 })
    const first = get('/count')
    await settle()
    const second = get('/count')
    // Fresh: the same answer, no loading, no new request.
    expect(second.data.value).toEqual({ n: 1 })
    expect(second.loading.value).toBe(false)
    await settle()
    expect(s.calls).toHaveLength(1)

    await sleep(50)
    const third = get('/count')
    // Old: the old answer stays, `refreshing` says it is being checked, and `loading` stays false.
    expect(third.data.value).toEqual({ n: 1 })
    expect(third.loading.value).toBe(false)
    expect(third.refreshing.value).toBe(true)
    await settle()
    expect(third.data.value).toEqual({ n: 2 })
    expect(third.refreshing.value).toBe(false)
    expect(first.data.value).toEqual({ n: 2 })
  })

  it('refresh() asks again now and says when it is done', async () => {
    let n = 0
    const s = server(() => ({ n: ++n }))
    const { get } = api(s)
    const r = get('/count')
    await settle()
    const done = r.refresh()
    expect(r.refreshing.value).toBe(true)
    await done
    flush()
    expect(r.data.value).toEqual({ n: 2 })
    expect(s.calls).toHaveLength(2)
  })

  it('cancels a request nobody waits for any more, and forgets an answer after keepFor', async () => {
    const s = server(async () => {
      await sleep(40)
      return { ok: true }
    })
    const { get } = api(s, { keepFor: 0 })
    const stop = createRoot((dispose) => {
      get('/slow')
      return dispose
    })
    await sleep(5)
    stop()
    await settle()
    expect(s.calls[0]!.signal!.aborted).toBe(true)

    // Nothing was kept, so a new asker starts from nothing.
    const again = get('/slow')
    expect(again.data.value).toBeUndefined()
    expect(again.loading.value).toBe(true)
    await settle(60)
    expect(again.data.value).toEqual({ ok: true })
  })

  it('keeps an answer for a while after the last asker has gone', async () => {
    const s = server(() => ({ ok: true }))
    const { get } = api(s, { staleAfter: 1000 })
    const stop = createRoot((dispose) => {
      get('/kept')
      return dispose
    })
    await settle()
    stop()
    await settle()
    const back = get('/kept')
    expect(back.data.value).toEqual({ ok: true })
    expect(back.loading.value).toBe(false)
    expect(s.calls).toHaveLength(1)
  })

  it('asks again on a timer while someone is looking, and stops when they leave', async () => {
    const s = server(() => ({ t: Date.now() }))
    const { get } = api(s)
    const stop = createRoot((dispose) => {
      get('/ticker', {}, { poll: 20 })
      return dispose
    })
    await settle(90)
    const during = s.calls.length
    expect(during).toBeGreaterThanOrEqual(3)
    stop()
    await settle(60)
    expect(s.calls.length).toBe(during)
  })

  it('asks again when the person comes back to the page, if the answer is old', async () => {
    let focus: () => void = () => {}
    let n = 0
    const s = server(() => ({ n: ++n }))
    const { get } = api(s, {
      staleAfter: 60,
      onFocus: (callback) => {
        focus = callback
        return () => {}
      },
    })
    const r = get('/news')
    await settle()
    focus()
    await settle()
    expect(s.calls).toHaveLength(1)
    await sleep(80)
    focus()
    await settle()
    expect(r.data.value).toEqual({ n: 2 })
    const quiet = get('/quiet', {}, { refetchOnFocus: false })
    await settle()
    await sleep(80)
    focus()
    await settle()
    expect(s.calls.filter((c) => c.url === '/quiet')).toHaveLength(1)
    expect(quiet.data.value).toEqual({ n: 3 })
  })
})

describe('writes', () => {
  it('sends the rest of the object as a JSON body, and the :names go in the path', async () => {
    const s = server(() => ({ id: 5, title: 'Milk' }))
    const { post, put } = api(s)
    const add = post<{ id: number }>('/todos')
    const created = await add({ title: 'Milk', done: false })
    expect(created).toEqual({ id: 5, title: 'Milk' })
    expect(s.calls[0]).toMatchObject({
      method: 'POST',
      url: '/todos',
      body: '{"title":"Milk","done":false}',
    })
    expect(s.calls[0]!.headers['content-type']).toBe('application/json')

    const save = put('/todos/:id')
    await save({ id: 5, title: 'Oat milk' })
    expect(s.calls[1]).toMatchObject({
      method: 'PUT',
      url: '/todos/5',
      body: '{"title":"Oat milk"}',
    })
  })

  it('has post, put, patch and del, and del with only a path parameter sends no body', async () => {
    const s = server(() => 204)
    const { post, put, patch, del } = api(s)
    await post('/a')()
    await put('/b/:id')({ id: 1 })
    await patch('/c/:id')({ id: 2, x: 1 })
    await del('/d/:id')({ id: 3 })
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /a',
      'PUT /b/1',
      'PATCH /c/2',
      'DELETE /d/3',
    ])
    expect(s.calls[0]!.body).toBeUndefined()
    expect(s.calls[3]!.body).toBeUndefined()
    expect(s.calls[3]!.headers['content-type']).toBeUndefined()
  })

  it('sends an array, a string or form data as the whole body', async () => {
    const s = server(() => 204)
    const { post } = api(s)
    await post('/bulk')([{ a: 1 }, { a: 2 }])
    expect(s.calls[0]!.body).toBe('[{"a":1},{"a":2}]')
    await post('/note')('plain words')
    expect(s.calls[1]!.body).toBe('plain words')
    expect(s.calls[1]!.headers['content-type']).toBeUndefined()
  })

  it('says it is pending, keeps the last answer, and keeps the error of a failed one', async () => {
    let status = 200
    const s = server(async () => {
      await sleep(10)
      return status === 200 ? { ok: true } : json({ message: 'bad' }, status)
    })
    const { post } = api(s)
    const send = post<{ ok: boolean }>('/things')
    expect(send.pending.value).toBe(false)
    const first = send({ a: 1 })
    expect(send.pending.value).toBe(true)
    await first
    flush()
    expect(send.pending.value).toBe(false)
    expect(send.data.value).toEqual({ ok: true })
    expect(send.error.value).toBeUndefined()

    status = 422
    await expect(send({ a: 2 })).rejects.toMatchObject({ status: 422, body: { message: 'bad' } })
    flush()
    expect((send.error.value as ApiError).status).toBe(422)
    expect(send.pending.value).toBe(false)
    // The last good answer is still there; reset() clears both.
    expect(send.data.value).toEqual({ ok: true })
    send.reset()
    expect(send.data.value).toBeUndefined()
    expect(send.error.value).toBeUndefined()
  })

  it('stays pending until every call that is running has finished', async () => {
    const s = server(async (call) => {
      await sleep(call.url === '/slow' ? 40 : 5)
      return {}
    })
    const { post } = api(s)
    const slow = post('/slow')
    const slowing = slow()
    const fast = post('/fast')
    await fast()
    expect(fast.pending.value).toBe(false)
    expect(slow.pending.value).toBe(true)
    await slowing
  })

  it('does not cause an unhandled rejection when the caller ignores a failure', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const s = server(() => 500)
    const { post } = api(s)
    const send = post('/boom')
    send()
    await settle(40)
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect((send.error.value as ApiError).status).toBe(500)
  })

  it('does not retry a write unless it is told to', async () => {
    const s = server(() => 503)
    const { post } = api(s)
    await post('/once')().catch(() => {})
    expect(s.calls).toHaveLength(1)
    const t = server(() => 503)
    await api(t)
      .post('/again', { retry: 2 })()
      .catch(() => {})
    expect(t.calls).toHaveLength(3)
  })

  it('names the missing parameter when a :name has no value', async () => {
    const s = server(() => 204)
    const { put } = api(s)
    await expect(put('/todos/:id')({ title: 'x' })).rejects.toThrow(
      '/todos/:id needs a value for "id"',
    )
    expect(s.calls).toHaveLength(0)
  })
})

describe('what a write makes stale', () => {
  const setup = async () => {
    let n = 0
    const s = server((call) => (call.method === 'GET' ? { n: ++n, url: call.url } : { ok: true }))
    const client = api(s, { staleAfter: 60_000 })
    const list = client.get('/todos')
    const one = client.get('/todos/1')
    const other = client.get('/todos/2')
    const users = client.get('/users')
    await settle()
    s.calls.length = 0
    return { s, client, list, one, other, users }
  }

  it('asks again for the reads under and over the path that was written, and for nothing else', async () => {
    const { s, client } = await setup()
    await client.put('/todos/:id')({ id: 1, title: 'x' })
    await settle()
    expect(
      s.calls
        .filter((c) => c.method === 'GET')
        .map((c) => c.url)
        .sort(),
    ).toEqual(['/todos', '/todos/1'])
  })

  it('asks again for the list and its items when something is added', async () => {
    const { s, client } = await setup()
    await client.post('/todos')({ title: 'new' })
    await settle()
    expect(
      s.calls
        .filter((c) => c.method === 'GET')
        .map((c) => c.url)
        .sort(),
    ).toEqual(['/todos', '/todos/1', '/todos/2'])
  })

  it('only marks a read stale when nobody is looking, so the next one asks', async () => {
    const s = server((call) => (call.method === 'GET' ? { at: Date.now() } : { ok: true }))
    const client = api(s, { staleAfter: 60_000 })
    const stop = createRoot((dispose) => {
      client.get('/todos')
      return dispose
    })
    await settle()
    stop()
    await settle()
    await client.post('/todos')({ title: 'x' })
    await settle()
    expect(s.calls.filter((c) => c.method === 'GET')).toHaveLength(1)
    client.get('/todos')
    await settle()
    expect(s.calls.filter((c) => c.method === 'GET')).toHaveLength(2)
  })

  it('takes more paths to refresh, or none', async () => {
    const { s, client } = await setup()
    await client.post('/todos', { invalidates: ['/users'] })({ title: 'x' })
    await settle()
    expect(s.calls.filter((c) => c.method === 'GET').map((c) => c.url)).toContain('/users')
    s.calls.length = 0
    await client.post('/todos', { invalidates: false })({ title: 'y' })
    await settle()
    expect(s.calls.filter((c) => c.method === 'GET')).toHaveLength(0)
  })

  it('does not lose a refresh that was asked for while one is running', async () => {
    let version = 1
    const s = server(async (call) => {
      if (call.method !== 'GET') return { ok: true }
      const seen = version
      await sleep(20)
      return { seen }
    })
    const client = api(s, { staleAfter: 60_000 })
    const r = client.get<{ seen: number }>('/doc')
    await sleep(5)
    version = 2
    await client.put('/doc')({ title: 'x' })
    await settle(60)
    expect(r.data.value).toEqual({ seen: 2 })
  })

  it('can be asked directly, with invalidate() and clear()', async () => {
    const { s, client, list } = await setup()
    client.invalidate('/todos')
    await settle()
    expect(s.calls.filter((c) => c.url === '/todos')).toHaveLength(1)
    client.clear()
    // What was kept is gone at once; a read that is still shown starts again.
    expect(list.data.value).toBeUndefined()
    expect(list.loading.value).toBe(true)
    await settle()
    expect(list.data.value).toBeDefined()
  })
})
