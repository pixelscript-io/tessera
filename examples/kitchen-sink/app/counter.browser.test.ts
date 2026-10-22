import { afterEach, describe, expect, it, vi } from 'vitest'
import 'virtual:tessera/tokens.css'
import { flush, getRenderer } from '@tessera/core'
import { setDensity, setTheme } from '@tessera/tokens'
import Counter from './components/Counter.tess'

const r = getRenderer()
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

function mountCounter(input: Parameters<typeof Counter>[0] = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  dispose = r.mount(container, () => Counter(input))
  return container
}

describe('Counter.tess compiled by the Vite plugin and run in a browser', () => {
  it('renders state, derived values, conditionals, lists, slots and variant attributes', () => {
    const container = mountCounter({ slots: { default: () => [r.el('h1', {}, 'Heading')] } })
    const root = container.firstElementChild!
    expect(root.className).toBe('t-Counter__root')
    expect(root.getAttribute('data-tone')).toBe('neutral')
    expect(root.querySelector('h1')!.textContent).toBe('Heading')
    expect(root.querySelector('.t-Counter__button')!.textContent).toBe('Clicked 0 times')
    expect(root.querySelector('p')!.textContent).toBe('Click the button.')
    expect([...root.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Write signals',
      'Render them',
    ])
  })

  it('updates only what depends on the click', () => {
    const container = mountCounter()
    const button = container.querySelector<HTMLElement>('.t-Counter__button')!
    const textNode = button.firstChild
    const list = container.querySelector('ul')!
    const observer = new MutationObserver(() => {})
    observer.observe(list, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })

    button.click()
    flush()
    expect(button.textContent).toBe('Clicked 1 times')
    expect(button.firstChild).toBe(textNode)
    expect(container.querySelector('p')!.textContent).toBe('Keep going.')

    button.click()
    button.click()
    flush()
    expect(container.querySelector('p')!.textContent).toBe('That is a lot of clicks.')
    // The list never changed.
    expect(observer.takeRecords()).toEqual([])
    observer.disconnect()
  })

  it('adds list items in place, keeping existing nodes', () => {
    const container = mountCounter()
    const first = container.querySelector('li')!
    ;[...container.querySelectorAll('button')].find((b) => b.textContent === 'Add item')!.click()
    flush()
    const items = [...container.querySelectorAll('li')]
    expect(items.map((li) => li.textContent)).toEqual(['Write signals', 'Render them', 'Item 3'])
    expect(items[0]).toBe(first)
  })

  it('emits change events to the parent', () => {
    const change = vi.fn()
    const container = mountCounter({ events: { change } })
    container.querySelector<HTMLElement>('.t-Counter__button')!.click()
    container.querySelector<HTMLElement>('.t-Counter__button')!.click()
    expect(change.mock.calls).toEqual([[1], [2]])
  })
})

describe('the styles written in Counter.tess, compiled against the design tokens', () => {
  const style = (el: Element) => getComputedStyle(el)

  afterEach(() => {
    setTheme(null)
    setDensity(null)
  })

  it('apply the token values to the scoped classes', () => {
    const container = mountCounter()
    const root = container.querySelector('.t-Counter__root')!
    const button = container.querySelector('.t-Counter__button')!
    expect(style(root).padding).toBe('16px')
    expect(style(root).borderTopLeftRadius).toBe('8px')
    expect(style(root).backgroundColor).toBe('rgb(245, 246, 248)')
    expect(style(button).padding).toBe('8px 16px')
    expect(style(button).backgroundColor).toBe('rgb(37, 99, 235)')
    expect(style(button).color).toBe('rgb(255, 255, 255)')
  })

  it('follow the theme and density with no re-render', () => {
    const container = mountCounter()
    const root = container.querySelector('.t-Counter__root')!
    const button = container.querySelector('.t-Counter__button')!
    const before = [...container.querySelectorAll('*')]

    setTheme('dark')
    setDensity('compact')
    expect(style(root).backgroundColor).toBe('rgb(30, 41, 59)')
    expect(style(root).padding).toBe('12px')
    expect(style(button).backgroundColor).toBe('rgb(96, 165, 250)')
    expect(style(button).padding).toBe('6px 12px')
    expect([...container.querySelectorAll('*')]).toEqual(before)
  })

  it('use the components layer, which sits below consumer overrides', () => {
    mountCounter()
    const layers = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .filter((rule) => rule instanceof CSSLayerBlockRule)
    expect(layers.map((l) => (l as CSSLayerBlockRule).name)).toContain('tessera.components')
  })
})
