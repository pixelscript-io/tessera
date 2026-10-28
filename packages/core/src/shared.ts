import { effect, flush, setStateCreated, state, type Signal } from './signals'

/**
 * State that outlives a component: what a file in `app/state` holds. It can keep itself (`persisted`, in the browser's
 * storage), show itself in the address (`urlState`), be put back to where it started (`resetState`, for tests), and
 * survive an edit of its file in the dev server. Everything here is safe where there is no browser (a prerender, a
 * test in Node): then it is a plain signal.
 */

interface Shared {
  /** What the state is put back to. */
  initial: unknown
  /** Extra to do after the value is back (forget what was stored, clean the address). */
  afterReset?: () => void
}

const entries = new WeakMap<object, Shared>()
/** The signals that are shared, weakly, so a state nobody uses any more can go. */
const registry = new Set<WeakRef<Signal<unknown>>>()

function register(signal: Signal<unknown>, initial: unknown): Shared {
  let entry = entries.get(signal)
  if (!entry) {
    entry = { initial }
    entries.set(signal, entry)
    registry.add(new WeakRef(signal))
  }
  return entry
}

/**
 * Put every piece of shared state back to the value it started with: the state of the files in \`app/state\`, and every
 * \`persisted\` and \`urlState\`, which also forget what they stored and what the address said. For tests, so one test's
 * cart is not in the next one. State made inside a component is not touched.
 */
export function resetState(): void {
  const live: Array<[Signal<unknown>, Shared]> = []
  for (const ref of [...registry]) {
    const signal = ref.deref()
    const entry = signal && entries.get(signal)
    if (!signal || !entry) registry.delete(ref)
    else live.push([signal, entry])
  }
  for (const [signal, entry] of live) signal.value = entry.initial
  // Effects that write the value back (to the storage, to the address) run now, so what is forgotten stays forgotten.
  flush()
  for (const [, entry] of live) entry.afterReset?.()
}

// --- a state file, as the build marks it -------------------------------------------------------------------------------

interface Hot {
  data: Record<string, unknown>
  dispose(callback: (data: Record<string, unknown>) => void): void
}

const HOT_KEY = 'tesseraSharedState'

/** Is this plain data, which JSON writes down and reads back as the same thing (not a Map, a Date, a class, a cycle)? */
function isPlain(value: unknown, depth = 0): boolean {
  if (depth > 50) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => isPlain(item, depth + 1))
  if (typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return false
  return Object.values(value).every((item) => isPlain(item, depth + 1))
}

/** @internal Is this plain data, which JSON writes down and reads back as the same thing? */
export const isPlainData = isPlain

/** The value as text for a hot update, or `undefined` when keeping it would change what it is. */
function write(value: unknown): string | undefined {
  return isPlain(value) ? JSON.stringify(value) : undefined
}

/**
 * Called first in the body of every file in \`app/state\` (the build puts the call there). Every \`state()\` made while the
 * body runs is shared state: \`resetState\` puts it back. In the dev server, when the file is edited and runs again, each
 * one starts from the value it had, as long as the code still starts it from the same value, so an edit does not empty a
 * cart someone filled to test it. Anything else about the file may have changed, and then it starts fresh.
 *
 * @internal
 */
export function __beginStateFile(_file: string, hot?: Hot): void {
  const before = hot?.data[HOT_KEY] as Array<{ initial?: string; value?: string }> | undefined
  const created: Array<{ signal: Signal<unknown>; initial: unknown }> = []
  const hook = (signal: Signal<unknown>, initial: unknown) => {
    register(signal, initial)
    const index = created.push({ signal, initial }) - 1
    const old = before?.[index]
    if (old?.initial !== undefined && old.value !== undefined && write(initial) === old.initial) {
      try {
        signal.value = JSON.parse(old.value)
      } catch {
        // A value that cannot be read back is left at its initial one.
      }
    }
  }
  const previous = setStateCreated(hook)
  hot?.dispose((data) => {
    data[HOT_KEY] = created.map(({ signal, initial }) => ({
      initial: write(initial),
      value: write(signal.peek()),
    }))
  })
  // The body of a module runs in one go: when it is done, what is made later (in a component) is not shared. Another
  // file that ran in between has set its own hook, which is left alone.
  queueMicrotask(() => {
    if (setStateCreated(previous) !== hook) setStateCreated(setStateCreated(previous))
  })
}

// --- persisted -----------------------------------------------------------------------------------------------------

