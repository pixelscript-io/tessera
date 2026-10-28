// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __beginStateFile, effect, flush, persisted, resetState, state, urlState } from '../src'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  resetState()
  vi.unstubAllGlobals()
})

const stored = (key: string) => localStorage.getItem(key)

describe('persisted', () => {
  it('starts with the initial value when nothing is stored, and keeps what it is given afterwards', () => {
    const items = persisted('items', ['a'])
    expect(items.value).toEqual(['a'])
    items.value = ['a', 'b']
    flush()
    expect(JSON.parse(stored('items')!)).toEqual({ v: 1, value: ['a', 'b'] })
  })

  it('starts from what an earlier visit stored', () => {
    localStorage.setItem('theme', JSON.stringify({ v: 1, value: 'dark' }))
    expect(persisted('theme', 'light').value).toBe('dark')
  })

  it('does not write when it is created, only when it changes', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const count = persisted('count', 0)
    flush()
    expect(setItem).not.toHaveBeenCalled()
    count.value = 1
    flush()
    expect(setItem).toHaveBeenCalledTimes(1)
    setItem.mockRestore()
  })

  it('is a signal: an effect that reads it runs again when it changes', () => {
    const count = persisted('count', 0)
    const seen: number[] = []
    effect(() => void seen.push(count.value))
    count.value = 2
    flush()
    expect(seen).toEqual([0, 2])
  })

  describe('a version and a migration', () => {
    it('forgets a value written by another version when there is no migration', () => {
      localStorage.setItem('prefs', JSON.stringify({ v: 1, value: { size: 'big' } }))
      expect(persisted('prefs', { size: 'normal' }, { version: 2 }).value).toEqual({
        size: 'normal',
      })
    })

    it('hands an older value and its version to the migration, and keeps what it returns', () => {
      localStorage.setItem('prefs', JSON.stringify({ v: 1, value: { size: 'big' } }))
      const migrate = vi.fn((old: unknown, from: number) => ({
        ...(old as { size: string }),
        zoom: from + 1,
      }))
      const prefs = persisted<{ size: string; zoom?: number }>(
        'prefs',
        { size: 'normal' },
        { version: 2, migrate },
      )
      expect(migrate).toHaveBeenCalledWith({ size: 'big' }, 1)
      expect(prefs.value).toEqual({ size: 'big', zoom: 2 })
      // The new form is written back at once, so the migration does not run again next time.
      expect(JSON.parse(stored('prefs')!)).toEqual({ v: 2, value: { size: 'big', zoom: 2 } })
    })

    it('goes back to the initial value when the migration throws', () => {
      localStorage.setItem('prefs', JSON.stringify({ v: 1, value: 1 }))
      const prefs = persisted('prefs', 5, {
        version: 2,
        migrate: () => {
          throw new Error('cannot')
        },
      })
      expect(prefs.value).toBe(5)
    })

    it('does not migrate a value of the current version, and does not accept one from a newer one', () => {
      const migrate = vi.fn((old: unknown) => old as number)
      localStorage.setItem('n', JSON.stringify({ v: 2, value: 7 }))
      expect(persisted('n', 0, { version: 2, migrate }).value).toBe(7)
      expect(migrate).not.toHaveBeenCalled()
      localStorage.setItem('n2', JSON.stringify({ v: 3, value: 9 }))
      expect(persisted('n2', 0, { version: 2, migrate }).value).toBe(0)
    })
  })

  describe('what is stored may be anything', () => {
    it.each([
      ['not JSON', 'oops {'],
      ['not an object', '42'],
      ['null', 'null'],
      ['an array', '[1]'],
      ['no version', '{"value":1}'],
      ['a version that is not a number', '{"v":"1","value":1}'],
      ['no value', '{"v":1}'],
    ])('uses the initial value for %s', (_name, text) => {
      localStorage.setItem('x', text)
      expect(persisted('x', 'start').value).toBe('start')
    })

    it('uses the initial value when the check says what was stored is not the right shape', () => {
      localStorage.setItem('n', JSON.stringify({ v: 1, value: 'text' }))
      const n = persisted('n', 0, { validate: (v): v is number => typeof v === 'number' })
      expect(n.value).toBe(0)
      localStorage.setItem('m', JSON.stringify({ v: 1, value: 3 }))
      const m = persisted('m', 0, { validate: (v): v is number => typeof v === 'number' })
      expect(m.value).toBe(3)
    })

    it('does not let a stored value change what an object is: __proto__ is just a key', () => {
      localStorage.setItem('o', '{"v":1,"value":{"__proto__":{"polluted":true}}}')
      const o = persisted<Record<string, unknown>>('o', {})
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      expect(Object.getPrototypeOf(o.value)).toBe(Object.prototype)
    })
  })

  describe('where the storage is missing or full', () => {
    it('is a plain signal when there is no storage at all, as in a prerender', () => {
      vi.stubGlobal('localStorage', undefined)
      const count = persisted('count', 1)
      count.value = 2
      flush()
      expect(count.value).toBe(2)
    })

    it('is a plain signal when reading the storage throws, as in a window that blocks it', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(persisted('count', 1).value).toBe(1)
      vi.restoreAllMocks()
    })

    it('keeps working when a write throws because the storage is full', () => {
      const count = persisted('count', 1)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      expect(() => {
        count.value = 2
        flush()
      }).not.toThrow()
      expect(count.value).toBe(2)
      vi.restoreAllMocks()
    })

    it('uses the storage it is given', () => {
      const session = persisted('k', 'a', { storage: sessionStorage })
      session.value = 'b'
      flush()
      expect(sessionStorage.getItem('k')).toBeTruthy()
      expect(localStorage.getItem('k')).toBeNull()
    })
  })

  describe('in another tab', () => {
    const fire = (key: string | null, value: string | null) =>
      window.dispatchEvent(
        Object.assign(new Event('storage'), { key, newValue: value, storageArea: localStorage }),
      )

    it('follows a change another tab made, and does not write it back', () => {
      const theme = persisted('theme', 'light')
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      localStorage.setItem('theme', JSON.stringify({ v: 1, value: 'dark' }))
      fire('theme', JSON.stringify({ v: 1, value: 'dark' }))
      flush()
      expect(theme.value).toBe('dark')
      expect(setItem).toHaveBeenCalledTimes(1) // the test's own
      setItem.mockRestore()
    })

    it('ignores another key, a value it cannot read, and a removal it does not own', () => {
      const theme = persisted('theme', 'light')
      theme.value = 'dark'
      flush()
      fire('other', JSON.stringify({ v: 1, value: 'x' }))
      fire('theme', 'oops {')
      expect(theme.value).toBe('dark')
    })

    it('goes back to the initial value when the other tab removed the key', () => {
      const theme = persisted('theme', 'light')
      theme.value = 'dark'
      flush()
      localStorage.removeItem('theme')
      fire('theme', null)
      flush()
      expect(theme.value).toBe('light')
    })
  })
})

