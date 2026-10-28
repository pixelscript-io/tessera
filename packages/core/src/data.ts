import {
  derived,
  effect,
  isSignal,
  onCleanup,
  state,
  untrack,
  type ReadonlySignal,
  type Signal,
} from './signals'
import { isPlainData } from './shared'

/**
 * Data from a server: `get` reads, `post`, `put`, `patch` and `del` write.
 *
 * A read is a few signals that follow the parameters it was given, so it fetches again when they change, throws away a
 * request nobody is waiting for any more, and shares what it fetched with every other read of the same thing. A write
 * is a function that says when it is working and what went wrong, and that makes the reads it affects ask again.
 * There is nothing to register and no keys to write: the request is the key.
 */

/** What goes wrong with a request: the server said no (`status` is its status), or it could not be reached (`status` is 0). */
export class ApiError extends Error {
  readonly method: string
  readonly url: string
  readonly status: number
  readonly statusText: string
  /** What the server sent with the error: parsed if it was JSON, text if not, undefined if empty. */
  readonly body: unknown

  constructor(init: {
    method: string
    url: string
    status: number
    statusText?: string
    body?: unknown
    message?: string
    cause?: unknown
  }) {
    super(init.message ?? `${init.method} ${init.url} failed: ${init.status}`, {
      cause: init.cause,
    })
    this.name = 'ApiError'
    this.method = init.method
    this.url = init.url
    this.status = init.status
    this.statusText = init.statusText ?? ''
    this.body = init.body
  }
}

/** Parameters: a value for each `:name` in the path, and the rest. A signal is read for its value. */
export type Params = Record<string, unknown>

export interface ApiOptions {
  /** In front of every path that is not a full URL, such as `/api` or `https://api.example.com/v1`. */
  base?: string
  /** Sent with every request: an object, or a function (it may be async) asked before each one. */
  headers?:
    Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
  credentials?: RequestCredentials
  /**
   * Headers and credentials are sent only to the api's own origin: the base's, or the page's when there is none. A path
   * that is a full address on another site (`get(item.next)`) gets neither, so a link in an answer cannot collect a
   * token. Set this to send them to any address a path names.
   */
  allowOtherOrigins?: boolean
  /** The `fetch` to use. Wrap it to add what every request needs. Default: the global one. */
  fetch?: typeof globalThis.fetch
  /** How long to wait before try number `attempt + 1` (0 is the first retry). Default: 300ms, doubling. */
  retryDelay?: (attempt: number) => number
  /** How long an answer counts as fresh, in ms. A read shows it without asking again. Default 5000. */
  staleAfter?: number
  /** How long an answer is kept after the last read that wanted it has gone, in ms. Default 5 minutes. */
  keepFor?: number
  /** Called to be told when the person comes back to the page; returns a way to stop. Default: the browser's own. */
  onFocus?: (callback: () => void) => () => void
}

export interface ReadOptions<T> {
  /** Retries of a network failure or a server error (5xx, 408, 429), or `false`. Default 2. */
  retry?: number | false
  /** Ask again this often, in ms, while something is showing it. */
  poll?: number
  /** Ask again when the person comes back to the page and the answer is old. Default true. */
  refetchOnFocus?: boolean
  /** This read's own idea of how long an answer is fresh, in ms. */
  staleAfter?: number
  headers?: Record<string, string>
  /** Turn the response into the data. Default: JSON, or text if it is not JSON, or nothing if it is empty. */
  parse?: (response: Response) => Promise<T>
}

export interface WriteOptions<T> {
  /** Retries of a network failure or a server error, or `false`. Default `false`: a write is not safe to repeat. */
  retry?: number | false
  headers?: Record<string, string>
  parse?: (response: Response) => Promise<T>
  /** More paths whose reads should ask again after this write, or `false` for none at all. */
  invalidates?: string[] | false
}

