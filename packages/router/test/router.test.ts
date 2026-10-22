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

void flush
