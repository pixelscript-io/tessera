import { nearest } from '@tessera/contract'
import {
  matchEndpoint,
  resolveType,
  type ApiDescription,
  type ApiType,
  type Endpoint,
  type Method,
} from './api-description'

/**
 * Development mocks: answers made from the description of an API, so a page can be built, and its loading, error and
 * empty states seen, before the server exists or while it is down. This module is pure; the dev server calls it
 * (`tessera dev --mock`). The data is made up the same way every time, so a page does not change when it reloads.
 */

/** Something to see on purpose, asked for with `?mock=` on the page's address. */
export type MockMode =
  | { kind: 'error'; status: number }
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'slow'; ms: number }

/** How long `loading` holds an answer back: long enough that the page stays in its loading state. */
export const LOADING_MS = 10 * 60 * 1000
const SLOW_MS = 1500
/** The longest delay a person can ask for, so a mode in an address cannot hold a connection open for long. */
const MAX_SLOW_MS = 60_000

/** `error`, `error:404`, `empty`, `loading`, `slow` or `slow:300`. Anything else is not a mode. */
export function parseMockMode(text: string | undefined): MockMode | undefined {
  if (!text) return undefined
  const [name, rest] = text.split(':') as [string, string | undefined]
  const number = rest !== undefined && /^\d{1,6}$/.test(rest) ? Number(rest) : undefined
  if (name === 'error') {
    if (rest === undefined) return { kind: 'error', status: 500 }
    return number !== undefined && number >= 400 && number <= 599
      ? { kind: 'error', status: number }
      : undefined
  }
  if (name === 'slow') {
    if (rest === undefined) return { kind: 'slow', ms: SLOW_MS }
    return number !== undefined && number <= MAX_SLOW_MS ? { kind: 'slow', ms: number } : undefined
  }
  if ((name === 'empty' || name === 'loading') && rest === undefined) return { kind: name }
  return undefined
}

export interface MockAnswer {
  status: number
  /** Missing when there is nothing to send. */
  body?: unknown
  /** Wait this many milliseconds before sending it. */
  delay?: number
}

export interface MockRequest {
  query: Record<string, string>
  body?: unknown
  mode?: MockMode
}

const NAMES = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Linus Pauling']
const WORDS = ['Sample', 'Example', 'Demo', 'Placeholder', 'Test']

/** A made-up value for a text field, from what its name says it is. */
function text(field: string, index: number): string {
  const name = field.toLowerCase()
  const n = index + 1
  if (/e-?mail/.test(name)) return `person${n}@example.com`
  if (/(url|link|href|image|avatar|photo|picture|thumbnail|website|homepage)/.test(name))
    return `https://example.com/${field.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}/${n}`
  if (/(date|time|created|updated|at$)/.test(name))
    return new Date(Date.UTC(2026, 0, n)).toISOString()
  if (/(phone|tel)/.test(name)) return `+1 555 01${String(n).padStart(2, '0')}`
  if (/(login|username|handle|slug)/.test(name)) return `user-${n}`
  if (/(name|author|owner|user)/.test(name)) return NAMES[index % NAMES.length]!
  if (/(title|subject|heading|label)/.test(name))
    return `${WORDS[index % WORDS.length]} ${field} ${n}`
  if (/(description|body|text|content|summary|bio|note|message)/.test(name))
    return `${WORDS[index % WORDS.length]} ${field}. It is made up from the description of the API.`
  if (/(id|key|code|uuid)$/.test(name)) return `${field}-${n}`
  return `${WORDS[index % WORDS.length]} ${field} ${n}`
}

