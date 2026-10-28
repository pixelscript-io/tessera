// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllApis,
  createApi,
  createStringAdapter,
  createStringNode,
  dataScript,
  defineComponent,
  flush,
  getRenderer,
  serializeChildren,
  setRenderer,
  state,
} from '@tessera/core'
import { createRouter, type PageModule, type RouteDefinition, type Router } from '../src'

// A page can declare the data it needs, so it is asked for when the person navigates and not when the page has loaded;
// and a page rendered ahead of time is hydrated (the elements that are there are kept) with its data already in it.

const html = (name: string, text = name) =>
  defineComponent(name, {}, () => {
    const r = getRenderer()
    return r.el('main', { attrs: { 'data-page': name } }, r.el('h1', {}, text))
  })

const page =
  (name: string): (() => Promise<PageModule>) =>
  async () => ({ default: html(name) })

let container: HTMLElement
let router: Router | undefined
const original = getRenderer()

beforeEach(() => {
  document.title = ''
  document.body.innerHTML = '<div id="app"></div>'
  container = document.getElementById('app')!
  window.scrollTo = vi.fn() as never
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  router?.unmount()
  router = undefined
  setRenderer(original.adapter)
  clearAllApis()
  vi.restoreAllMocks()
})

const create = (routes: RouteDefinition[], options: { hydrate?: boolean } = {}) => {
  router = createRouter({ routes, ...options })
  return router
}

describe('a page that declares its data', () => {
  it('starts it when the person navigates, before the page has loaded, so the two happen together', async () => {
    const order: string[] = []
    let finishLoad!: () => void
    const slowPage = () =>
      new Promise<PageModule>((resolve) => {
        order.push('load started')
        finishLoad = () => resolve({ default: html('post') })
      })
    create([
      { path: '/', load: page('home') },
      {
        path: '/posts/:id',
        load: slowPage,
        prefetch: (params) => {
          order.push(`prefetch ${params.id}`)
          return [Promise.resolve()]
        },
      },
    ])
    await router!.mount(container)
    const going = router!.navigate('/posts/3')
    expect(order).toEqual(['prefetch 3', 'load started'])
    finishLoad()
    await going
    expect(container.querySelector('[data-page="post"]')).not.toBeNull()
  })

  it('starts it for the first page too, and gives it the parameters and the query as text', async () => {
    window.history.replaceState(null, '', '/posts/9?sort=new&page=2')
    const seen: Array<[Record<string, string>, Record<string, string>]> = []
    create([
      {
        path: '/posts/:id',
        load: page('post'),
        prefetch: (params, query) => {
          seen.push([params, query])
          return []
        },
      },
    ])
    await router!.mount(container)
    expect(seen).toEqual([[{ id: '9' }, { sort: 'new', page: '2' }]])
  })

  it('shows the page at once by default, with the data still on its way', async () => {
    let finishData!: () => void
    create([
      { path: '/', load: page('home') },
      {
        path: '/slow',
        load: page('slow'),
        prefetch: () => [new Promise<void>((resolve) => (finishData = resolve))],
      },
    ])
    await router!.mount(container)
    await router!.navigate('/slow')
    expect(container.querySelector('[data-page="slow"]')).not.toBeNull()
    finishData()
  })

  it('waits for the data when the page says it must: the page before stays until it is in', async () => {
    let finishData!: () => void
    create([
      { path: '/', load: page('home') },
      {
        path: '/must',
        load: page('must'),
        wait: true,
        prefetch: () => [new Promise<void>((resolve) => (finishData = resolve))],
      },
    ])
    await router!.mount(container)
    const going = router!.navigate('/must')
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('[data-page="home"]')).not.toBeNull()
    expect(window.location.pathname).toBe('/')
    finishData()
    await going
    expect(container.querySelector('[data-page="must"]')).not.toBeNull()
    expect(window.location.pathname).toBe('/must')
  })

  it('waits for every page’s data when told to, which is what a prerender needs to write a page with its data', async () => {
    let finishData!: () => void
    router = createRouter({
      routes: [
        {
          path: '/',
          load: page('home'),
          prefetch: () => [new Promise<void>((resolve) => (finishData = resolve))],
        },
      ],
      waitForData: true,
    })
    let mounted = false
    const mounting = router.mount(container).then(() => (mounted = true))
    await new Promise((r) => setTimeout(r, 20))
    expect(mounted).toBe(false)
    finishData()
    await mounting
    expect(container.querySelector('[data-page="home"]')).not.toBeNull()
  })

  it('lets a newer navigation win over a page that was waiting for its data', async () => {
    let finishData!: () => void
    create([
      { path: '/', load: page('home') },
      {
        path: '/must',
        load: page('must'),
        wait: true,
        prefetch: () => [new Promise<void>((r) => (finishData = r))],
      },
      { path: '/other', load: page('other') },
    ])
    await router!.mount(container)
    const first = router!.navigate('/must')
    await router!.navigate('/other')
    finishData()
    await first
    expect(container.querySelector('[data-page="other"]')).not.toBeNull()
    expect(window.location.pathname).toBe('/other')
  })

  it('goes on when a prefetch throws: the page asks for its own data', async () => {
    create([
      { path: '/', load: page('home') },
      {
        path: '/x',
        load: page('x'),
        prefetch: () => {
          throw new Error('boom')
        },
      },
    ])
    await router!.mount(container)
    await router!.navigate('/x')
    expect(container.querySelector('[data-page="x"]')).not.toBeNull()
  })

  it('tells settled() the navigation is over only when a waiting page is shown', async () => {
    let finishData!: () => void
    create([
      { path: '/', load: page('home') },
      {
        path: '/must',
        load: page('must'),
        wait: true,
        prefetch: () => [new Promise<void>((r) => (finishData = r))],
      },
    ])
    await router!.mount(container)
    void router!.navigate('/must')
    let done = false
    void router!.settled().then(() => (done = true))
    await new Promise((r) => setTimeout(r, 20))
    expect(done).toBe(false)
    finishData()
    await router!.settled()
    expect(container.querySelector('[data-page="must"]')).not.toBeNull()
  })
})

