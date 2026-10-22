/**
 * Fine-grained signals: `state`, `derived` (lazy, memoized), `effect`.
 *
 * Push-pull with three node states (clean / check / dirty), so derived values
 * are glitch-free: a write marks direct observers dirty and everything further
 * downstream "check"; a node only recomputes if a source actually changed.
 * Effects flush in a microtask.
 */

const CLEAN = 0
const CHECK = 1
const DIRTY = 2
type NodeState = typeof CLEAN | typeof CHECK | typeof DIRTY

export interface ReadonlySignal<T> {
  readonly value: T
  /** Read without subscribing the current effect or derived value. */
  peek(): T
}

export interface Signal<T> extends ReadonlySignal<T> {
  value: T
}

interface Source {
  observers: Set<Computation<unknown>>
}

class Owner {
  children: Set<Owner> | null = null
  cleanups: Array<() => void> | null = null
  disposed = false

  constructor(readonly parent: Owner | null) {
    if (parent) (parent.children ??= new Set()).add(this)
  }

  /** Dispose child scopes and run registered cleanups, keeping this owner alive. */
  protected cleanup(): void {
    const children = this.children
    const cleanups = this.cleanups
    this.children = null
    this.cleanups = null
    if (children) for (const child of children) child.dispose()
    if (cleanups) for (const fn of cleanups) fn()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cleanup()
    this.parent?.children?.delete(this)
  }
}

let currentOwner: Owner | null = null
let currentObserver: Computation<unknown> | null = null

const queue: Array<Computation<unknown>> = []
let flushScheduled = false
const MAX_FLUSH_PASSES = 1000

function schedule(effect: Computation<unknown>): void {
  queue.push(effect)
  if (!flushScheduled) {
    flushScheduled = true
    queueMicrotask(flush)
  }
}

/** Run all pending effects now instead of waiting for the microtask. */
export function flush(): void {
  flushScheduled = false
  let passes = 0
  while (queue.length > 0) {
    if (++passes > MAX_FLUSH_PASSES) {
      queue.length = 0
      throw new Error(
        `Effects kept re-triggering each other for ${MAX_FLUSH_PASSES} passes. Check for an effect that writes a signal it also reads.`,
      )
    }
    const pending = queue.splice(0)
    for (const effect of pending) {
      if (!effect.disposed) effect.updateIfNecessary()
    }
  }
}

class Computation<T> extends Owner implements Source {
  observers = new Set<Computation<unknown>>()
  sources: Source[] = []
  state: NodeState = DIRTY
  value: T | undefined = undefined

  constructor(
    private fn: () => T,
    readonly isEffect: boolean,
    parent: Owner | null,
  ) {
    super(parent)
  }

  stale(state: NodeState): void {
    if (this.state >= state) return
    const wasClean = this.state === CLEAN
    this.state = state
    if (!wasClean) return
    if (this.isEffect) schedule(this)
    else for (const observer of this.observers) observer.stale(CHECK)
  }

  updateIfNecessary(): void {
    if (this.disposed) return
    if (this.state === CHECK) {
      for (const source of [...this.sources]) {
        if (source instanceof Computation) {
          source.updateIfNecessary()
          if ((this.state as NodeState) === DIRTY) break
        }
      }
    }
    if (this.state === DIRTY) this.update()
    else this.state = CLEAN
  }

  private update(): void {
    this.cleanup()
    this.unlinkSources()
    // Clean before running so a write to our own dependency re-dirties us.
    this.state = CLEAN
    const prevOwner = currentOwner
    const prevObserver = currentObserver
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- module-level tracking context
    currentOwner = this
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- module-level tracking context
    currentObserver = this
    const previous = this.value
    try {
      this.value = this.fn()
    } finally {
      currentOwner = prevOwner
      currentObserver = prevObserver
    }
    if (!this.isEffect && !Object.is(previous, this.value)) {
      for (const observer of this.observers) observer.state = DIRTY
    }
  }

  private unlinkSources(): void {
    for (const source of this.sources) source.observers.delete(this)
    this.sources = []
  }