function make(
  description: ApiDescription,
  type: ApiType,
  field: string,
  index: number,
  depth: number,
): unknown {
  // A type that refers to itself (a tree, a comment with replies) stops here instead of going on for ever.
  if (depth > 6) return type.kind === 'array' ? [] : null
  const resolved = resolveType(description, type)
  switch (resolved.kind) {
    case 'string':
      return text(field, index)
    case 'number':
      return /(price|amount|total|rate|ratio|score|rating|latitude|longitude|lat|lng)/i.test(field)
        ? Math.round((9.5 + index * 3.25) * 100) / 100
        : index + 1
    case 'boolean':
      return index % 2 === 0
    case 'null':
      return null
    case 'literal':
      return resolved.value
    case 'unknown':
      return null
    case 'object':
      return {}
    case 'array':
      return Array.from({ length: 3 }, (_, i) =>
        make(description, resolved.of, field, i, depth + 1),
      )
    case 'union': {
      const first = resolved.of.find((member) => member.kind !== 'null') ?? resolved.of[0]
      return first ? make(description, first, field, index, depth + 1) : null
    }
    case 'fields': {
      const out: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(resolved.fields)) {
        // Left out on purpose: a page that reads an optional field must cope with it being missing.
        if (entry.optional) continue
        out[key] = make(description, entry.type, key, index, depth + 1)
      }
      return out
    }
    case 'ref':
      return null
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The value of each `:name` of the pattern, taken from the path that was asked for. */
function parameters(pattern: string, path: string): Record<string, string> {
  const out: Record<string, string> = {}
  const parts = pattern.split('/').filter(Boolean)
  const given = path.split('?')[0]!.split('/').filter(Boolean)
  parts.forEach((part, i) => {
    if (part.startsWith(':')) {
      try {
        out[part.slice(1)] = decodeURIComponent(given[i] ?? '')
      } catch {
        out[part.slice(1)] = given[i] ?? ''
      }
    }
  })
  return out
}

/** Make the answer to a request from the description: the endpoint's `returns`, made up, with the request put in. */
export function mockResponse(
  description: ApiDescription,
  method: Method,
  path: string,
  request: MockRequest = { query: {} },
): MockAnswer {
  const match = matchEndpoint(description, method, path)
  if (match.kind === 'none' || match.kind === 'outside') {
    const paths = [...new Set(description.endpoints.map((e) => e.path))]
    const close = match.kind === 'none' ? (match.nearest ?? nearest(path, paths)) : undefined
    return {
      status: 404,
      body: {
        message: `The description has no ${method} ${path}.${close ? ` Did you mean "${close}"?` : ''}`,
      },
    }
  }
  if (match.kind === 'method') {
    return {
      status: 405,
      body: { message: `${match.path} has ${match.has.join(', ')}, not ${method}.` },
    }
  }
  const endpoint: Endpoint = match.endpoint
  const mode = request.mode

  if (mode?.kind === 'error') {
    return {
      status: mode.status,
      body: {
        message:
          endpoint.errors?.[String(mode.status)] ??
          'The mock server answered with an error on purpose.',
      },
    }
  }
  if (mode?.kind === 'empty') {
    const returns = endpoint.returns && resolveType(description, endpoint.returns)
    return returns?.kind === 'array' ? { status: 200, body: [] } : { status: 204 }
  }

  const delay = mode?.kind === 'loading' ? LOADING_MS : mode?.kind === 'slow' ? mode.ms : undefined
  const answer = (value: MockAnswer): MockAnswer => (delay ? { ...value, delay } : value)

  if (!endpoint.returns) return answer({ status: 204 })
  const params = parameters(endpoint.path, path)
  const made = make(description, endpoint.returns, lastWord(endpoint.path), 0, 0)
  if (isObject(made)) {
    // The id in the address is the id of what comes back, and what a write sent is in the answer, so a page that
    // adds an item and shows the answer sees its own item.
    const merged = { ...made }
    for (const [key, value] of Object.entries(params)) {
      if (key in merged) merged[key] = typeof merged[key] === 'number' ? Number(value) : value
    }
    if (isObject(request.body)) {
      for (const [key, value] of Object.entries(request.body))
        if (key in merged) merged[key] = value
    }
    return answer({ status: 200, body: merged })
  }
  return answer({ status: 200, body: made })
}

/** The last word of a path that is not a parameter, which names what a list or a number is about. */
function lastWord(path: string): string {
  const words = path.split('/').filter((part) => part && !part.startsWith(':'))
  return words[words.length - 1] ?? 'value'
}