// --- hydration ----------------------------------------------------------------------------------------------------

/** What `tessera build --prerender` does for one page: render it with the string adapter (marked) and write it. */
async function prerender(
  routes: RouteDefinition[],
  path: string,
  prepare?: () => Promise<void> | void,
): Promise<string> {
  const adapter = createStringAdapter({ marks: true })
  const before = getRenderer()
  setRenderer(adapter)
  try {
    await prepare?.()
    const url = new URL(path, 'http://prerender.invalid')
    const doc = {
      title: '',
      getElementById: () => null,
      body: { append() {} },
      createElement: () => ({ setAttribute() {}, style: {}, remove() {} }),
    }
    const win = {
      location: { href: url.href, origin: url.origin },
      history: { scrollRestoration: 'auto', replaceState() {}, pushState() {} },
      document: doc,
      scrollX: 0,
      scrollY: 0,
      scrollTo() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    }
    const server = createRouter({ routes, window: win as unknown as Window, announce: false })
    const node = createStringNode('div')
    const stop = await server.mount(node as never)
    const out = serializeChildren(node)
    stop()
    return out
  } finally {
    setRenderer(before.adapter)
  }
}

const counterPage =
  (count = state(0)): (() => Promise<PageModule>) =>
  async () => ({
    default: defineComponent('counter', {}, () => {
      const r = getRenderer()
      return r.el(
        'main',
        {},
        r.el('h1', {}, 'Counter'),
        r.el('p', {}, () => `Clicked ${count.value} times`),
        r.el(
          'button',
          { attrs: { type: 'button' }, on: { click: () => (count.value += 1) } },
          'Add',
        ),
      )
    }),
  })