describe('urlState', () => {
  const url = () => window.location.pathname + window.location.search + window.location.hash

  it('starts from the address, and from the initial value when the address does not say', () => {
    expect(urlState('page', 1).value).toBe(1)
    window.history.replaceState(null, '', '/?page=4')
    expect(urlState('page2', 1).value).toBe(1)
    expect(urlState('page', 1).value).toBe(4)
  })

  it('reads and writes a string, a number and a boolean as what the initial value is', () => {
    window.history.replaceState(null, '', '/?q=hi&n=3&open=true')
    expect(urlState('q', '').value).toBe('hi')
    expect(urlState('n', 0).value).toBe(3)
    expect(urlState('open', false).value).toBe(true)
    const open = urlState('open', false)
    open.value = false
    flush()
    expect(url()).not.toContain('open')
  })

  it('puts a change in the address without adding a history entry, and keeps the rest of the address', () => {
    window.history.replaceState({ key: 7 }, '', '/list?sort=name#top')
    const length = window.history.length
    const page = urlState('page', 1)
    page.value = 3
    flush()
    expect(url()).toBe('/list?sort=name&page=3#top')
    expect(window.history.length).toBe(length)
    expect(window.history.state).toEqual({ key: 7 })
  })

  it('leaves the address clean when the value is the initial one', () => {
    const page = urlState('page', 1)
    page.value = 3
    flush()
    expect(url()).toBe('/?page=3')
    page.value = 1
    flush()
    expect(url()).toBe('/')
  })

  it('follows the back button and a navigation by the router', () => {
    const page = urlState('page', 1)
    window.history.replaceState(null, '', '/?page=5')
    window.dispatchEvent(new PopStateEvent('popstate'))
    flush()
    expect(page.value).toBe(5)
    window.history.replaceState(null, '', '/?page=6')
    window.dispatchEvent(new Event('tessera:navigate'))
    flush()
    expect(page.value).toBe(6)
    window.history.replaceState(null, '', '/')
    window.dispatchEvent(new Event('tessera:navigate'))
    flush()
    expect(page.value).toBe(1)
  })

  it('uses the initial value for text that is not a number or not a boolean, and for a number that is not plain', () => {
    window.history.replaceState(null, '', '/?n=abc&m=1e3&k=0x10&b=maybe&e=')
    expect(urlState('n', 7).value).toBe(7)
    expect(urlState('m', 7).value).toBe(7)
    expect(urlState('k', 7).value).toBe(7)
    expect(urlState('b', false).value).toBe(false)
    expect(urlState('e', 7).value).toBe(7)
  })

  it('takes a parse and a serialize for a value of another kind, and survives a parse that throws', () => {
    window.history.replaceState(null, '', '/?tags=a,b')
    const tags = urlState<string[]>('tags', [], {
      parse: (text) => text.split(','),
      serialize: (list) => (list.length ? list.join(',') : undefined),
    })
    expect(tags.value).toEqual(['a', 'b'])
    tags.value = []
    flush()
    expect(url()).toBe('/')
    window.history.replaceState(null, '', '/?x=boom')
    const x = urlState<number>('x', 1, {
      parse: () => {
        throw new Error('no')
      },
    })
    expect(x.value).toBe(1)
  })

  it('says what to do when the value is not a string, a number or a boolean and nothing says how to write it', () => {
    expect(() => urlState('tags', [] as string[])).toThrow(/parse and serialize/)
  })

  it('encodes what it writes, so a value cannot add to the address', () => {
    const q = urlState('q', '')
    q.value = 'a&b=c#d'
    flush()
    expect(window.location.search).toBe('?q=a%26b%3Dc%23d')
    expect(window.location.hash).toBe('')
  })

  it('is a plain signal when there is no window', () => {
    vi.stubGlobal('window', undefined)
    const page = urlState('page', 1)
    page.value = 2
    flush()
    expect(page.value).toBe(2)
  })
})

