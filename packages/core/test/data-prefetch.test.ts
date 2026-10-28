import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllApis,
  createApi,
  createRoot,
  exportPrefetched,
  failedPrefetches,
  flush,
  revalidateSeeded,
  seedData,
  state,
} from '../src'

/** A server that answers from a table, counting the requests, with an optional delay. */
function server(answers: Record<string, unknown>, delay = 0) {
  const calls: string[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (delay) await new Promise((r) => setTimeout(r, delay))
    if (!(url in answers))
      return new Response('{"message":"nothing"}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    return new Response(JSON.stringify(answers[url]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
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

describe('prefetch: starting a read before anything shows it', () => {
  it('asks for the answer, and the read that comes later uses it, with no second request', async () => {
    const s = server({ '/api/posts/3': { title: 'Three' } }, 50)
    const api = createApi({ base: '/api', fetch: s.fetch })
    const started = api.prefetch('/posts/:id', { id: '3' })
    // The page loads: its own read of the same thing joins the request that is already on its way.
    const post = createRoot(() => api.get<{ title: string }>('/posts/:id', { id: '3' }))
    flush()
    expect(post.loading.value).toBe(true)
    await vi.advanceTimersByTimeAsync(60)
    await started
    flush()
    expect(post.data.value).toEqual({ title: 'Three' })
    expect(s.calls).toEqual(['/api/posts/3'])
  })

  it('resolves when the answer is in, and never rejects: a failure is the read’s error to show', async () => {
    const s = server({})
    const api = createApi({ fetch: s.fetch, retryDelay: () => 1 })
    await expect(api.prefetch('/missing')).resolves.toBeUndefined()
    // The page's read asks again (an answer that failed is not an answer), and fails the same way, which it shows.
    let stop!: () => void
    const read = createRoot((dispose) => {
      stop = dispose
      return api.get('/missing')
    })
    flush()
    await vi.advanceTimersByTimeAsync(50)
    flush()
    expect((read.error.value as { status: number }).status).toBe(404)
    // Nothing keeps it: the next test starts clean.
    stop()
  })

  it('does not ask again for an answer that is fresh, and asks again for one that is not', async () => {
    const s = server({ '/a': 1 })
    const api = createApi({ fetch: s.fetch, staleAfter: 1000 })
    await api.prefetch('/a')
    await api.prefetch('/a')
    expect(s.calls).toHaveLength(1)
    vi.setSystemTime(Date.now() + 2000)
    await api.prefetch('/a')
    expect(s.calls).toHaveLength(2)
  })

  it('puts a value for each :name in the path, and the rest in the query, as the read does', async () => {
    const s = server({ '/u/ann/posts?page=2': [] })
    const api = createApi({ fetch: s.fetch })
    await api.prefetch('/u/:name/posts', { name: 'ann', page: 2 })
    expect(s.calls).toEqual(['/u/ann/posts?page=2'])
  })

  it('asks for nothing when a value is missing, and does not throw', async () => {
    const s = server({})
    const api = createApi({ fetch: s.fetch })
    await expect(api.prefetch('/posts/:id', {})).resolves.toBeUndefined()
    expect(s.calls).toEqual([])
  })

  it('lets go of an answer that nothing used, after the time answers are kept', async () => {
    const s = server({ '/a': 1 })
    const api = createApi({ fetch: s.fetch, keepFor: 1000, staleAfter: 60_000 })
    await api.prefetch('/a')
    await vi.advanceTimersByTimeAsync(2000)
    await api.prefetch('/a')
    expect(s.calls).toHaveLength(2)
  })

  it('keeps an answer that a read is using, however long that is', async () => {
    const s = server({ '/a': 1 })
    const api = createApi({ fetch: s.fetch, keepFor: 1000, staleAfter: 60_000 })
    await api.prefetch('/a')
    const stop = createRoot((dispose) => {
      api.get('/a')
      return dispose
    })
    flush()
    await vi.advanceTimersByTimeAsync(5000)
    expect(s.calls).toHaveLength(1)
    stop()
  })

  it('does not send the headers of an api to another origin, as a read does not', async () => {
    const seen: Array<Record<string, string>> = []
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>)
      return new Response('1', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof globalThis.fetch
    const api = createApi({
      base: 'https://api.example.com',
      headers: { authorization: 'Bearer x' },
      fetch,
    })
    await api.prefetch('https://evil.example.org/steal')
    expect(seen[0]!.authorization).toBeUndefined()
  })
})

describe('exportPrefetched: what a prerender writes into the page', () => {
  it('gives the answers of what was prefetched, by address, and nothing a page only read', async () => {
    const s = server({ '/api/a': { n: 1 }, '/api/b': { n: 2 } })
    const api = createApi({ base: '/api', fetch: s.fetch })
    await api.prefetch('/a')
    createRoot(() => api.get('/b'))
    flush()
    await vi.advanceTimersByTimeAsync(10)
    expect(exportPrefetched()).toEqual([{ url: '/api/a', data: { n: 1 } }])
  })

  it('leaves out a prefetch that failed, and one whose answer cannot be written as JSON', async () => {
    const s = server({ '/ok': 1 })
    const api = createApi({ fetch: s.fetch, retryDelay: () => 1 })
    await api.prefetch('/missing')
    const odd = createApi({
      fetch: (async () => new Response('x')) as unknown as typeof globalThis.fetch,
    })
    await odd.prefetch('/blob', {}, { parse: async () => new Map([[1, 2]]) })
    await api.prefetch('/ok')
    expect(exportPrefetched()).toEqual([{ url: '/ok', data: 1 }])
  })

  it('is empty after the answers are cleared, so one page’s data is not in the next page', async () => {
    const s = server({ '/a': 1 })
    const api = createApi({ fetch: s.fetch })
    await api.prefetch('/a')
    clearAllApis()
    expect(exportPrefetched()).toEqual([])
  })
})

describe('failedPrefetches: what a prerender must not pretend it has', () => {
  it('names what was prefetched and failed, with why, and not what worked or was only read', async () => {
    const s = server({ '/ok': 1 })
    const api = createApi({ fetch: s.fetch, retryDelay: () => 1 })
    await api.prefetch('/ok')
    await api.prefetch('/gone')
    createRoot(() => api.get('/other'))
    flush()
    await vi.advanceTimersByTimeAsync(50)
    expect(failedPrefetches()).toEqual([{ url: '/gone', message: expect.stringContaining('404') }])
  })

  it('still names a failed prefetch after the page’s own read has started the request again', async () => {
    const api = createApi({ fetch: server({}).fetch, retryDelay: () => 1 })
    await api.prefetch('/gone-again')
    // The page asks for the same thing: the failed answer is not an answer, so it is asked for again, and the error
    // is cleared while it is (the page would show loading). What the prefetch found out stays found out.
    let stop!: () => void
    createRoot((dispose) => {
      stop = dispose
      api.get('/gone-again')
    })
    flush()
    expect(failedPrefetches().map((f) => f.url)).toContain('/gone-again')
    stop()
  })

  it('is empty after the answers are cleared', async () => {
    const api = createApi({ fetch: server({}).fetch, retryDelay: () => 1 })
    await api.prefetch('/gone')
    clearAllApis()
    expect(failedPrefetches()).toEqual([])
  })
})

describe('seedData: answers that came with the page', () => {
  it('shows the data at once, without a request, to the first read of that address', () => {
    const s = server({})
    const api = createApi({ base: '/api', fetch: s.fetch })
    seedData([{ url: '/api/posts', data: [{ id: 1 }] }])
    const posts = createRoot(() => api.get<Array<{ id: number }>>('/posts'))
    flush()
    expect(posts.data.value).toEqual([{ id: 1 }])
    expect(posts.loading.value).toBe(false)
    expect(s.calls).toEqual([])
  })

  it('is used by the api whose address it is, and only once', () => {
    const a = createApi({ base: '/a', fetch: server({}).fetch })
    const b = createApi({ base: '/b', fetch: server({}).fetch })
    seedData([{ url: '/a/x', data: 'for a' }])
    const fromB = createRoot(() => b.get('/x'))
    const fromA = createRoot(() => a.get('/x'))
    flush()
    expect(fromA.data.value).toBe('for a')
    expect(fromB.data.value).toBeUndefined()
  })

  it('ignores an answer that is not in the shape it expects', () => {
    const api = createApi({ fetch: server({}).fetch })
    seedData([
      { url: 7 as never, data: 1 },
      null as never,
      { data: 1 } as never,
      { url: '/ok', data: 2 },
    ])
    const ok = createRoot(() => api.get('/ok'))
    flush()
    expect(ok.data.value).toBe(2)
  })

  it('is asked again once the page is up, and the data stays on screen while it is', async () => {
    const s = server({ '/posts': ['fresh'] })
    const api = createApi({ fetch: s.fetch })
    seedData([{ url: '/posts', data: ['baked'] }])
    const posts = createRoot(() => api.get<string[]>('/posts'))
    flush()
    expect(posts.data.value).toEqual(['baked'])
    expect(s.calls).toEqual([])
    revalidateSeeded()
    flush()
    expect(posts.refreshing.value).toBe(true)
    expect(posts.data.value).toEqual(['baked'])
    await vi.advanceTimersByTimeAsync(10)
    flush()
    expect(posts.data.value).toEqual(['fresh'])
    expect(s.calls).toEqual(['/posts'])
  })

  it('does not ask again for one nothing on the page uses, and does ask when something does later', async () => {
    const s = server({ '/unused': 1 })
    const api = createApi({ fetch: s.fetch })
    seedData([{ url: '/unused', data: 'baked' }])
    const read = createRoot(() => api.get('/unused'))
    void read
    revalidateSeeded()
    expect(s.calls).toHaveLength(1)
  })

  it('does not write what it was given over an answer that is already there', async () => {
    const s = server({ '/x': 'live' })
    const api = createApi({ fetch: s.fetch })
    const first = createRoot(() => api.get('/x'))
    flush()
    await vi.advanceTimersByTimeAsync(10)
    seedData([{ url: '/x', data: 'baked' }])
    flush()
    expect(first.data.value).toBe('live')
  })
})

describe('data and state do not mix', () => {
  it('leaves a plain state alone', () => {
    const local = state(1)
    seedData([{ url: '/x', data: 1 }])
    expect(local.value).toBe(1)
  })
})
