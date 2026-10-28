// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, getRenderer, flush } from '@tessera/core'
import {
  createRouter,
  navigate,
  shouldHandleClick,
  useRoute,
  type PageModule,
  type Router,
  type RouteDefinition,
} from '../src'

const page =
  (name: string, title?: string): (() => Promise<PageModule>) =>
  async () => ({
    page: title ? { title } : undefined,
    default: defineComponent(name, {}, () => {
      const r = getRenderer()
      return r.el('main', { attrs: { 'data-page': name } }, r.el('h1', {}, name))
    }),
  })

const routes: RouteDefinition[] = [
  { path: '/', load: page('home', 'Home') },
  { path: '/about', load: page('about', 'About') },
  { path: '/blog', load: page('blog') },
  { path: '/blog/:slug', load: page('post', 'Post') },
]

let container: HTMLElement
let router: Router

const start = async (url = '/', options: { notFound?: RouteDefinition['load'] } = {}) => {
  window.history.replaceState(null, '', url)
  router = createRouter({ routes, ...options })
  await router.mount(container)
}

beforeEach(() => {
  document.title = ''
  document.body.innerHTML = '<div id="app"></div>'
  container = document.getElementById('app')!
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  window.scrollTo = vi.fn() as never
})

afterEach(() => {
  router?.unmount()
  vi.useRealTimers()
})

const shown = () => container.querySelector('[data-page]')?.getAttribute('data-page')

describe('router: showing the page for the address', () => {
  it('shows the page for the current address and sets the title', async () => {
    await start('/about')
    expect(shown()).toBe('about')
    expect(document.title).toBe('About')
  })

  it('captures parameters and the query string for useRoute()', async () => {
    await start('/blog/hello%20world?draft=1&draft=2&x=y#top')
    const route = useRoute()
    expect(shown()).toBe('post')
    expect(route.path).toBe('/blog/hello%20world')
    expect(route.params).toEqual({ slug: 'hello world' })
    expect(route.query).toEqual({ draft: '1', x: 'y' })
    expect(route.hash).toBe('#top')
  })

  it('shows the built-in not-found page when nothing matches and there is no 404 page', async () => {
    await start('/nope')
    expect(container.textContent).toContain('Page not found')
    expect(container.textContent).toContain('Nothing is at /nope.')
    expect(document.title).toBe('Page not found')
  })

  it('shows the app 404 page when there is one', async () => {
    await start('/nope', { notFound: page('missing', 'Missing') })
    expect(shown()).toBe('missing')
    expect(document.title).toBe('Missing')
  })
})