/** A read: the data, and what is happening to it. All of them are signals. */
export interface Resource<T> {
  /** The latest answer. Undefined until there is one. It stays while a newer one is fetched. */
  readonly data: ReadonlySignal<T | undefined>
  /** Why the latest try failed. Cleared when one works. */
  readonly error: ReadonlySignal<ApiError | undefined>
  /** Fetching, and there is nothing to show yet. */
  readonly loading: ReadonlySignal<boolean>
  /** Fetching, while the last answer is still shown. */
  readonly refreshing: ReadonlySignal<boolean>
  /** Ask again now. Resolves when it is done, and never rejects: look at `error`. */
  refresh(): Promise<void>
}

type Body = Params | unknown[] | string | FormData | Blob | URLSearchParams | ArrayBuffer

/** A write: call it with what to send. It says when it is working and what went wrong. */
export interface Action<T, I = Body> {
  /** Resolves with the answer, rejects with an `ApiError`. Ignoring a failure is fine: it never goes unhandled. */
  (input?: I): Promise<T>
  /** True while any call is running. */
  readonly pending: ReadonlySignal<boolean>
  /** Why the last call failed. Cleared when the next one starts. */
  readonly error: ReadonlySignal<ApiError | Error | undefined>
  /** The answer of the last call that worked. */
  readonly data: ReadonlySignal<T | undefined>
  /** Forget `data` and `error`. */
  reset(): void
}

export interface Api {
  get<T = unknown>(
    path: string,
    params?: Params | (() => Params),
    options?: ReadOptions<T>,
  ): Resource<T>
  post<T = unknown, I = Body>(path: string, options?: WriteOptions<T>): Action<T, I>
  put<T = unknown, I = Body>(path: string, options?: WriteOptions<T>): Action<T, I>
  patch<T = unknown, I = Body>(path: string, options?: WriteOptions<T>): Action<T, I>
  del<T = unknown, I = Body>(path: string, options?: WriteOptions<T>): Action<T, I>
  /**
   * Start a read before anything shows it, so the answer is on its way when the page that needs it appears (the router
   * does this for the data a page declares). The read that comes later joins this request and uses its answer. Resolves
   * when the answer is in, and never rejects: a failure is for the read to show.
   */
  prefetch(path: string, params?: Params, options?: ReadOptions<unknown>): Promise<void>
  /** Make the reads under and over `path` ask again: now if something is showing them, at their next use if not. */
  invalidate(path: string): void
  /** Forget every answer. Reads that are showing something start again. */
  clear(): void
  /** Change the options of this api. */
  configure(options: ApiOptions): void
}

interface RequestOptions {
  headers?: Record<string, string>
  parse?: (response: Response) => Promise<unknown>
  retry: number | false
}

interface Entry {
  key: string
  url: string
  /** The path alone: no base, no query. What invalidation compares. */
  path: string
  data: Signal<unknown>
  error: Signal<ApiError | undefined>
  loading: Signal<boolean>
  refreshing: Signal<boolean>
  /** An answer has arrived (even an empty one). */
  fetched: boolean
  updatedAt: number
  /** A write has changed what this is an answer to, so it must be asked again at its next use. */
  stale: boolean
  subscribers: number
  promise?: Promise<void>
  controller?: AbortController
  /** Someone asked again while a request was running: ask once more when it is done. */
  rerun: boolean
  gc?: ReturnType<typeof setTimeout>
  staleAfter: number
  focus: boolean
  request: RequestOptions
  /** Asked for ahead of the page (`prefetch`): what a prerender writes into the page. */
  prefetched: boolean
  /** Why a prefetch could not get it. A read that asks again later clears `error`, so this is kept apart. */
  prefetchError?: ApiError
  /** Came with the page, not from the server: shown at once, and asked again after the page is up. */
  seeded: boolean
}

/** Answers that came with the page, by address, for the first read of each (`seedData`). */
const seeds = new Map<string, unknown>()

/** What an api offers the page as a whole. */
interface Internals {
  exportPrefetched(): Array<{ url: string; data: unknown }>
  failedPrefetches(): Array<{ url: string; message: string }>
  revalidate(): void
  clear(): void
}
const registry = new Set<WeakRef<Internals>>()

const live = (): Internals[] => {
  const out: Internals[] = []
  for (const ref of [...registry]) {
    const api = ref.deref()
    if (api) out.push(api)
    else registry.delete(ref)
  }
  return out
}

