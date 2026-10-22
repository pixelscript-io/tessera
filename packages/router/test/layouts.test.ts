// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, getRenderer, type Component } from '@tessera/core'
import { createRouter, navigate, type PageModule, type Router } from '../src'

const r = () => getRenderer()

const page =
  (name: string, layout?: string | false): (() => Promise<PageModule>) =>
  async () => ({
    page: layout === undefined ? undefined : { layout },
    default: defineComponent(name, {}, () =>
      r().el('main', { attrs: { 'data-page': name } }, name),
    ),
  })

const layout = (name: string): Component =>
  defineComponent(name, {}, ($ctx) =>
    $ctx.root(
      r().el(
        'div',
        { attrs: { 'data-layout': name } },
        r().el('nav', {}, name),
        $ctx.slot('default'),
      ),
    ),
  )

// A module is evaluated once, so a layout is the same component every time it is loaded.
const defaultLayout = layout('default')
const otherLayout = layout('other')
const layouts = {
  default: async () => ({ default: defaultLayout }),
  other: async () => ({ default: otherLayout }),
}

let container: HTMLElement
let router: Router

const start = async (url: string, options: Partial<Parameters<typeof createRouter>[0]> = {}) => {
  window.history.replaceState(null, '', url)
  router = createRouter({
    routes: [
      { path: '/', load: page('home') },
      { path: '/b', load: page('b') },
      { path: '/o', load: page('o', 'other') },
      { path: '/n', load: page('n', false) },
      { path: '/x', load: page('x', 'missing') },
    ],
    layouts,
    ...options,
  })
  await router.mount(container)
}

const layoutName = () => container.querySelector('[data-layout]')?.getAttribute('data-layout')
const pageName = () => container.querySelector('[data-page]')?.getAttribute('data-page')

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  container = document.getElementById('app')!
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  window.scrollTo = vi.fn() as never
})

afterEach(() => {
  router?.unmount()
  vi.useRealTimers()
})

describe('layouts', () => {
  it('wraps a page in the default layout', async () => {
    await start('/')
    expect(layoutName()).toBe('default')
    expect(container.querySelector('[data-layout] > [data-page]')?.textContent).toBe('home')
  })

  it('keeps the same layout nodes while pages that share it change', async () => {
    await start('/')
    const el = container.querySelector('[data-layout]')!
    await navigate('/b')
    expect(pageName()).toBe('b')
    expect(container.querySelector('[data-layout]')).toBe(el)
    expect(container.querySelectorAll('[data-page]').length).toBe(1)
  })

  it('switches layout when the page names another, and drops it for false', async () => {
    await start('/')
    await navigate('/o')
    expect(layoutName()).toBe('other')
    expect(pageName()).toBe('o')
    await navigate('/n')
    expect(layoutName()).toBeUndefined()
    expect(pageName()).toBe('n')
    await navigate('/b')
    expect(layoutName()).toBe('default')
  })

  it('focuses the page root in every case', async () => {
    await start('/')
    await navigate('/b')
    expect(document.activeElement).toBe(container.querySelector('[data-page]'))
    await navigate('/n')
    expect(document.activeElement).toBe(container.querySelector('[data-page]'))
  })

  it('renders pages bare when the app has no default layout', async () => {
    await start('/', { layouts: { other: layouts.other } })
    expect(layoutName()).toBeUndefined()
    expect(pageName()).toBe('home')
  })

  it('says which layouts exist when a page names one that is missing', async () => {
    await start('/')
    await expect(navigate('/x')).rejects.toThrow(
      'Unknown layout "missing". Layouts: default, other.',
    )
    expect(pageName()).toBe('home')
  })

  it('also wraps the not-found page', async () => {
    await start('/nope')
    expect(layoutName()).toBe('default')
    expect(container.textContent).toContain('Page not found')
  })
})
