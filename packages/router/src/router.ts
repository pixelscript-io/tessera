import {
  createRoot,
  defineComponent,
  flush,
  getRenderer,
  state,
  type Component,
} from '@tessera/core'
import { matchRoute, parsePattern, splitTarget, type Segment } from './manifest'

/** What a page module exports: the component, and the `<page>` block's metadata. */
export interface PageModule {
  default: Component
  page?: { title?: string; layout?: string | false }
}

/** What a layout module exports: the component, with a default slot where the page goes. */
export interface LayoutModule {
  default: Component
}

export interface RouteDefinition {
  /** Pattern such as `/blog/:slug`. */
  path: string
  /** Loads the page. A bundler turns each one into its own chunk. */
  load: () => Promise<PageModule>
}

export interface RouterOptions {
  routes: RouteDefinition[]
  /** Loads the page shown when nothing matches. A small built-in page is used if omitted. */
  notFound?: () => Promise<PageModule>
  /**
   * Layouts by name. A page uses `default` unless its `<page>` block says `"layout": "name"` or
   * `"layout": false`. Without a `default` layout, pages render on their own.
   */
  layouts?: Record<string, () => Promise<LayoutModule>>
  /** The window to run in. Defaults to the global `window`. */
  window?: Window
  /** Announce each new page to screen readers. Default true. */
  announce?: boolean
}

/**
 * The app's routes by pattern, with their parameters. Empty here; the build fills it in
 * (`.tessera/routes.d.ts`) so `RoutePattern` lists the real routes.
 */
// An empty interface on purpose: the generated .tessera/routes.d.ts adds the routes by declaration merging.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RouteTypes {}

/** One of the app's route patterns, such as `/blog/:slug`; any string until the build has generated them. */
export type RoutePattern = keyof RouteTypes extends never
  ? string
  : Extract<keyof RouteTypes, string>

export interface NavigateOptions {
  /** Replace the current history entry instead of adding one. */
  replace?: boolean
}

/** The current location, read reactively: reading a property inside an effect or `derived()` subscribes to it. */
export interface RouteState {
  readonly path: string
  readonly params: Record<string, string>
  readonly query: Record<string, string>
  readonly hash: string
}

interface Location {
  path: string
  params: Record<string, string>
  query: Record<string, string>
  hash: string
}

const initial: Location = { path: '/', params: {}, query: {}, hash: '' }
const location = state<Location>(initial)

const route: RouteState = {
  get path() {
    return location.value.path
  },
  get params() {
    return location.value.params
  },
  get query() {
    return location.value.query
  },
  get hash() {
    return location.value.hash
  },
}

/** The current route, for pages and components: `route.path`, `route.params.slug`, `route.query`. */
export function useRoute(): RouteState {
  return route
}

let active: Router | undefined
const activate = (router: Router | undefined) => {
  active = router
}

/** Go to another page of the app. Use a normal `<a href>` for other sites. */
export function navigate(to: string, options: NavigateOptions = {}): Promise<void> {
  if (!active) {
    return Promise.reject(
      new Error(
        'navigate() was called before the app was created. Call createApp().mount() first.',
      ),
    )
  }
  return active.navigate(to, options)
}

/**
 * Should a click on a link be handled by the router? Not when the user meant something else: another
 * mouse button, a modifier key (new tab or window), a download, or a target other than this window.
 */
export function shouldHandleClick(event: {
  defaultPrevented?: boolean
  button?: number
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  currentTarget?: unknown
}): boolean {
  if (event.defaultPrevented) return false
  if (event.button !== undefined && event.button !== 0) return false
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  const target = event.currentTarget as { getAttribute?(name: string): string | null } | undefined
  const targetAttr = target?.getAttribute?.('target')
  if (targetAttr && targetAttr !== '_self') return false
  if (
    target?.getAttribute?.('download') !== null &&
    target?.getAttribute?.('download') !== undefined
  )
    return false
  return true
}

interface CompiledRoute {
  segments: Segment[]
  load: () => Promise<PageModule>
}

const parseQuery = (search: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(search)) if (!(key in out)) out[key] = value
  return out
}