describe('hydrating a prerendered page', () => {
  it('keeps the elements that are in the page, and the page works', async () => {
    const routes: RouteDefinition[] = [{ path: '/', load: counterPage() }]
    const written = await prerender(routes, '/')
    container.setAttribute('data-prerendered', '')
    container.innerHTML = written
    const main = container.querySelector('main')!
    const button = container.querySelector('button')!
    create([{ path: '/', load: counterPage() }])
    await router!.mount(container)
    expect(container.querySelector('main')).toBe(main)
    expect(container.querySelector('button')).toBe(button)
    expect(container.hasAttribute('data-prerendered')).toBe(false)
    expect(container.querySelector('[data-h]')).toBeNull()
    button.click()
    flush()
    expect(container.querySelector('p')!.textContent).toBe('Clicked 1 times')
  })

  it('keeps what the person typed before the script arrived', async () => {
    const field = (): (() => Promise<PageModule>) => async () => ({
      default: defineComponent('field', {}, () => {
        const r = getRenderer()
        return r.el('main', {}, r.el('input', { attrs: { 'aria-label': 'Name' } }))
      }),
    })
    const written = await prerender([{ path: '/', load: field() }], '/')
    container.setAttribute('data-prerendered', '')
    container.innerHTML = written
    const input = container.querySelector('input')!
    input.value = 'Ann'
    create([{ path: '/', load: field() }])
    await router!.mount(container)
    expect(container.querySelector('input')).toBe(input)
    expect(input.value).toBe('Ann')
  })

  it('hydrates a page inside its layout', async () => {
    const layout = async () => ({
      default: defineComponent('layout', {}, (ctx) => {
        const r = getRenderer()
        return r.el(
          'div',
          { attrs: { class: 'layout' } },
          r.el('nav', {}, 'Menu'),
          r.el('section', {}, ctx.slot('default')),
        )
      }),
    })
    const options = { layouts: { default: layout } }
    const routes: RouteDefinition[] = [{ path: '/', load: counterPage() }]
    // Rendered with the layout.
    const adapter = createStringAdapter({ marks: true })
    const before = getRenderer()
    setRenderer(adapter)
    const url = new URL('/', 'http://prerender.invalid')
    const win = {
      location: { href: url.href, origin: url.origin },
      history: { scrollRestoration: 'auto', replaceState() {}, pushState() {} },
      document: {
        title: '',
        getElementById: () => null,
        body: { append() {} },
        createElement: () => ({ setAttribute() {}, style: {}, remove() {} }),
      },
      scrollX: 0,
      scrollY: 0,
      scrollTo() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    }
    const server = createRouter({
      routes,
      ...options,
      window: win as unknown as Window,
      announce: false,
    })
    const node = createStringNode('div')
    const stop = await server.mount(node as never)
    const written = serializeChildren(node)
    stop()
    setRenderer(before.adapter)

    container.setAttribute('data-prerendered', '')
    container.innerHTML = written
    const nav = container.querySelector('nav')!
    router = createRouter({ routes: [{ path: '/', load: counterPage() }], ...options })
    await router.mount(container)
    expect(container.querySelector('nav')).toBe(nav)
    container.querySelector('button')!.click()
    flush()
    expect(container.querySelector('p')!.textContent).toBe('Clicked 1 times')
  })

  it('renders again from nothing, and says so, when the page is not what the app makes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const written = await prerender([{ path: '/', load: counterPage() }], '/')
    container.setAttribute('data-prerendered', '')
    container.innerHTML = written
    const old = container.querySelector('main')!
    // The app now makes something else: the HTML is from an earlier build.
    create([{ path: '/', load: page('home') }])
    await router!.mount(container)
    expect(container.querySelector('[data-page="home"]')).not.toBeNull()
    expect(container.querySelector('main')).not.toBe(old)
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelector('[data-h]')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/prerendered/)
  })

  it('replaces the page when it is told not to hydrate, as before', async () => {
    const written = await prerender([{ path: '/', load: counterPage() }], '/')
    container.setAttribute('data-prerendered', '')
    container.innerHTML = written
    const old = container.querySelector('main')!
    create([{ path: '/', load: counterPage() }], { hydrate: false })
    await router!.mount(container)
    expect(container.querySelector('main')).not.toBe(old)
    expect(container.querySelectorAll('main')).toHaveLength(1)
  })

  it('does nothing different for a page that was not prerendered', async () => {
    create([{ path: '/', load: counterPage() }])
    await router!.mount(container)
    expect(container.querySelectorAll('main')).toHaveLength(1)
  })
})

describe('hydrating with the data the page declared', () => {
  const fetchCalls: string[] = []
  const makeApi = () =>
    createApi({
      base: '/api',
      staleAfter: 60_000,
      fetch: (async (input: RequestInfo | URL) => {
        fetchCalls.push(String(input))
        return new Response(JSON.stringify([{ id: 1, title: 'Fresh' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as unknown as typeof globalThis.fetch,
    })

  const listPage =
    (api: ReturnType<typeof makeApi>): (() => Promise<PageModule>) =>
    async () => ({
      default: defineComponent('list', {}, () => {
        const r = getRenderer()
        const posts = api.get<Array<{ id: number; title: string }>>('/posts')
        return r.el(
          'main',
          {},
          r.el(
            'ul',
            {},
            r.each(
              () => posts.data.value ?? [],
              (p) => p.id,
              (p) => r.el('li', {}, () => p.value.title),
            ),
          ),
          r.el('p', {}, () => (posts.loading.value ? 'Loading' : 'Done')),
        )
      }),
    })

  it('shows the data at once, with no loading state and no request, and asks again once the page is up', async () => {
    fetchCalls.length = 0
    const serverApi = makeApi()
    const routes = (api: ReturnType<typeof makeApi>): RouteDefinition[] => [
      { path: '/', load: listPage(api), wait: true, prefetch: () => [api.prefetch('/posts')] },
    ]
    // The build: the declared data is fetched, the page rendered with it, and the answers written into the page.
    const written = await prerender(routes(serverApi), '/')
    expect(written).toContain('Fresh')
    const { exportPrefetched } = await import('@tessera/core')
    const baked = dataScript(exportPrefetched())
    expect(baked).toContain('"/api/posts"')
    clearAllApis()
    fetchCalls.length = 0

    // The browser: the page with its data in it, and the script that loads.
    container.setAttribute('data-prerendered', '')
    container.innerHTML = written
    document.body.insertAdjacentHTML('beforeend', baked)
    const li = container.querySelector('li')!
    const clientApi = makeApi()
    create(routes(clientApi))
    await router!.mount(container)
    // The first render had the data, so it matched the HTML and kept its elements.
    expect(container.querySelector('li')).toBe(li)
    expect(container.querySelector('p')!.textContent).toBe('Done')
    // Asked again in the background once the page was up (the baked answer is as old as the build).
    await vi.waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0))
    expect(fetchCalls.every((url) => url === '/api/posts')).toBe(true)
  })
})