/**
 * Give reads the answers that came with the page: each is used by the first read of its address, as if it had just
 * been fetched, and shown without a request. Anything that is not an address with an answer is ignored.
 */
export function seedData(list: ReadonlyArray<{ url: string; data: unknown }>): void {
  for (const item of list) {
    if (item && typeof item === 'object' && typeof item.url === 'string' && 'data' in item)
      seeds.set(item.url, item.data)
  }
}

/** What was prefetched and answered, by address: what a prerender writes into the page. Only data JSON can carry. */
export function exportPrefetched(): Array<{ url: string; data: unknown }> {
  return live().flatMap((api) => api.exportPrefetched())
}

/** What was prefetched and could not be had, with why: a prerender does not write a page whose declared data it lacks. */
export function failedPrefetches(): Array<{ url: string; message: string }> {
  return live().flatMap((api) => api.failedPrefetches())
}

/** Ask again for every answer that came with the page and is being shown, now that the page is up. */
export function revalidateSeeded(): void {
  for (const api of live()) api.revalidate()
}

/** Forget every answer of every api, and the ones waiting to be used. */
export function clearAllApis(): void {
  seeds.clear()
  for (const api of live()) api.clear()
}

const PLACEHOLDER = /\/:([A-Za-z_]\w*)/g
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:\/\//i

/** The origin of an address, resolved against `from` when it is relative. Undefined when it cannot be read. */
function originOf(url: string, from?: string): string | undefined {
  try {
    return new URL(url, from).origin
  } catch {
    return undefined
  }
}

const noop = () => {}

function abortError(): Error {
  return Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' })
}

/** Wait `ms`, or stop waiting (by throwing) when `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Put the values into the `:names` of a path. `missing` is the first name that has no value. */
function fill(
  path: string,
  values: Params,
): { path: string; rest: Params; missing?: string; invalid?: string } {
  const rest = { ...values }
  let missing: string | undefined
  let invalid: string | undefined
  const filled = path.replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name]
    delete rest[name]
    if (value === undefined || value === null) {
      missing ??= name
      return ''
    }
    const text = String(value)
    // `.` and `..` are not changed by encoding, and the address would go up a level: a value from outside must not.
    if (text === '.' || text === '..') {
      invalid ??= `The value of "${name}" is "${text}", which would change which address is asked. Use a value that is not "." or "..".`
    }
    return `/${encodeURIComponent(text)}`
  })
  return { path: filled, rest, missing, ...(invalid ? { invalid } : {}) }
}

function queryString(values: Params): string {
  const search = new URLSearchParams()
  for (const key of Object.keys(values).sort()) {
    const value = values[key]
    for (const one of Array.isArray(value) ? value : [value]) {
      if (one === undefined || one === null) continue
      search.append(key, one instanceof Date ? one.toISOString() : String(one))
    }
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

const isPlainObject = (value: unknown): value is Params => {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const unwrapValues = (values: Params): Params =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, isSignal(v) ? v.value : v]))

/** Whether two paths are one under the other: `/todos` and `/todos/3/comments`, but not `/todos/3` and `/todos/4`. */
function related(a: string, b: string): boolean {
  const x = a.split('/').filter(Boolean)
  const y = b.split('/').filter(Boolean)
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false
  return true
}

const retryable = (error: ApiError) =>
  error.status === 0 || error.status >= 500 || error.status === 408 || error.status === 429