const BUILT_IN_NOT_FOUND: PageModule = {
  page: { title: 'Page not found' },
  default: defineComponent('NotFound', {}, () => {
    const r = getRenderer()
    return r.el(
      'main',
      {},
      r.el('h1', {}, 'Page not found'),
      r.el('p', {}, () => `Nothing is at ${location.value.path}.`),
    )
  }),
}

const VISUALLY_HIDDEN =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0'

/**
 * The router: matches the address to a page, loads it, shows it, keeps the address bar and history in sync,
 * and looks after what a screen reader and keyboard user need on each navigation (a new title, an
 * announcement, focus on the new page, scroll position). History API only: no hash mode.
 */
export class Router {
  private readonly routes: CompiledRoute[]
  private readonly win: Window
  private readonly shown = state<{ layout?: Component; page: Component } | undefined>(undefined)
  private pageNode: Element | undefined
  /** One stable builder per layout, so a layout is kept (not rebuilt) while pages change inside it. */
  private readonly layoutBuilders = new Map<Component, () => Node>()
  /** The same, per page, for pages that have no layout. */
  private readonly pageBuilders = new Map<Component, () => Node>()
  private title = ''
  private token = 0
  private historyKey = 0
  private firstRender = true
  private readonly scroll = new Map<number, { x: number; y: number }>()
  private announcer: HTMLElement | undefined
  private cleanup: (() => void)[] = []

  constructor(private readonly options: RouterOptions) {
    this.routes = options.routes.map((r) => ({ segments: parsePattern(r.path), load: r.load }))
    this.win = options.window ?? window
  }

  /** Show the page for the current address and start handling navigation. Resolves once the first page is up. */
  async mount(container: Element): Promise<() => void> {
    activate(this)
    // A page prerendered at build time is already in the container. The live page replaces it: it is the same page.
    if (
      typeof container.hasAttribute === 'function' &&
      container.hasAttribute('data-prerendered')
    ) {
      container.replaceChildren()
      container.removeAttribute('data-prerendered')
    }
    const history = this.win.history
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    history.replaceState({ key: this.historyKey }, '')

    const onPop = (event: PopStateEvent) => {
      const key = (event.state as { key?: number } | null)?.key
      void this.go(this.win.location.href, { popstate: true, key })
    }
    this.win.addEventListener('popstate', onPop)
    this.cleanup.push(() => this.win.removeEventListener('popstate', onPop))

    const r = getRenderer()
    const dispose = createRoot((dispose) => {
      // The page is shown in the layout's default slot. The layout's builder is stable, so moving between
      // pages that share a layout only swaps the page: the layout and its state stay.
      const pageView = r.view(
        () => {
          const component = this.shown.value?.page
          return component
            ? this.builder(this.pageBuilders, component, () => component())
            : undefined
        },
        (node) => {
          this.pageNode = node as Element
        },
      )
      r.view(
        () => {
          const current = this.shown.value
          if (!current) return undefined
          const { layout, page } = current
          if (layout) {
            return this.builder(this.layoutBuilders, layout, () =>
              layout({ slots: { default: () => [pageView] } }),
            )
          }
          return this.builder(this.pageBuilders, page, () => page())
        },
        (node) => {
          if (!this.shown.value?.layout) this.pageNode = node as Element
        },
      ).mount(container as never, null as never)
      return dispose
    })
    this.cleanup.push(dispose)

    await this.go(this.win.location.href, { initial: true })
    return () => this.unmount()
  }

  unmount(): void {
    for (const fn of this.cleanup.splice(0)) fn()
    this.announcer?.remove()
    if (active === this) activate(undefined)
  }

  navigate(to: string, options: NavigateOptions = {}): Promise<void> {
    return this.go(to, { replace: options.replace })
  }

