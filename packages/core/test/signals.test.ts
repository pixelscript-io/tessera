import { describe, expect, it, vi } from 'vitest'
import { createRoot, derived, effect, flush, onCleanup, state, untrack } from '../src'

describe('state', () => {
  it('reads, writes, and peeks', () => {
    const s = state(1)
    s.value = 2
    expect(s.value).toBe(2)
    expect(s.peek()).toBe(2)
  })

  it('does not notify when set to an identical value', () => {
    const s = state(1)
    const spy = vi.fn()
    effect(() => spy(s.value))
    s.value = 1
    flush()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('derived', () => {
  it('is lazy and memoized', () => {
    const a = state(1)
    const fn = vi.fn(() => a.value * 2)
    const d = derived(fn)
    expect(fn).not.toHaveBeenCalled()
    expect(d.value).toBe(2)
    expect(d.value).toBe(2)
    expect(fn).toHaveBeenCalledTimes(1)
    a.value = 5
    expect(fn).toHaveBeenCalledTimes(1)
    expect(d.value).toBe(10)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('is glitch-free in a diamond: the effect runs once with consistent values', () => {
    const a = state(1)
    const left = derived(() => a.value + 1)
    const right = derived(() => a.value * 10)
    const seen: Array<[number, number]> = []
    effect(() => seen.push([left.value, right.value]))
    a.value = 2
    flush()
    expect(seen).toEqual([
      [2, 10],
      [3, 20],
    ])
  })

  it('computes the join node of a diamond once per change', () => {
    const a = state(1)
    const left = derived(() => a.value + 1)
    const right = derived(() => a.value + 2)
    const join = vi.fn(() => left.value + right.value)
    const sum = derived(join)
    effect(() => void sum.value)
    a.value = 2
    flush()
    expect(join).toHaveBeenCalledTimes(2)
  })

  it('cuts off propagation when a derived value is unchanged', () => {
    const a = state(1)
    const parity = derived(() => a.value % 2)
    const spy = vi.fn()
    effect(() => spy(parity.value))
    a.value = 3
    flush()
    expect(spy).toHaveBeenCalledTimes(1)
    a.value = 4
    flush()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('tracks dependencies dynamically', () => {
    const useA = state(true)
    const a = state('a')
    const b = state('b')
    const fn = vi.fn(() => (useA.value ? a.value : b.value))
    const d = derived(fn)
    expect(d.value).toBe('a')
    b.value = 'b2'
    expect(d.value).toBe('a')
    expect(fn).toHaveBeenCalledTimes(1)
    useA.value = false
    expect(d.value).toBe('b2')
    a.value = 'a2'
    expect(d.value).toBe('b2')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('effect', () => {
  it('runs immediately and re-runs in a microtask, batching writes', async () => {
    const a = state(1)
    const b = state(1)
    const spy = vi.fn()
    effect(() => spy(a.value + b.value))
    expect(spy).toHaveBeenCalledTimes(1)
    a.value = 2
    b.value = 3
    expect(spy).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenLastCalledWith(5)
  })

  it('stops running after disposal', () => {
    const a = state(1)
    const spy = vi.fn()
    const dispose = effect(() => spy(a.value))
    dispose()
    a.value = 2
    flush()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('runs cleanups before each re-run and on disposal', () => {
    const a = state(1)
    const log: string[] = []
    const dispose = effect(() => {
      const v = a.value
      log.push(`run ${v}`)
      onCleanup(() => log.push(`cleanup ${v}`))
    })
    a.value = 2
    flush()
    dispose()
    expect(log).toEqual(['run 1', 'cleanup 1', 'run 2', 'cleanup 2'])
  })

  it('re-runs when it writes to a signal it reads, up to a guard', () => {
    const a = state(0)
    effect(() => {
      if (a.value < 3) a.value++
    })
    flush()
    expect(a.value).toBe(3)

    const loop = state(0)
    effect(() => {
      loop.value = loop.value + 1
    })
    expect(() => flush()).toThrow(/kept re-triggering/)
  })

  it('does not subscribe to reads inside untrack', () => {
    const a = state(1)
    const b = state(1)
    const spy = vi.fn()
    effect(() => spy(a.value + untrack(() => b.value)))
    b.value = 2
    flush()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reading a stale derived value inside an effect that just changed its source is consistent', () => {
    const a = state(1)
    const doubled = derived(() => a.value * 2)
    let observed = 0
    effect(() => {
      a.value // subscribe
      observed = doubled.value
    })
    a.value = 4
    flush()
    expect(observed).toBe(8)
  })
})

describe('nested effects and disposal', () => {
  it('disposes inner effects when the outer effect re-runs', () => {
    const outer = state(1)
    const inner = state(0)
    const innerSpy = vi.fn()
    effect(() => {
      outer.value
      effect(() => innerSpy(inner.value))
    })
    expect(innerSpy).toHaveBeenCalledTimes(1)
    outer.value = 2
    flush()
    expect(innerSpy).toHaveBeenCalledTimes(2)
    inner.value = 1
    flush()
    // Only the newest inner effect is alive.
    expect(innerSpy).toHaveBeenCalledTimes(3)
  })

  it('disposing the outer effect disposes inner effects and runs their cleanups', () => {
    const inner = state(0)
    const spy = vi.fn()
    const cleanup = vi.fn()
    const dispose = effect(() => {
      effect(() => {
        spy(inner.value)
        onCleanup(cleanup)
      })
    })
    dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
    inner.value = 1
    flush()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not re-run an inner effect that was disposed earlier in the same flush', () => {
    const a = state(0)
    const spy = vi.fn()
    effect(() => {
      a.value
      effect(() => spy(a.value))
    })
    spy.mockClear()
    a.value = 1
    flush()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('createRoot disposal tears down everything inside', () => {
    const a = state(0)
    const spy = vi.fn()
    const cleanup = vi.fn()
    const dispose = createRoot((dispose) => {
      effect(() => {
        spy(a.value)
        onCleanup(cleanup)
      })
      return dispose
    })
    dispose()
    a.value = 1
    flush()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('disposed derived values stop tracking', () => {
    const a = state(1)
    const fn = vi.fn(() => a.value)
    const dispose = createRoot((dispose) => {
      derived(fn).value
      return dispose
    })
    dispose()
    a.value = 2
    flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('onCleanup outside a scope is an error', () => {
    expect(() => onCleanup(() => {})).toThrow(/outside of an effect or root scope/)
  })
})