/** Create an api with its own options and its own memory of what it fetched. The ones every app uses are exported below. */
export function createApi(initial: ApiOptions = {}): Api {
  const config: ApiOptions = { ...initial }
  const entries = new Map<string, Entry>()
  /** Counts the changes of who the api is for, so what depends on the base asks for its address again. */
  const configuration = state(0)
  let live = 0
  let stopFocus: (() => void) | undefined

  const staleAfter = () => config.staleAfter ?? 5000
  const keepFor = () => config.keepFor ?? 5 * 60_000
  const fetcher: typeof globalThis.fetch = (input, init) =>
    (config.fetch ?? globalThis.fetch)(input, init)

  /** The origin the api belongs to: its base's, or the page's. Undefined where there is no page (tests, a server). */
  function ownOrigin(): string | undefined {
    if (config.base && ABSOLUTE.test(config.base)) return originOf(config.base)
    return (globalThis as { location?: { origin?: string } }).location?.origin
  }

  /** Whether this api's headers and credentials may go with a request to `url`. */
  function trusts(url: string): boolean {
    if (config.allowOtherOrigins) return true
    const own = ownOrigin()
    if (!own) return !ABSOLUTE.test(url) && !url.startsWith('//')
    return originOf(url, own) === own
  }

  function join(path: string): string {
    if (ABSOLUTE.test(path) || !config.base) return path
    return config.base.replace(/\/+$/, '') + path
  }

  async function parseBody(response: Response): Promise<unknown> {
    if (response.status === 204 || response.status === 205) return undefined
    const text = await response.text()
    if (!text) return undefined
    if (/json/i.test(response.headers.get('content-type') ?? '')) {
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
    return text
  }

  /** One try. Throws an ApiError for a bad status or a failure to reach the server. */
  async function once(
    method: string,
    url: string,
    body: Body | undefined,
    request: RequestOptions,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json, text/plain, */*' }
    const trusted = trusts(url)
    const own = !trusted
      ? undefined
      : typeof config.headers === 'function'
        ? await config.headers()
        : config.headers
    for (const [k, v] of Object.entries({ ...own, ...request.headers }))
      headers[k.toLowerCase()] = v
    let payload: BodyInit | undefined
    if (body !== undefined) {
      if (Array.isArray(body) || isPlainObject(body)) {
        payload = JSON.stringify(body)
        headers['content-type'] ??= 'application/json'
      } else payload = body as BodyInit
    }
    let response: Response
    try {
      response = await fetcher(url, {
        method,
        headers,
        body: payload,
        signal,
        ...(config.credentials && trusted ? { credentials: config.credentials } : {}),
      })
    } catch (cause) {
      if (signal?.aborted) throw cause
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new ApiError({
        method,
        url,
        status: 0,
        message: `${method} ${url} failed: ${reason}`,
        cause,
      })
    }
    if (!response.ok) {
      let errorBody: unknown
      try {
        errorBody = await parseBody(response)
      } catch {
        /* the body is a detail; the status is what matters */
      }
      throw new ApiError({
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
      })
    }
    try {
      return request.parse ? await request.parse(response) : await parseBody(response)
    } catch (cause) {
      if (signal?.aborted) throw cause
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new ApiError({
        method,
        url,
        status: response.status,
        message: `${method} ${url} sent a reply that could not be read: ${reason}`,
        cause,
      })
    }
  }

  /** `once`, tried again after a network failure or a server error, with a wait that grows. */
  async function send(
    method: string,
    url: string,
    body: Body | undefined,
    request: RequestOptions,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const retries = request.retry === false ? 0 : request.retry
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(method, url, body, request, signal)
      } catch (error) {
        if (
          signal?.aborted ||
          !(error instanceof ApiError) ||
          attempt >= retries ||
          !retryable(error)
        )
          throw error
        await sleep((config.retryDelay ?? ((n: number) => 300 * 2 ** n))(attempt), signal)
      }
    }
  }

  function entryFor(key: string, url: string, path: string): Entry {
    let entry = entries.get(key)
    if (!entry) {
      entry = {
        key,
        url,
        path,
        data: state<unknown>(undefined),
        error: state<ApiError | undefined>(undefined),
        loading: state(false),
        refreshing: state(false),
        fetched: false,
        updatedAt: 0,
        stale: false,
        subscribers: 0,
        rerun: false,
        staleAfter: staleAfter(),
        focus: true,
        request: { retry: 2 },
        prefetched: false,
        seeded: false,
      }
      entries.set(key, entry)
      // An answer that came with the page is this one's, and is used only once.
      if (seeds.has(url)) {
        entry.data.value = seeds.get(url)
        entry.fetched = true
        entry.updatedAt = Date.now()
        entry.seeded = true
        seeds.delete(url)
      }
    }
    return entry
  }

  /** Drop an answer nothing is using after the time answers are kept. */
  function expireLater(entry: Entry): void {
    if (entry.gc) clearTimeout(entry.gc)
    entry.gc = setTimeout(() => {
      if (entry.subscribers === 0 && entries.get(entry.key) === entry) entries.delete(entry.key)
    }, keepFor())
    ;(entry.gc as { unref?: () => void }).unref?.()
  }

  /** Fetch now, or (if a request is running) once more when it is done. Resolves when it is over; never rejects. */
  function run(entry: Entry): Promise<void> {
    if (entry.promise) {
      entry.rerun = true
      return entry.promise
    }
    const pass = async () => {
      do {
        entry.rerun = false
        const controller = new AbortController()
        entry.controller = controller
        if (entry.fetched) entry.refreshing.value = true
        else {
          entry.loading.value = true
          entry.error.value = undefined
        }
        try {
          const result = await send('GET', entry.url, undefined, entry.request, controller.signal)
          if (controller.signal.aborted) return
          entry.data.value = result
          entry.error.value = undefined
          entry.fetched = true
          entry.updatedAt = Date.now()
          entry.stale = false
        } catch (error) {
          if (controller.signal.aborted) return
          entry.error.value =
            error instanceof ApiError
              ? error
              : new ApiError({
                  method: 'GET',
                  url: entry.url,
                  status: 0,
                  message: String(error),
                  cause: error,
                })
        } finally {
          entry.loading.value = false
          entry.refreshing.value = false
        }
      } while (entry.rerun && entry.subscribers > 0)
      // Asked again while running, but nobody is looking any more: the next one to look will ask.
      if (entry.rerun) entry.stale = true
    }
    entry.promise = pass().finally(() => {
      entry.promise = undefined
      entry.controller = undefined
    })
    return entry.promise
  }

  function acquire(entry: Entry, request: RequestOptions, options: ReadOptions<unknown>): void {
    entry.subscribers++
    if (entry.gc) clearTimeout(entry.gc)
    entry.gc = undefined
    entry.request = request
    entry.staleAfter = options.staleAfter ?? staleAfter()
    entry.focus = options.refetchOnFocus ?? true
    if (++live === 1) {
      stopFocus = (config.onFocus ?? browserFocus)(() => {
        for (const e of entries.values()) {
          if (e.subscribers > 0 && e.focus && !e.promise && Date.now() - e.updatedAt > e.staleAfter)
            void run(e)
        }
      })
    }
  }

  function release(entry: Entry): void {
    entry.subscribers--
    if (--live === 0) {
      stopFocus?.()
      stopFocus = undefined
    }
    if (entry.subscribers > 0) return
    // Nobody is waiting for it: stop it, and keep what was fetched for a while in case someone asks again.
    entry.controller?.abort()
    expireLater(entry)
  }

  function invalidatePaths(paths: string[]): void {
    for (const entry of entries.values()) {
      if (!paths.some((p) => related(p, entry.path))) continue
      if (entry.subscribers > 0) void run(entry)
      else entry.stale = true
    }
  }

  function get<T>(
    path: string,
    params?: Params | (() => Params),
    options: ReadOptions<T> = {},
  ): Resource<T> {
    const target = derived(() => {
      // The base is part of the address, so a read follows it when it changes (see `configure`).
      void configuration.value
      const given = unwrapValues(typeof params === 'function' ? params() : (params ?? {}))
      const { path: filled, rest, missing, invalid } = fill(path, given)
      // A parameter with no value yet means there is nothing to ask for yet.
      if (missing) return undefined
      // A value that cannot be used is an error, and nothing is asked.
      if (invalid)
        return { invalid: new ApiError({ method: 'GET', url: path, status: 0, message: invalid }) }
      return { url: join(filled) + queryString(rest), path: filled }
    })
    const entry = derived(() => {
      const found = target.value
      return found === undefined || 'invalid' in found
        ? undefined
        : entryFor(`GET ${found.url}`, found.url, found.path)
    })
    const request: RequestOptions = {
      headers: options.headers,
      parse: options.parse as RequestOptions['parse'],
      retry: options.retry ?? 2,
    }

    effect(() => {
      const current = entry.value
      if (!current) return
      onCleanup(() => release(current))
      untrack(() => {
        acquire(current, request, options as ReadOptions<unknown>)
        if (
          !current.promise &&
          (!current.fetched || current.stale || Date.now() - current.updatedAt > current.staleAfter)
        )
          void run(current)
        if (options.poll) {
          const timer = setInterval(() => {
            if (!current.promise) void run(current)
          }, options.poll)
          onCleanup(() => clearInterval(timer))
        }
      })
    })

    return {
      data: derived(() => entry.value?.data.value as T | undefined),
      error: derived(() => {
        const found = target.value
        return found !== undefined && 'invalid' in found ? found.invalid : entry.value?.error.value
      }),
      loading: derived(() => entry.value?.loading.value ?? false),
      refreshing: derived(() => entry.value?.refreshing.value ?? false),
      refresh() {
        const current = entry.peek()
        return current ? run(current) : Promise.resolve()
      },
    }
  }

  function prefetch(
    path: string,
    params: Params = {},
    options: ReadOptions<unknown> = {},
  ): Promise<void> {
    const { path: filled, rest, missing, invalid } = fill(path, unwrapValues(params))
    // A value that is not there yet, or one that cannot be used, means there is nothing to ask for: the read says why.
    if (missing || invalid) return Promise.resolve()
    const url = join(filled) + queryString(rest)
    const entry = entryFor(`GET ${url}`, url, filled)
    entry.prefetched = true
    if (entry.subscribers === 0) {
      entry.request = {
        headers: options.headers,
        parse: options.parse as RequestOptions['parse'],
        retry: options.retry ?? 2,
      }
      entry.staleAfter = options.staleAfter ?? staleAfter()
      // Nobody has asked for it yet: if nobody does, it goes after the time answers are kept.
      expireLater(entry)
    }
    const started =
      !entry.promise &&
      (!entry.fetched || entry.stale || Date.now() - entry.updatedAt > entry.staleAfter)
        ? run(entry)
        : (entry.promise ?? Promise.resolve())
    // What a prefetch found out stays found out: the read that comes later may ask again and clear the error.
    return started.then(() => {
      entry.prefetchError = entry.fetched ? undefined : entry.error.peek()
    })
  }

  function action<T, I>(method: string, path: string, options: WriteOptions<T> = {}): Action<T, I> {
    const running = state(0)
    const error = state<ApiError | Error | undefined>(undefined)
    const data = state<T | undefined>(undefined)
    const request: RequestOptions = {
      headers: options.headers,
      parse: options.parse as RequestOptions['parse'],
      retry: options.retry ?? false,
    }

    const call = async (input?: I): Promise<T> => {
      running.value++
      error.value = undefined
      try {
        let values: Params = {}
        let body: Body | undefined
        if (isPlainObject(input)) values = unwrapValues(input)
        else if (input !== undefined) body = input as Body
        const { path: filled, rest, missing, invalid } = fill(path, values)
        if (missing) throw new Error(`${path} needs a value for "${missing}".`)
        if (invalid) throw new ApiError({ method, url: path, status: 0, message: invalid })
        if (body === undefined && Object.keys(rest).length > 0) body = rest
        const result = (await send(method, join(filled), body, request)) as T
        data.value = result
        if (options.invalidates !== false) invalidatePaths([filled, ...(options.invalidates ?? [])])
        return result
      } catch (failure) {
        error.value = failure as ApiError | Error
        throw failure
      } finally {
        running.value--
      }
    }

    const fn = ((input?: I) => {
      const promise = call(input)
      // A failure is in `error`. Attaching this here means a caller that ignores the promise does not cause an
      // unhandled rejection, while one that awaits it still hears about it.
      promise.catch(noop)
      return promise
    }) as Action<T, I>
    return Object.assign(fn, {
      pending: derived(() => running.value > 0),
      error,
      data,
      reset() {
        data.value = undefined
        error.value = undefined
      },
    }) as Action<T, I>
  }

  /** Forget everything that was fetched. A read that is still shown starts again; one nothing shows is dropped. */
  function clearAll(): void {
    for (const entry of [...entries.values()]) {
      entry.controller?.abort()
      entry.data.value = undefined
      entry.error.value = undefined
      entry.fetched = false
      entry.updatedAt = 0
      entry.stale = false
      if (entry.subscribers > 0) void run(entry)
      else {
        if (entry.gc) clearTimeout(entry.gc)
        entries.delete(entry.key)
      }
    }
  }

  const api: Api = {
    get,
    prefetch,
    post: (path, options) => action('POST', path, options),
    put: (path, options) => action('PUT', path, options),
    patch: (path, options) => action('PATCH', path, options),
    del: (path, options) => action('DELETE', path, options),
    invalidate: (path) => invalidatePaths([path]),
    clear: clearAll,
    configure(options) {
      // What was fetched belongs to whoever it was fetched for: a new base, credentials or headers (a different person
      // signed in) must not be answered from the last one's memory.
      const forWhom = (['base', 'credentials', 'headers'] as const).some(
        (key) => key in options && !Object.is(options[key], config[key]),
      )
      Object.assign(config, options)
      if (forWhom) {
        configuration.value++
        clearAll()
      }
    },
  }

  const internals: Internals = {
    exportPrefetched: () =>
      [...entries.values()]
        .filter(
          (e) =>
            e.prefetched &&
            e.fetched &&
            !e.error.value &&
            e.data.peek() !== undefined &&
            isPlainData(e.data.peek()),
        )
        .map((e) => ({ url: e.url, data: e.data.peek() })),
    failedPrefetches: () =>
      [...entries.values()]
        .filter((e) => e.prefetched && !e.fetched && e.prefetchError)
        .map((e) => ({ url: e.url, message: e.prefetchError!.message })),
    revalidate() {
      for (const entry of entries.values()) {
        if (!entry.seeded || entry.subscribers === 0) continue
        entry.seeded = false
        void run(entry)
      }
    },
    clear: clearAll,
  }
  // The registry holds the internals weakly; the api holds them for as long as it lives.
  registry.add(new WeakRef(internals))
  held.set(api, internals)
  return api
}

