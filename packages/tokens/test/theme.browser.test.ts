import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildTokens, getTheme, setDensity, setTheme } from '../src'
import base from '../../../system/tokens/base.tokens.json'
import dark from '../../../system/tokens/themes/dark.tokens.json'
import compact from '../../../system/tokens/themes/compact.tokens.json'

describe('theme switching in a real browser', () => {
  let host: HTMLElement

  beforeAll(() => {
    const result = buildTokens({
      base: [{ file: 'base.tokens.json', content: base }],
      themes: [
        { file: 'dark.tokens.json', content: dark },
        { file: 'compact.tokens.json', content: compact },
      ],
    })
    expect(result.diagnostics).toEqual([])
    const style = document.createElement('style')
    style.textContent = result.css
    document.head.append(style)

    host = document.createElement('div')
    host.innerHTML = '<p id="p">Hello</p>'
    host.style.cssText =
      'background: var(--t-color-surface-default); color: var(--t-color-text-default); padding: var(--t-space-4)'
    document.body.append(host)
  })

  afterEach(() => {
    setTheme(null)
    setDensity(null)
  })

  it('changes computed styles when data-theme changes, without touching the DOM tree', async () => {
    const p = host.querySelector('#p')!
    const textNode = p.firstChild
    const style = () => getComputedStyle(host)
    expect(style().backgroundColor).toBe('rgb(255, 255, 255)')
    expect(style().color).toBe('rgb(17, 24, 39)')

    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((r) => mutations.push(...r))
    observer.observe(host, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })

    setTheme('dark')
    expect(getTheme()).toBe('dark')
    expect(style().backgroundColor).toBe('rgb(17, 24, 39)')
    expect(style().color).toBe('rgb(255, 255, 255)')

    setTheme(null)
    expect(style().backgroundColor).toBe('rgb(255, 255, 255)')

    await Promise.resolve()
    observer.disconnect()
    expect(mutations).toEqual([])
    expect(host.querySelector('#p')).toBe(p)
    expect(p.firstChild).toBe(textNode)
  })

  it('changes spacing when data-density changes', () => {
    expect(getComputedStyle(host).paddingTop).toBe('16px')
    setDensity('compact')
    expect(getComputedStyle(host).paddingTop).toBe('12px')
  })

  it('follows prefers-color-scheme only in auto mode', () => {
    // The emulated scheme in headless Edge is light, so auto must match the base values.
    setTheme('auto')
    expect(getComputedStyle(host).backgroundColor).toBe('rgb(255, 255, 255)')
  })
})