describe('router: navigate()', () => {
  it('changes page, adds a history entry and updates useRoute()', async () => {
    await start('/')
    const before = window.history.length
    await navigate('/blog/first')
    expect(shown()).toBe('post')
    expect(window.location.pathname).toBe('/blog/first')
    expect(window.history.length).toBe(before + 1)
    expect(useRoute().params).toEqual({ slug: 'first' })
    expect(document.title).toBe('Post')
  })

  it('replaces the entry with { replace: true }', async () => {
    await start('/')
    const before = window.history.length
    await navigate('/about', { replace: true })
    expect(window.history.length).toBe(before)
    expect(window.location.pathname).toBe('/about')
  })

  it('refuses an address that would run script, and hands other sites to the browser', async () => {
    const assign = vi.fn()
    const bound = (target: object, name: PropertyKey) => {
      const value = (target as Record<PropertyKey, unknown>)[name]
      return typeof value === 'function' ? value.bind(target) : value
    }
    // The real location cannot be replaced piece by piece, so the router gets a plain one that records assign().
    const location = { href: window.location.href, origin: window.location.origin, assign }
    const win = new Proxy(window, {
      get: (target, name) => (name === 'location' ? location : bound(target, name)),
    })
    window.history.replaceState(null, '', '/')
    router = createRouter({ routes, window: win })
    await router.mount(container)
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      '  javascript:alert(1)',
      'java	script:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'mailto:someone@example.com',
    ]) {
      await expect(router.navigate(bad), bad).rejects.toThrow(
        /will not go to .*: only http and https/,
      )
    }
    expect(assign).not.toHaveBeenCalled()
    await router.navigate('https://example.com/x?y=1')
    expect(assign).toHaveBeenCalledWith('https://example.com/x?y=1')
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('scrolls to the element of the hash when the app starts on an address that has one', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    const pageWithTarget: () => Promise<PageModule> = async () => ({
      default: defineComponent('target', {}, () => {
        const r = getRenderer()
        return r.el(
          'main',
          { attrs: { 'data-page': 'target' } },
          r.el('h2', { attrs: { id: 'deep' } }, 'Deep'),
        )
      }),
    })
    window.history.replaceState(null, '', '/about#deep')
    router = createRouter({ routes: [{ path: '/about', load: pageWithTarget }] })
    await router.mount(container)
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(scrolled.mock.contexts[0]).toBe(document.getElementById('deep'))
  })

  it('does not scroll on start for a hash that has no element, or no hash', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    await start('/about#nowhere')
    router.unmount()
    await start('/about')
    expect(scrolled).not.toHaveBeenCalled()
  })

  it('moves focus to the new page without scrolling, and scrolls to the top', async () => {
    await start('/')
    await navigate('/about')
    const main = container.querySelector('main') as HTMLElement
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(main)
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('does not take focus for the first page', async () => {
    await start('/about')
    expect(document.activeElement).toBe(document.body)
  })

  it('announces the new page politely', async () => {
    await start('/')
    await navigate('/about')
    vi.advanceTimersByTime(60)
    const live = document.querySelector('[data-tessera-announcer]')!
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.getAttribute('role')).toBe('status')
    expect(live.textContent).toBe('Navigated to About')
  })

  it('announces the path when a page has no title', async () => {
    await start('/')
    await navigate('/blog')
    vi.advanceTimersByTime(60)
    expect(document.querySelector('[data-tessera-announcer]')!.textContent).toBe(
      'Navigated to /blog',
    )
  })

  it('lets the newest navigation win when an earlier page loads slowly', async () => {
    let release!: () => void
    const slow: RouteDefinition = {
      path: '/slow',
      load: () => new Promise((resolve) => (release = () => void page('slow')().then(resolve))),
    }
    window.history.replaceState(null, '', '/')
    router = createRouter({ routes: [...routes, slow] })
    await router.mount(container)
    const first = navigate('/slow')
    await navigate('/about')
    release()
    await first
    expect(shown()).toBe('about')
    expect(window.location.pathname).toBe('/about')
  })

  it('leaves the current page and address alone when a page fails to load', async () => {
    window.history.replaceState(null, '', '/')
    router = createRouter({
      routes: [...routes, { path: '/broken', load: () => Promise.reject(new Error('offline')) }],
    })
    await router.mount(container)
    await expect(navigate('/broken')).rejects.toThrow('offline')
    expect(shown()).toBe('home')
    expect(window.location.pathname).toBe('/')
  })

  it('treats a trailing slash like the same route', async () => {
    await start('/')
    await navigate('/about/')
    expect(shown()).toBe('about')
  })
})

describe('router: back and forward', () => {
  it('shows the earlier page on popstate and restores the scroll position', async () => {
    await start('/')
    Object.defineProperty(window, 'scrollY', { value: 240, configurable: true })
    await navigate('/about')
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    ;(window.scrollTo as ReturnType<typeof vi.fn>).mockClear()

    window.history.back()
    await vi.waitFor(() => expect(shown()).toBe('home'))
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 240)
    expect(document.title).toBe('Home')
  })
})

describe('navigate() without an app', () => {
  it('says what to do', async () => {
    router?.unmount()
    await expect(navigate('/x')).rejects.toThrow(
      'navigate() was called before the app was created. Call createApp().mount() first.',
    )
  })
})