  override dispose(): void {
    if (this.disposed) return
    super.dispose()
    this.unlinkSources()
    this.observers.clear()
  }
}

function track(source: Source): void {
  if (currentObserver && !currentObserver.disposed) {
    currentObserver.sources.push(source)
    source.observers.add(currentObserver)
  }
}

class StateSignal<T> implements Signal<T>, Source {
  observers = new Set<Computation<unknown>>()

  constructor(private current: T) {}

  get value(): T {
    track(this)
    return this.current
  }

  set value(next: T) {
    if (Object.is(next, this.current)) return
    this.current = next
    for (const observer of [...this.observers]) observer.stale(DIRTY)
  }

  peek(): T {
    return this.current
  }
}

class DerivedSignal<T> implements ReadonlySignal<T> {
  constructor(private readonly node: Computation<T>) {}

  get value(): T {
    this.node.updateIfNecessary()
    track(this.node)
    return this.node.value as T
  }

  peek(): T {
    this.node.updateIfNecessary()
    return this.node.value as T
  }
}

/** A writable reactive value. Read and write with `.value`. */
export function state<T>(initial: T): Signal<T> {
  return new StateSignal(initial)
}

/** A lazy, memoized value computed from other signals. Must be pure. */
export function derived<T>(fn: () => T): ReadonlySignal<T> {
  return new DerivedSignal(new Computation(fn, false, currentOwner))
}

/**
 * Run `fn` now and again whenever a signal it read changes. Effects created
 * inside another effect or root are disposed with it. Returns a disposer.
 */
export function effect(fn: () => void): () => void {
  const node = new Computation(fn, true, currentOwner)
  node.updateIfNecessary()
  return () => node.dispose()
}

/** Register cleanup to run before the current effect re-runs and when it is disposed. */
export function onCleanup(fn: () => void): void {
  if (!currentOwner) throw new Error('onCleanup() was called outside of an effect or root scope.')
  ;(currentOwner.cleanups ??= []).push(fn)
}

/** Run `fn` in a new, detached scope. Calling the disposer tears down everything created inside. */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  return runInScope(new Owner(null), fn)
}

/** Run `fn` without subscribing the current effect or derived value to what it reads. */
export function untrack<T>(fn: () => T): T {
  const prev = currentObserver
  currentObserver = null
  try {
    return fn()
  } finally {
    currentObserver = prev
  }
}

/** @internal Used by the renderer to create scopes that outlive the effect that created them. */
export function getOwner(): Owner | null {
  return currentOwner
}

/** @internal */
export function createScope(parent: Owner | null): Owner {
  return new Owner(parent)
}

/** @internal Run `fn` inside `scope`, untracked. */
export function runInScope<T>(scope: Owner, fn: (dispose: () => void) => T): T {
  const prevOwner = currentOwner
  const prevObserver = currentObserver
  currentOwner = scope
  currentObserver = null
  try {
    return fn(() => scope.dispose())
  } finally {
    currentOwner = prevOwner
    currentObserver = prevObserver
  }
}

export type { Owner }

class ConstantSignal<T> implements ReadonlySignal<T> {
  constructor(private readonly current: T) {}

  get value(): T {
    return this.current
  }

  peek(): T {
    return this.current
  }
}

/** A read-only signal that never changes. Used for static component props. */
export function constant<T>(value: T): ReadonlySignal<T> {
  return new ConstantSignal(value)
}

export function isSignal(value: unknown): value is ReadonlySignal<unknown> {
  return (
    value instanceof StateSignal ||
    value instanceof DerivedSignal ||
    value instanceof ConstantSignal
  )
}

/** The value of a signal, or the value itself when it is not one. Templates use this for bare names. */
export function unwrap<T>(value: T | ReadonlySignal<T>): T {
  return isSignal(value) ? (value.value as T) : value
}

/** Run `fn` once after the component has been created and attached, unless it was disposed first. */
export function onMount(fn: () => void): void {
  const owner = currentOwner
  if (!owner) throw new Error('onMount() was called outside of a component or root scope.')
  queueMicrotask(() => {
    if (!owner.disposed) runInScope(owner, fn)
  })
}
