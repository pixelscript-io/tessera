import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProjectApi } from './apis'
import type { Method } from './api-description'
import { mockResponse, parseMockMode } from './mock'

/** Where the dev server answers for the mocked APIs: `/__tessera/mock/<api name>/<path>`. */
export const MOCK_PREFIX = '/__tessera/mock'

/** The most a mocked write may send: a mock is for a developer's own page, and nothing more is read. */
const MAX_BODY = 1_000_000

const VERBS: Readonly<Record<string, Method>> = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  if (body === undefined) {
    res.end()
    return
  }
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) return undefined
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

/**
 * The middleware of the dev server for mocked APIs, mounted at {@link MOCK_PREFIX}. A request for
 * `/__tessera/mock/github/users/octocat` is answered from the description of the API in `app/apis/github.ts`.
 * `x-tessera-mock` says what to show on purpose (`error`, `empty`, `loading`, `slow`). The list of APIs is asked for on
 * every request, so a description that was just edited is used at once.
 */
export function mockMiddleware(
  apis: () => readonly ProjectApi[],
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    const verb = VERBS[(req.method ?? 'GET').toUpperCase()]
    if (!verb) return next()
    // `req.url` is what is left after the prefix: `/<name>/<path>?<query>`.
    const url = new URL(req.url ?? '/', 'http://mock.invalid')
    const [name, ...rest] = url.pathname.split('/').filter(Boolean)
    const api = name === undefined ? undefined : apis().find((candidate) => candidate.name === name)
    if (!api) {
      return send(res, 404, {
        message: `There is no API named "${name ?? ''}" in app/apis, so there is nothing to mock.`,
      })
    }
    if (!api.description) {
      return send(res, 404, {
        message: `"${api.name}" has no description, so there is nothing to make an answer from. Add app/apis/${api.name}.api.json (or run tessera api import).`,
      })
    }
    void (async () => {
      const description = api.description!
      const body = verb === 'GET' || verb === 'DELETE' ? undefined : await readBody(req)
      const header = req.headers['x-tessera-mock']
      const answer = mockResponse(description, verb, '/' + rest.join('/'), {
        query: Object.fromEntries(url.searchParams),
        body,
        mode: parseMockMode(Array.isArray(header) ? header[0] : header),
      })
      if (!answer.delay) return send(res, answer.status, answer.body)
      // Held back on purpose; if the page stops waiting (it left, or asked again) the timer goes with it.
      const timer = setTimeout(() => send(res, answer.status, answer.body), answer.delay)
      timer.unref()
      req.on('close', () => clearTimeout(timer))
    })()
  }
}