  private async go(
    to: string,
    flags: { replace?: boolean; popstate?: boolean; key?: number; initial?: boolean },
  ): Promise<void> {
    const url = new URL(to, this.win.location.href)
    if (url.origin !== this.win.location.origin) {
      this.win.location.assign(url.href)
      return
    }

    const matched = matchRoute(this.routes, url.pathname)
    const load = matched?.route.load ?? this.options.notFound ?? (async () => BUILT_IN_NOT_FOUND)
    const ticket = ++this.token
    let module: PageModule
    try {
      module = await load()
    } catch (error) {
      // A page that fails to load (a network error) leaves the current page and address as they were.
      if (ticket === this.token) throw error
      return
    }
    // A newer navigation started while this page was loading; it wins.
    if (ticket !== this.token) return

    const layout = await this.loadLayout(module.page?.layout)
    if (ticket !== this.token) return

    const history = this.win.history
    if (!flags.popstate && !flags.initial) {
      this.scroll.set(this.historyKey, { x: this.win.scrollX, y: this.win.scrollY })
      if (flags.replace)
        history.replaceState({ key: this.historyKey }, '', url.pathname + url.search + url.hash)
      else {
        this.historyKey += 1
        history.pushState({ key: this.historyKey }, '', url.pathname + url.search + url.hash)
      }
    } else if (flags.popstate) {
      this.scroll.set(this.historyKey, { x: this.win.scrollX, y: this.win.scrollY })
      this.historyKey = flags.key ?? this.historyKey
    }

    location.value = {
      path: url.pathname,
      params: matched?.params ?? {},
      query: parseQuery(url.search),
      hash: url.hash,
    }
    this.title = module.page?.title ?? ''
    this.shown.value = { layout, page: module.default }
    flush()
    this.afterNavigation(url, flags)
  }

  /** The layout a page asked for: its named one, none for `false`, else `default` if the app has one. */
  private async loadLayout(name: string | false | undefined): Promise<Component | undefined> {
    if (name === false) return undefined
    const layouts = this.options.layouts ?? {}
    const wanted = name ?? 'default'
    const load = layouts[wanted]
    if (!load) {
      if (name === undefined) return undefined
      throw new Error(
        `Unknown layout "${name}". Layouts: ${Object.keys(layouts).join(', ') || 'none'}.`,
      )
    }
    return (await load()).default
  }

  private builder(cache: Map<Component, () => Node>, key: Component, make: () => Node): () => Node {
    let builder = cache.get(key)
    if (!builder) cache.set(key, (builder = make))
    return builder
  }

  /** Everything that happens once the new page is on screen. */
  private afterNavigation(
    url: URL,
    flags: { popstate?: boolean; key?: number; initial?: boolean },
  ): void {
    const doc = this.win.document
    if (this.title) doc.title = this.title

    if (flags.initial) {
      this.firstRender = false
      // The address may name a place on the page (`/#data`). The browser looked for it before the page was here.
      if (url.hash) doc.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView()
      return
    }

    // Scroll: back to where it was on back and forward, to an anchor for a hash, else to the top.
    const saved = flags.popstate ? this.scroll.get(this.historyKey) : undefined
    const anchor = url.hash ? doc.getElementById(decodeURIComponent(url.hash.slice(1))) : null
    if (saved) this.win.scrollTo(saved.x, saved.y)
    else if (anchor) anchor.scrollIntoView()
    else this.win.scrollTo(0, 0)

    // Focus: the new page, so keyboard and screen reader users start at its top and not at the old link.
    const node = this.pageNode
    if (node && !anchor) {
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
      ;(node as HTMLElement).focus({ preventScroll: true })
    }

    if (this.options.announce !== false) this.announce(this.title || url.pathname)
    this.firstRender = false
  }

  private announce(message: string): void {
    const doc = this.win.document
    if (!this.announcer) {
      const el = doc.createElement('div')
      el.setAttribute('role', 'status')
      el.setAttribute('aria-live', 'polite')
      el.setAttribute('data-tessera-announcer', '')
      el.style.cssText = VISUALLY_HIDDEN
      doc.body.append(el)
      this.announcer = el
    }
    // Clearing first makes the same text announce again.
    this.announcer.textContent = ''
    const announcer = this.announcer
    this.win.setTimeout(() => {
      announcer.textContent = `Navigated to ${message}`
    }, 50)
  }

  /** True until the first page has rendered; the first page does not take focus or scroll. */
  get starting(): boolean {
    return this.firstRender
  }
}

export function createRouter(options: RouterOptions): Router {
  return new Router(options)
}

export { splitTarget }
