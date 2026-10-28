/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import 'virtual:tessera/tokens.css'
import {
  routes as generated,
  notFound as generatedNotFound,
  layouts as generatedLayouts,
} from 'virtual:tessera/routes'
import {
  createRouter,
  layoutsFromModules,
  routesFromModules,
  type Router,
} from '@pixelscriptio/tessera/router'

// The pages are the real `app/pages`, loaded the way the build loads them.
const fromGlob = routesFromModules(import.meta.glob('./pages/**/*.tess'), './pages')
const layouts = layoutsFromModules(import.meta.glob('./layouts/*.tess'), './layouts')

let container: HTMLElement
let router: Router | undefined
const startUrl = location.pathname + location.search

const start = async (url: string) => {
  history.replaceState(null, '', url)
  router = createRouter({ ...fromGlob, layouts })
  await router.mount(container)
}

const heading = () => container.querySelector('h1')?.textContent
const link = (text: string) =>
  [...container.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent === text)!
// Wait for the navigation a click started to finish, as the router says, not for a time that a slow machine can exceed.
const settle = () => router!.settled()
// The announcement is set a moment after the navigation, on purpose, so a screen reader notices it: wait for the text.
const announced = async (text: string) => {
  const end = Date.now() + 10_000
  while (
    document.querySelector('[data-tessera-announcer]')?.textContent !== text &&
    Date.now() < end
  )
    await new Promise((resolve) => setTimeout(resolve, 20))
}
// Back and forward arrive as a popstate event in a task of their own: wait for it, then for the navigation it starts.
const traverse = async (direction: 'back' | 'forward') => {
  const popped = new Promise<void>((resolve) =>
    addEventListener('popstate', () => resolve(), { once: true }),
  )
  if (direction === 'back') history.back()
  else history.forward()
  await popped
  await settle()
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  router?.unmount()
  router = undefined
  container.remove()
  history.replaceState(null, '', startUrl)
})

describe('the kitchen-sink routes', () => {
  it('map the pages folder as the spec says', () => {
    expect(fromGlob.routes.map((r) => r.path)).toEqual(['/', '/about', '/blog', '/blog/:slug'])
    expect(fromGlob.notFound).toBeTypeOf('function')
  })

  it('are what the generated virtual module exports, one lazy import per page', () => {
    expect(generated.map((r) => r.path)).toEqual(['/', '/about', '/blog', '/blog/:slug'])
    expect(generatedNotFound).toBeTypeOf('function')
    expect(Object.keys(generatedLayouts).sort()).toEqual(['default', 'focus'])
  })
})

describe('navigating by click, back and forward', () => {
  it('goes to a page when its link is clicked, without reloading', async () => {
    await start('/')
    expect(heading()).toBe('Tessera kitchen sink')
    expect(document.title).toBe('Home')

    link('Blog').click()
    await settle()
    expect(location.pathname).toBe('/blog')
    expect(heading()).toBe('Blog')
    expect(document.title).toBe('Blog')
    // The link of the page you are on is marked, for screen readers.
    expect(link('Blog').getAttribute('aria-current')).toBe('page')
    expect(link('About').hasAttribute('aria-current')).toBe(false)
  })

  it('moves focus to the page and announces it politely', async () => {
    await start('/')
    link('Blog').click()
    await settle()
    expect(document.activeElement).toBe(container.querySelector('main'))
    const live = document.querySelector('[data-tessera-announcer]')!
    expect(live.getAttribute('aria-live')).toBe('polite')
    await announced('Navigated to Blog')
    expect(live.textContent).toBe('Navigated to Blog')
  })

  it('opens a post from the list, with its parameter', async () => {
    await start('/blog')
    link('Why signals').click()
    await settle()
    expect(location.pathname).toBe('/blog/signals')
    expect(heading()).toBe('Why signals')
  })

  it('follows back and forward through history', async () => {
    await start('/')
    link('Blog').click()
    await settle()
    link('Why signals').click()
    await settle()
    expect(heading()).toBe('Why signals')

    await traverse('back')
    expect(heading()).toBe('Blog')
    expect(location.pathname).toBe('/blog')

    await traverse('back')
    expect(heading()).toBe('Tessera kitchen sink')

    await traverse('forward')
    expect(heading()).toBe('Blog')
  })

  it('leaves a modified click to the browser', async () => {
    await start('/')
    link('About').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    )
    await settle()
    expect(location.pathname).toBe('/')
  })
})

describe('loading a URL directly', () => {
  it('shows the page for each kind of route', async () => {
    await start('/about')
    expect(heading()).toBe('About')
    router!.unmount()

    await start('/blog')
    expect(heading()).toBe('Blog')
    router!.unmount()

    await start('/blog/contracts')
    expect(heading()).toBe('Contracts first')
    expect(document.title).toBe('Post')
  })

  it('does not move focus or announce for the first page', async () => {
    await start('/about')
    expect(document.activeElement).toBe(document.body)
    expect(document.querySelector('[data-tessera-announcer]')).toBeNull()
  })

  it('shows the 404 page for an unknown path, and the page handles an unknown post', async () => {
    await start('/nope/at/all')
    expect(heading()).toBe('Page not found')
    expect(document.title).toBe('Page not found')
    router!.unmount()

    await start('/blog/zzz')
    expect(heading()).toBe('No such post')
  })
})

describe('layouts', () => {
  const nav = () => container.querySelector('nav')
  const focusBack = () =>
    [...container.querySelectorAll('a')].some((a) => a.textContent === 'Back to the blog')

  it('wraps pages in the default layout, and 404 too', async () => {
    await start('/blog')
    expect(nav()).not.toBeNull()
    router!.unmount()
    await start('/nope')
    expect(nav()).not.toBeNull()
  })

  it('lets a page pick another layout, or none', async () => {
    await start('/blog/signals')
    expect(focusBack()).toBe(true)
    expect(nav()).toBeNull()
    router!.unmount()

    await start('/about')
    expect(nav()).toBeNull()
    expect(focusBack()).toBe(false)
  })

  it('does not re-create the layout when moving between pages that share it', async () => {
    await start('/')
    const before = nav()!
    before.setAttribute('data-marker', 'same-node')
    link('Blog').click()
    await settle()
    expect(heading()).toBe('Blog')
    expect(nav()).toBe(before)
    expect(nav()!.getAttribute('data-marker')).toBe('same-node')
  })

  it('swaps the layout when the next page uses a different one', async () => {
    await start('/blog')
    expect(nav()).not.toBeNull()
    link('Why signals').click()
    await settle()
    expect(nav()).toBeNull()
    expect(focusBack()).toBe(true)

    await traverse('back')
    expect(nav()).not.toBeNull()
    expect(heading()).toBe('Blog')
  })

  it('keeps focus, title and the announcement working across layouts', async () => {
    await start('/')
    link('Blog').click()
    await settle()
    link('Why signals').click()
    await settle()
    expect(document.activeElement).toBe(container.querySelector('main'))
    expect(document.title).toBe('Post')
    await announced('Navigated to Post')
    expect(document.querySelector('[data-tessera-announcer]')!.textContent).toBe(
      'Navigated to Post',
    )
  })
})
