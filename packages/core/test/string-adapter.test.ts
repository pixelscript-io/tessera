import { describe, expect, it } from 'vitest'
import {
  createRenderer,
  createStringAdapter,
  createStringNode,
  flush,
  serializeChildren,
  serializeNode,
  state,
} from '../src'

/** Render with the string adapter and return the HTML inside the container. */
function render(build: (r: ReturnType<typeof createRenderer<any, any>>) => any) {
  const adapter = createStringAdapter()
  const r = createRenderer(adapter)
  const container = createStringNode('div')
  const dispose = r.mount(container, () => build(r))
  return { container, html: () => serializeChildren(container), dispose }
}

describe('rendering to a string', () => {
  it('renders elements, attributes and text', () => {
    const { html } = render((r) =>
      r.el('p', { attrs: { class: 'lead', 'data-x': '1' } }, 'Hello ', r.el('b', {}, 'world')),
    )
    expect(html()).toBe('<p class="lead" data-x="1">Hello <b>world</b></p>')
  })

  it('escapes text and attribute values, and leaves script and style alone', () => {
    const { html } = render((r) =>
      r.el(
        'div',
        { attrs: { title: 'a "quoted" & <b>' } },
        '1 < 2 & 3 > 2',
        r.el('style', {}, '.a > .b { color: red }'),
      ),
    )
    expect(html()).toBe(
      '<div title="a &quot;quoted&quot; &amp; &lt;b>">1 &lt; 2 &amp; 3 &gt; 2<style>.a > .b { color: red }</style></div>',
    )
  })

  it('writes a boolean attribute with an empty value, and void elements without a closing tag', () => {
    const { html } = render((r) =>
      r.el(
        'form',
        {},
        r.el('input', { attrs: { type: 'checkbox', disabled: true } }),
        r.el('br', {}),
        r.el('img', { attrs: { src: 'a.png', alt: '' } }),
      ),
    )
    expect(html()).toBe(
      '<form><input type="checkbox" disabled=""><br><img src="a.png" alt=""></form>',
    )
  })

  it('shows the value a signal has now, and follows it when it changes', () => {
    const count = state(1)
    const { html } = render((r) => r.el('p', {}, () => `Count ${count.value}`))
    expect(html()).toBe('<p>Count 1</p>')
    count.value = 2
    flush()
    expect(html()).toBe('<p>Count 2</p>')
  })

  it('turns a property a browser would show into an attribute', () => {
    const { html } = render((r) =>
      r.el('input', { props: { value: () => 'hi', checked: () => true } }),
    )
    expect(html()).toBe('<input value="hi" checked="">')
  })

  it('renders a list, keeps its order when it changes, and a conditional', () => {
    const items = state(['a', 'b'])
    const show = state(true)
    const { html } = render((r) =>
      r.el(
        'div',
        {},
        r.each(
          () => items.value,
          (item: string) => item,
          (item) => r.el('i', {}, () => item.value),
        ),
        r.cond(() => (show.value ? 0 : -1), [() => r.el('b', {}, 'yes')]),
      ),
    )
    expect(html()).toBe('<div><i>a</i><i>b</i><b>yes</b></div>')
    items.value = ['b', 'c', 'a']
    show.value = false
    flush()
    expect(html()).toBe('<div><i>b</i><i>c</i><i>a</i></div>')
  })

  it('ignores listeners, so a component that attaches one still renders', () => {
    const { html } = render((r) => r.el('button', { on: { click: () => {} } }, 'Go'))
    expect(html()).toBe('<button>Go</button>')
  })

  it('removes what is disposed', () => {
    const { html, dispose } = render((r) => r.el('p', {}, 'x'))
    expect(html()).toBe('<p>x</p>')
    dispose()
    expect(html()).toBe('')
  })
})

describe('the string adapter on its own', () => {
  it('keeps parents and siblings as a tree should', () => {
    const adapter = createStringAdapter()
    const parent = adapter.createElement('ul')
    const a = adapter.createElement('li')
    const b = adapter.createElement('li')
    const c = adapter.createElement('li')
    adapter.insert(parent, a, null)
    adapter.insert(parent, c, null)
    adapter.insert(parent, b, c)
    expect(serializeNode(parent)).toBe('<ul><li></li><li></li><li></li></ul>')
    expect(adapter.nextSibling(a)).toBe(b)
    expect(adapter.nextSibling(c)).toBeNull()
    expect(adapter.parentNode(b)).toBe(parent)
    adapter.move(parent, a, null)
    expect(adapter.nextSibling(c)).toBe(a)
    adapter.remove(b)
    expect(adapter.parentNode(b)).toBeNull()
    expect(parent.children).toEqual([c, a])
  })

  it('reads back what was set, and removes an attribute with null', () => {
    const adapter = createStringAdapter()
    const el = adapter.createElement('div')
    adapter.setAttribute(el, 'id', 'x')
    expect(adapter.getAttribute(el, 'id')).toBe('x')
    adapter.setAttribute(el, 'id', null)
    expect(adapter.getAttribute(el, 'id')).toBeNull()
  })
})
