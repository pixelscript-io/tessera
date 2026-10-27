import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRenderer,
  createStringAdapter,
  createStringNode,
  flush,
  serializeChildren,
  state,
} from '../src'

function render(build: (r: ReturnType<typeof createRenderer<any, any>>) => any) {
  const r = createRenderer(createStringAdapter())
  const container = createStringNode('div')
  const dispose = r.mount(container, () => build(r))
  return { html: () => serializeChildren(container), dispose }
}

afterEach(() => vi.restoreAllMocks())

const DANGEROUS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '  javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  '\u0001javascript:alert(1)',
  'vbscript:msgbox(1)',
]

describe('a link or source that would run script is not set', () => {
  for (const attr of ['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']) {
    it(`on ${attr}`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      for (const bad of DANGEROUS) {
        const { html } = render((r) => r.el('a', { attrs: { [attr]: bad } }, 'x'))
        expect(html(), bad).toBe(`<a ${attr}="about:blank">x</a>`)
      }
      expect(warn).toHaveBeenCalled()
    })
  }

  it('when the value changes to a dangerous one later', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const url = state('/safe')
    const { html } = render((r) => r.el('a', { attrs: { href: () => url.value } }, 'x'))
    expect(html()).toBe('<a href="/safe">x</a>')
    url.value = 'javascript:steal()'
    flush()
    expect(html()).toBe('<a href="about:blank">x</a>')
    url.value = 'https://example.com/'
    flush()
    expect(html()).toBe('<a href="https://example.com/">x</a>')
  })

  it('also as a property', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { html } = render((r) => r.el('a', { props: { href: 'javascript:alert(1)' } }, 'x'))
    expect(html()).toBe('<a href="about:blank">x</a>')
  })

  it('says so once, with the attribute, and does not print the value', async () => {
    // A fresh copy of the renderer: it warns once per message for the life of the module.
    vi.resetModules()
    const fresh = await import('../src')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = fresh.createRenderer(fresh.createStringAdapter())
    const container = fresh.createStringNode('div')
    for (let i = 0; i < 3; i++)
      r.mount(container, () =>
        r.el('a', { attrs: { href: 'javascript:alert(document.cookie)' } }, 'x'),
      )
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]![0])
    expect(message).toContain('href')
    expect(message).toContain('script address')
    expect(message).not.toContain('document.cookie')
  })

  it('leaves ordinary addresses alone', () => {
    const ok = [
      '/about',
      '#top',
      'https://example.com/a?b=c',
      'mailto:a@example.com',
      'tel:+123',
      'data:image/png;base64,AAAA',
      'javascript-tutorial.html',
      'my-javascript:page',
    ]
    for (const value of ok) {
      const { html } = render((r) => r.el('a', { attrs: { href: value } }, 'x'))
      expect(html(), value).toContain(`href="${value}"`)
    }
  })

  it('does not touch an attribute that is not an address', () => {
    const { html } = render((r) => r.el('p', { attrs: { title: 'javascript:alert(1)' } }, 'x'))
    expect(html()).toBe('<p title="javascript:alert(1)">x</p>')
  })
})

describe('an attribute that is a script is not set', () => {
  it('for onclick and any on* name, set from data', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { html } = render((r) =>
      r.el('button', { attrs: { onclick: 'alert(1)', onMouseOver: 'x()', class: 'ok' } }, 'x'),
    )
    expect(html()).toBe('<button class="ok">x</button>')
    expect(warn).toHaveBeenCalled()
  })

  it('but a name that only starts with "on" letters is fine', () => {
    const { html } = render((r) => r.el('p', { attrs: { 'data-online': '1', one: '2' } }, 'x'))
    expect(html()).toBe('<p data-online="1" one="2">x</p>')
  })
})
