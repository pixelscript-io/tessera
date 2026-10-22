// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { getDensity, getTheme, setDensity, setTheme } from '../src'

describe('theme runtime', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-density')
  })

  it('sets data attributes on the document element by default', () => {
    setTheme('dark')
    setDensity('compact')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
    expect(getTheme()).toBe('dark')
    expect(getDensity()).toBe('compact')
  })

  it('works on any element, and null returns to the base', () => {
    const el = document.createElement('section')
    setTheme('dark', el)
    expect(getTheme(el)).toBe('dark')
    setTheme(null, el)
    expect(getTheme(el)).toBeNull()
    expect(el.hasAttribute('data-theme')).toBe(false)
  })

  it('does not touch the DOM tree: only an attribute changes', () => {
    document.body.innerHTML = '<p id="p">hi</p>'
    const p = document.getElementById('p')!
    const seen: MutationRecord[] = []
    const observer = new MutationObserver((records) => seen.push(...records))
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
    setTheme('dark')
    return Promise.resolve().then(() => {
      observer.disconnect()
      expect(seen).toEqual([])
      expect(document.getElementById('p')).toBe(p)
    })
  })
})