describe('shouldHandleClick', () => {
  const anchor = (attrs: Record<string, string> = {}) => {
    const a = document.createElement('a')
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
    return a
  }

  it('handles a plain left click', () => {
    expect(shouldHandleClick({ button: 0, currentTarget: anchor() })).toBe(true)
  })

  it('leaves modified clicks, other buttons, prevented events, downloads and other targets to the browser', () => {
    expect(shouldHandleClick({ button: 0, ctrlKey: true, currentTarget: anchor() })).toBe(false)
    expect(shouldHandleClick({ button: 0, metaKey: true, currentTarget: anchor() })).toBe(false)
    expect(shouldHandleClick({ button: 0, shiftKey: true, currentTarget: anchor() })).toBe(false)
    expect(shouldHandleClick({ button: 0, altKey: true, currentTarget: anchor() })).toBe(false)
    expect(shouldHandleClick({ button: 1, currentTarget: anchor() })).toBe(false)
    expect(shouldHandleClick({ button: 0, defaultPrevented: true, currentTarget: anchor() })).toBe(
      false,
    )
    expect(shouldHandleClick({ button: 0, currentTarget: anchor({ download: '' }) })).toBe(false)
    expect(shouldHandleClick({ button: 0, currentTarget: anchor({ target: '_blank' }) })).toBe(
      false,
    )
    expect(shouldHandleClick({ button: 0, currentTarget: anchor({ target: '_self' }) })).toBe(true)
  })
})

describe('the tessera:navigate event', () => {
  it('fires on the window after a page is shown, so state kept in the address can read it again', async () => {
    await start('/')
    const heard: string[] = []
    const listener = () => heard.push(window.location.pathname + window.location.search)
    window.addEventListener('tessera:navigate', listener)
    await router.navigate('/about?tab=2')
    window.removeEventListener('tessera:navigate', listener)
    expect(heard).toEqual(['/about?tab=2'])
  })

  it('does not fire for the first page, which nothing is moving from', async () => {
    const heard: string[] = []
    const listener = () => heard.push('x')
    window.addEventListener('tessera:navigate', listener)
    await start('/about')
    window.removeEventListener('tessera:navigate', listener)
    expect(heard).toEqual([])
  })

  it('fires after the back button, too, once the address is the page the person went back to', async () => {
    await start('/')
    await router.navigate('/about')
    const heard: string[] = []
    const listener = () => heard.push(window.location.pathname)
    window.addEventListener('tessera:navigate', listener)
    window.history.back()
    await vi.advanceTimersByTimeAsync(50)
    await router.settled()
    window.removeEventListener('tessera:navigate', listener)
    expect(heard).toEqual(['/'])
  })
})

describe('settled: waiting for a navigation to finish', () => {
  const slow = (name: string, ms: number): (() => Promise<PageModule>) => {
    const load = page(name)
    return () => new Promise((resolve) => setTimeout(() => resolve(load()), ms))
  }

  it('resolves at once when nothing is loading', async () => {
    await start('/')
    await expect(router.settled()).resolves.toBeUndefined()
  })

  it('waits for the page that a click or a call started to load and show, so a test need not sleep', async () => {
    window.history.replaceState(null, '', '/')
    router = createRouter({
      routes: [
        { path: '/', load: page('home') },
        { path: '/slow', load: slow('slow', 300) },
      ],
    })
    await router.mount(container)
    void router.navigate('/slow')
    let done = false
    const waiting = router.settled().then(() => (done = true))
    await vi.advanceTimersByTimeAsync(100)
    expect(done).toBe(false)
    expect(container.querySelector('h1')!.textContent).toBe('home')
    await vi.advanceTimersByTimeAsync(300)
    await waiting
    expect(container.querySelector('h1')!.textContent).toBe('slow')
  })

  it('waits for the newest navigation when a newer one replaces an older one', async () => {
    window.history.replaceState(null, '', '/')
    router = createRouter({
      routes: [
        { path: '/', load: page('home') },
        { path: '/a', load: slow('a', 400) },
        { path: '/b', load: slow('b', 100) },
      ],
    })
    await router.mount(container)
    void router.navigate('/a')
    void router.navigate('/b')
    const waiting = router.settled()
    await vi.advanceTimersByTimeAsync(500)
    await waiting
    expect(container.querySelector('h1')!.textContent).toBe('b')
  })

  it('resolves, and does not hang, when a page fails to load', async () => {
    window.history.replaceState(null, '', '/')
    router = createRouter({
      routes: [
        { path: '/', load: page('home') },
        { path: '/broken', load: () => Promise.reject(new Error('offline')) },
      ],
    })
    await router.mount(container)
    const failed = router.navigate('/broken').catch((e: Error) => e.message)
    await router.settled()
    await expect(failed).resolves.toBe('offline')
  })
})

void flush