export interface PersistedOptions<T> {
  /** Changes when the shape of what is kept changes. A value kept under another version is migrated, or forgotten. Default 1. */
  version?: number
  /** Turn a value kept by an older version into the current one. It is given the value and the version it was kept by. */
  migrate?: (stored: unknown, version: number) => T
  /** Accept only what has the right shape; anything else is forgotten. */
  validate?: (value: unknown) => value is T
  /** Where to keep it. Default \`localStorage\`; \`sessionStorage\` keeps it until the tab closes. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

function storageOf(options: { storage?: PersistedOptions<unknown>['storage'] }) {
  if (options.storage) return options.storage
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    // Some browsers throw on touching the storage when it is blocked.
    return undefined
  }
}

/**
 * State that is kept in the browser's storage under \`key\`, and read back the next time. It is a signal like \`state()\`:
 * \`items.value = [...]\` keeps it. What is read back is checked: text that is not what \`persisted\` wrote, a value another
 * version wrote (unless \`migrate\` turns it into this one), or a value \`validate\` refuses, starts it from \`initial\` as if
 * nothing were kept. Where there is no storage, or it is full or blocked, it is a plain signal and nothing throws. A
 * change made in another tab is followed.
 */
export function persisted<T>(
  key: string,
  initial: T,
  options: PersistedOptions<T> = {},
): Signal<T> {
  const version = options.version ?? 1
  const storage = storageOf(options)
  const signal = state(initial)
  const entry = register(signal as Signal<unknown>, initial)
  if (!storage) return signal

  /** The value kept under the key, ready to use, or \`undefined\` when there is none that can be used. */
  const read = (text: string | null): { value: T; rewrite: boolean } | undefined => {
    if (text === null) return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return undefined
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const { v, value } = parsed as { v?: unknown; value?: unknown }
    if (typeof v !== 'number' || !('value' in parsed)) return undefined
    let result: unknown
    let rewrite = false
    if (v === version) result = value
    else if (v < version && options.migrate) {
      try {
        result = options.migrate(value, v)
      } catch {
        return undefined
      }
      rewrite = true
    } else return undefined
    if (options.validate && !options.validate(result)) return undefined
    return { value: result as T, rewrite }
  }

  const keep = (value: T): string => JSON.stringify({ v: version, value })
  const save = (text: string) => {
    try {
      storage.setItem(key, text)
    } catch {
      // The storage is full or blocked: the value lives on in memory.
    }
  }

  let kept: string | null
  try {
    kept = storage.getItem(key)
  } catch {
    return signal
  }
  const found = read(kept)
  if (found) {
    signal.value = found.value
    if (found.rewrite) save(keep(found.value))
  }

  let first = true
  effect(() => {
    const value = signal.value
    if (first) {
      first = false
      return
    }
    let text: string
    try {
      text = keep(value)
    } catch {
      return // Something that cannot be written down (a cycle) is not kept.
    }
    // A change that came from another tab is already in the storage: writing it again would only echo it back.
    let current: string | null
    try {
      current = storage.getItem(key)
    } catch {
      return
    }
    if (current !== text) save(text)
  })

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key !== key || (event.storageArea && event.storageArea !== (storage as unknown)))
        return
      const next = event.newValue === null ? { value: initial } : read(event.newValue)
      if (next) signal.value = next.value
    })
  }

  entry.afterReset = () => {
    try {
      storage.removeItem(key)
    } catch {
      // Nothing was kept that could be removed.
    }
  }
  return signal
}

// --- urlState ------------------------------------------------------------------------------------------------------

export interface UrlStateOptions<T> {
  /** Turn the text of the address into a value. It may throw: the initial value is used then. */
  parse?: (text: string) => T
  /** Turn a value into the text of the address, or \`undefined\` to leave it out. */
  serialize?: (value: T) => string | undefined
}

const PLAIN_NUMBER = /^-?\d{1,15}(?:\.\d{1,15})?$/

function codec<T>(name: string, initial: T, options: UrlStateOptions<T>) {
  const kind = typeof initial
  const plain = kind === 'string' || kind === 'number' || kind === 'boolean'
  if (!plain && (!options.parse || !options.serialize))
    throw new Error(
      `urlState("${name}"): a value that is not a string, a number or a boolean needs both parse and serialize, which say how it is written in the address.`,
    )
  const parse =
    options.parse ??
    ((text: string): T => {
      if (kind === 'number') {
        if (!PLAIN_NUMBER.test(text)) throw new Error('not a number')
        return Number(text) as T
      }
      if (kind === 'boolean') {
        if (text !== 'true' && text !== 'false') throw new Error('not a boolean')
        return (text === 'true') as T
      }
      return text as T
    })
  const serialize = options.serialize ?? ((value: T): string | undefined => String(value))
  return { parse, serialize }
}

/**
 * State that is shown in the address, as the query parameter \`name\`: \`?page=2\`. A link to that address opens the page
 * with it set, and the back button and the router's navigation change it. A string, a number and a boolean need
 * nothing more; for another kind give \`parse\` and \`serialize\`. When the value is the initial one the parameter is left
 * out, so the address stays clean. A change replaces the address and does not add a history entry, so the back button
 * leaves the page and does not step through the values; the rest of the address is kept. Where there is no window it is a
 * plain signal.
 */
export function urlState<T>(name: string, initial: T, options: UrlStateOptions<T> = {}): Signal<T> {
  const { parse, serialize } = codec(name, initial, options)
  const signal = state(initial)
  const entry = register(signal as Signal<unknown>, initial)
  if (typeof window === 'undefined' || typeof window.history === 'undefined') return signal
  const win = window

  const read = (): T => {
    const text = new URLSearchParams(win.location.search).get(name)
    if (text === null) return initial
    try {
      return parse(text)
    } catch {
      return initial
    }
  }
  const textOf = (value: T): string | undefined => {
    try {
      return serialize(value)
    } catch {
      return undefined
    }
  }
  const startText = textOf(initial)

  signal.value = read()

  const write = (value: T) => {
    const url = new URL(win.location.href)
    const text = textOf(value)
    if (text === undefined || text === startText) url.searchParams.delete(name)
    else url.searchParams.set(name, text)
    const next = url.pathname + url.search + url.hash
    if (next !== win.location.pathname + win.location.search + win.location.hash)
      win.history.replaceState(win.history.state, '', next)
  }

  let first = true
  effect(() => {
    const value = signal.value
    // At the start the signal holds what the address says, so there is nothing to write.
    if (first) {
      first = false
      return
    }
    write(value)
  })

  const follow = () => {
    signal.value = read()
  }
  win.addEventListener('popstate', follow)
  win.addEventListener('tessera:navigate', follow)

  entry.afterReset = () => write(initial)
  return signal
}