/** Keeps what an api offers the page alive as long as the api is. */
const held = new WeakMap<object, Internals>()

/** The browser telling us the person is back: the tab became visible, or the window got focus. */
function browserFocus(callback: () => void): () => void {
  if (typeof document === 'undefined') return noop
  const onVisible = () => {
    if (document.visibilityState === 'visible') callback()
  }
  document.addEventListener('visibilitychange', onVisible)
  globalThis.addEventListener?.('focus', callback)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    globalThis.removeEventListener?.('focus', callback)
  }
}

const shared = createApi()

/** Set the options of the api every `get` and `post` in the app uses: its base URL, headers, `fetch`. Do it once, at the start. */
export const configureApi = shared.configure
export const get = shared.get
export const post = shared.post
export const put = shared.put
export const patch = shared.patch
/** Delete (`delete` is a reserved word). */
export const del = shared.del
export const prefetch = shared.prefetch
export const invalidate = shared.invalidate
export const clearApi = shared.clear

/** The id of the script the prerender writes the answers into. */
const DATA_SCRIPT_ID = 'tessera-data'

/**
 * The answers of what a page declared, as a script the browser does not run (it is JSON), to put in the page's HTML.
 * Characters that could end the script or be read as markup are written as escapes, so whatever a server answered
 * cannot add to the page. Empty when there is nothing to write.
 */
export function dataScript(entries: ReadonlyArray<{ url: string; data: unknown }>): string {
  if (entries.length === 0) return ''
  const json = JSON.stringify({ v: 1, entries }).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  return `<script type="application/json" id="${DATA_SCRIPT_ID}">${json}</script>`
}

/** Read what `dataScript` wrote into the page, if it is there and is what it should be, and hand it to the reads. */
export function seedFromDocument(doc: {
  getElementById(id: string): { textContent: string | null } | null
}): void {
  const text = doc.getElementById(DATA_SCRIPT_ID)?.textContent
  if (!text) return
  try {
    const parsed = JSON.parse(text) as { v?: unknown; entries?: unknown }
    if (parsed && parsed.v === 1 && Array.isArray(parsed.entries)) seedData(parsed.entries)
  } catch {
    // Not what was written: the page asks for its data as it would have.
  }
}
