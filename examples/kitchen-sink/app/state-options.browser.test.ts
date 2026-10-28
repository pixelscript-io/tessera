/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flush, persisted, resetState, urlState } from '@pixelscriptio/tessera/core'
import {
  createRouter,
  layoutsFromModules,
  routesFromModules,
  type Router,
} from '@pixelscriptio/tessera/router'

// The options of shared state, in a real browser: the real storage, the real address and the real router.
const fromGlob = routesFromModules(import.meta.glob('./pages/**/*.tess'), './pages')
const layouts = layoutsFromModules(import.meta.glob('./layouts/*.tess'), './layouts')
const startUrl = location.pathname + location.search

let container: HTMLElement
let router: Router | undefined

beforeEach(() => {
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  resetState()
  router?.unmount()
  router = undefined
  container.remove()
  localStorage.clear()
  history.replaceState(null, '', startUrl)
})

describe('persisted, in a browser', () => {
  it('is there again when the page is loaded again, which is a new run of the file that makes it', () => {
    const items = persisted('kitchen-sink:items', ['a'])
    items.value = ['a', 'b']
    flush()
    // A reload runs the state file again: the second one finds what the first kept.
    const again = persisted('kitchen-sink:items', ['a'])
    expect(again.value).toEqual(['a', 'b'])
  })

  it('keeps what the person typed, for the next visit, and forgets it on reset', () => {
    const theme = persisted('kitchen-sink:theme', 'light')
    theme.value = 'dark'
    flush()
    expect(JSON.parse(localStorage.getItem('kitchen-sink:theme')!)).toEqual({ v: 1, value: 'dark' })
    resetState()
    expect(theme.value).toBe('light')
    expect(localStorage.getItem('kitchen-sink:theme')).toBeNull()
  })

  it('moves an older shape to the new one, once', () => {
    localStorage.setItem('kitchen-sink:prefs', JSON.stringify({ v: 1, value: 'big' }))
    const prefs = persisted(
      'kitchen-sink:prefs',
      { size: 'normal' },
      {
        version: 2,
        migrate: (old) => ({ size: String(old) }),
      },
    )
    expect(prefs.value).toEqual({ size: 'big' })
    expect(JSON.parse(localStorage.getItem('kitchen-sink:prefs')!).v).toBe(2)
  })
})

describe('urlState, with the router', () => {
  const start = async (url: string) => {
    history.replaceState(null, '', url)
    router = createRouter({ ...fromGlob, layouts })
    await router.mount(container)
  }

  it('starts from the address a link opened', async () => {
    history.replaceState(null, '', '/blog?page=4')
    const page = urlState('page', 1)
    await start('/blog?page=4')
    expect(page.value).toBe(4)
  })

  it('follows the router when it goes to another address, and when it goes back', async () => {
    const page = urlState('page', 1)
    await start('/blog')
    expect(page.value).toBe(1)
    await router!.navigate('/blog?page=2')
    expect(page.value).toBe(2)
    await router!.navigate('/about')
    expect(page.value).toBe(1)
    history.back()
    await new Promise<void>((resolve) =>
      addEventListener('popstate', () => resolve(), { once: true }),
    )
    await router!.settled()
    expect(page.value).toBe(2)
  })

  it('puts a change in the address that can be shared, and keeps the router working', async () => {
    const page = urlState('page', 1)
    await start('/blog')
    page.value = 3
    flush()
    expect(location.pathname + location.search).toBe('/blog?page=3')
    // The router still knows where it is: it can go on from here.
    await router!.navigate('/about')
    expect(location.pathname).toBe('/about')
  })
})
