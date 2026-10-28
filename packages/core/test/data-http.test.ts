import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApiError, createApi, createRoot, flush, state } from '../src'

/** The same runtime against a real HTTP server and the real `fetch`, not a stand-in. */
let server: Server
let base = ''
const seen: Array<{ method: string; url: string; body: string; type: string | undefined }> = []
let closedEarly = 0

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = ''
    req.on('data', (chunk) => (text += chunk))
    req.on('end', () => resolve(text))
  })

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req)
    seen.push({ method: req.method!, url: req.url!, body, type: req.headers['content-type'] })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/slow') {
      req.socket.on('close', () => closedEarly++)
      setTimeout(() => res.end('{"late":true}'), 300)
      return
    }
    if (req.url === '/missing') {
      res.statusCode = 404
      res.end('{"message":"nothing here"}')
      return
    }
    if (req.url === '/empty') {
      res.statusCode = 204
      res.end()
      return
    }
    res.end(
      JSON.stringify({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise((resolve) => server.close(resolve)))

/** Wait for what the real network does, for as long as it takes (up to 10 seconds), not for a time that a slow machine can exceed. */
const until = async (condition: () => boolean) => {
  const end = Date.now() + 10_000
  for (;;) {
    flush()
    if (condition() || Date.now() > end) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('against a real server', () => {
  it('reads with the query string, and follows a signal', async () => {
    const { get } = createApi({ base })
    const page = state(1)
    const list = createRoot(() => get<{ url: string }>('/items', { page, sort: 'name' }))
    await until(() => list.data.value?.url === '/items?page=1&sort=name')
    expect(list.data.value?.url).toBe('/items?page=1&sort=name')
    page.value = 2
    await until(() => list.data.value?.url === '/items?page=2&sort=name')
    expect(list.data.value?.url).toBe('/items?page=2&sort=name')
  })

  it('writes a JSON body, and a path parameter goes in the path', async () => {
    const { put } = createApi({ base })
    const save = put<{ method: string; url: string; body: unknown }>('/items/:id')
    const reply = await save({ id: 9, name: 'x', tags: ['a'] })
    expect(reply).toEqual({ method: 'PUT', url: '/items/9', body: { name: 'x', tags: ['a'] } })
    expect(seen.at(-1)!.type).toBe('application/json')
  })

  it('cancels a request that nothing is waiting for: the connection closes', async () => {
    const { get } = createApi({ base })
    const stop = createRoot((dispose) => {
      get('/slow')
      return dispose
    })
    // The server only hears the connection close if the request has reached it, so wait for that, then stop.
    await until(() => seen.some((r) => r.url === '/slow'))
    stop()
    await until(() => closedEarly === 1)
    expect(closedEarly).toBe(1)
  })

  it("reports a 404 with the server's message, and an empty reply as no data", async () => {
    const { get } = createApi({ base })
    const missing = get('/missing')
    const empty = get('/empty')
    await until(() => !missing.loading.value && !empty.loading.value)
    const error = missing.error.value as ApiError
    expect(error.status).toBe(404)
    expect(error.body).toEqual({ message: 'nothing here' })
    expect(empty.data.value).toBeUndefined()
    expect(empty.error.value).toBeUndefined()
  })

  it('reports a server that is not there as status 0, after trying again', async () => {
    const { get } = createApi({ base: 'http://127.0.0.1:1', retryDelay: () => 5 })
    const r = get('/anything')
    await until(() => r.error.value !== undefined)
    expect((r.error.value as ApiError).status).toBe(0)
  })
})