describe('resetState', () => {
  it('puts every persisted and url value back, and forgets what was stored and what the address said', () => {
    const theme = persisted('theme', 'light')
    const page = urlState('page', 1)
    theme.value = 'dark'
    page.value = 4
    flush()
    expect(stored('theme')).not.toBeNull()
    resetState()
    expect(theme.value).toBe('light')
    expect(page.value).toBe(1)
    expect(stored('theme')).toBeNull()
    expect(window.location.search).toBe('')
  })

  it('does not touch a state made outside a state file', () => {
    const local = state(1)
    local.value = 2
    resetState()
    expect(local.value).toBe(2)
  })

  it('does not hold on to a value nobody uses any more', () => {
    for (let i = 0; i < 100; i++) persisted(`gone-${i}`, i)
    expect(() => resetState()).not.toThrow()
  })
})

describe('a state file, as the build marks it', () => {
  const hot = () => {
    let callback: ((data: Record<string, unknown>) => void) | undefined
    return {
      data: {} as Record<string, unknown>,
      dispose(cb: (data: Record<string, unknown>) => void) {
        callback = cb
      },
      /** The module is about to be replaced: what the dev server does before it runs the new one. */
      replace() {
        const next: Record<string, unknown> = {}
        callback?.(next)
        this.data = next
      },
    }
  }

  it('makes every state created while its body runs shared, so resetState puts them back', async () => {
    __beginStateFile('app/state/cart.ts')
    const items = state<string[]>([])
    const open = state(false)
    items.value = ['x']
    open.value = true
    await Promise.resolve()
    resetState()
    expect(items.value).toEqual([])
    expect(open.value).toBe(false)
  })

  it('stops marking after the body has run: a state made later belongs to a component', async () => {
    __beginStateFile('app/state/cart.ts')
    await Promise.resolve()
    const later = state(1)
    later.value = 2
    resetState()
    expect(later.value).toBe(2)
  })

  it('keeps a state of an earlier file when a file it imports ran first', async () => {
    __beginStateFile('app/state/a.ts')
    const a = state(1)
    __beginStateFile('app/state/b.ts')
    const b = state(2)
    a.value = 10
    b.value = 20
    await Promise.resolve()
    resetState()
    expect([a.value, b.value]).toEqual([1, 2])
  })

  it('keeps the values across a hot update, state by state, when the code did not change them', async () => {
    const h = hot()
    __beginStateFile('app/state/cart.ts', h)
    const items = state<string[]>([])
    const count = state(0)
    items.value = ['a', 'b']
    count.value = 5
    await Promise.resolve()
    h.replace()
    // The module runs again, as the dev server does after an edit.
    __beginStateFile('app/state/cart.ts', h)
    const items2 = state<string[]>([])
    const count2 = state(0)
    await Promise.resolve()
    expect(items2.value).toEqual(['a', 'b'])
    expect(count2.value).toBe(5)
  })

  it('does not keep a value when the person changed the initial one in the code', async () => {
    const h = hot()
    __beginStateFile('app/state/cart.ts', h)
    const count = state(0)
    count.value = 5
    await Promise.resolve()
    h.replace()
    __beginStateFile('app/state/cart.ts', h)
    const changed = state(100)
    await Promise.resolve()
    expect(changed.value).toBe(100)
    void count
  })

  it('does not keep a value it cannot write down, and does not fail', async () => {
    const h = hot()
    __beginStateFile('app/state/cart.ts', h)
    const map = state(new Map([[1, 2]]))
    map.value.set(3, 4)
    await Promise.resolve()
    expect(() => h.replace()).not.toThrow()
    __beginStateFile('app/state/cart.ts', h)
    const again = state(new Map([[1, 2]]))
    await Promise.resolve()
    expect(again.value.size).toBe(1)
  })

  it('does nothing extra outside the dev server, where there is no hot object', async () => {
    __beginStateFile('app/state/cart.ts', undefined)
    const count = state(0)
    count.value = 1
    await Promise.resolve()
    expect(count.value).toBe(1)
  })
})
