// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  HydrationMismatch,
  createDomAdapter,
  createHydrationAdapter,
  createRenderer,
  createStringAdapter,
  createStringNode,
  flush,
  serializeChildren,
  state,
  type Renderer,
} from '../src'

// A page rendered to HTML on the server (the string adapter, with marks), put in a document, and hydrated: the first
// render in the browser takes the elements that are there instead of making new ones.

type Build = (r: Renderer<any, any>) => any

/** What a server writes for a page: the HTML, numbered as the render created each element. */
function serve(build: Build): string {
  const adapter = createStringAdapter({ marks: true })
  const r = createRenderer(adapter)
  const container = createStringNode('div')
  r.mount(container, () => build(r))
  return serializeChildren(container)
}

/** The page in a browser, hydrated. Returns the container, what hydration said, and the renderer for later changes. */
function hydrate(html: string, build: Build) {
  const container = document.createElement('div')
  container.setAttribute('data-prerendered', '')
  container.innerHTML = html
  document.body.append(container)
  const before = new Map(
    [...container.querySelectorAll('*')].map((el) => [el.localName + el.textContent, el]),
  )
  const hydration = createHydrationAdapter(createDomAdapter(), container)
  const r = createRenderer(hydration)
  const dispose = r.mount(container, () => build(r))
  let mismatch: Error | undefined
  try {
    hydration.finish()
  } catch (error) {
    mismatch = error as Error
  }
  return { container, mismatch, r, before, dispose }
}

const counter = (r: Renderer<any, any>, start = state(0)) =>
  r.el(
    'main',
    { attrs: { class: 'root' } },
    r.el('h1', {}, 'Counter'),
    r.el('p', {}, () => `Clicked ${start.value} times`),
    r.el('button', { attrs: { type: 'button' }, on: { click: () => (start.value += 1) } }, 'Add'),
  )

describe('the page the server writes', () => {
  it('numbers each element in the order the render made it, and puts the number on the element', () => {
    const html = serve((r) => counter(r))
    // The children are made before the element that holds them.
    expect(html).toBe(
      '<main data-h="4" class="root"><h1 data-h="1">Counter</h1><p data-h="2">Clicked 0 times</p><button data-h="3" type="button">Add</button></main>',
    )
  })

  it('starts the numbering again when the adapter is reset, for the next page', () => {
    const adapter = createStringAdapter({ marks: true })
    const r = createRenderer(adapter)
    const a = createStringNode('div')
    r.mount(a, () => r.el('p', {}, 'one'))
    adapter.reset()
    const b = createStringNode('div')
    r.mount(b, () => r.el('p', {}, 'two'))
    expect(serializeChildren(b)).toBe('<p data-h="1">two</p>')
  })

  it('writes no numbers unless asked, as before', () => {
    const adapter = createStringAdapter()
    const r = createRenderer(adapter)
    const c = createStringNode('div')
    r.mount(c, () => r.el('p', {}, 'x'))
    expect(serializeChildren(c)).toBe('<p>x</p>')
  })
})

describe('hydrating', () => {
  it('keeps the elements that are there, and the page works: a click changes the text', () => {
    const count = state(0)
    const html = serve((r) => counter(r))
    const { container, mismatch, r } = hydrate(html, (r2) => counter(r2, count))
    expect(mismatch).toBeUndefined()
    void r
    const main = container.querySelector('main')!
    const button = container.querySelector('button')!
    expect(container.querySelectorAll('main')).toHaveLength(1)
    button.click()
    flush()
    expect(container.querySelector('p')!.textContent).toBe('Clicked 1 times')
    // Still the elements of the HTML: nothing was replaced.
    expect(container.querySelector('main')).toBe(main)
    expect(container.querySelector('button')).toBe(button)
  })

  it('does not replace an element: one the person has already used keeps its state', () => {
    const html = serve((r) => r.el('div', {}, r.el('input', { attrs: { 'aria-label': 'Name' } })))
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.append(container)
    const input = container.querySelector('input')!
    // Typed before the script arrived.
    input.value = 'Ann'
    const hydration = createHydrationAdapter(createDomAdapter(), container)
    const r = createRenderer(hydration)
    r.mount(container, () => r.el('div', {}, r.el('input', { attrs: { 'aria-label': 'Name' } })))
    hydration.finish()
    expect(container.querySelector('input')).toBe(input)
    expect(input.value).toBe('Ann')
  })

  it('removes the numbers when it is done, so the page is as a browser would have made it', () => {
    const html = serve((r) => counter(r))
    const { container } = hydrate(html, (r) => counter(r))
    expect(container.querySelector('[data-h]')).toBeNull()
  })

  it('takes text that the browser has joined into one piece, and text that is changed afterwards', () => {
    const name = state('Ann')
    const view = (r: Renderer<any, any>, n = name) => r.el('p', {}, 'Hello, ', () => n.value, '!')
    const html = serve((r) => view(r))
    expect(html).toContain('Hello, Ann!')
    const { container, mismatch } = hydrate(html, (r) => view(r))
    expect(mismatch).toBeUndefined()
    name.value = 'Bo'
    flush()
    expect(container.querySelector('p')!.textContent).toBe('Hello, Bo!')
  })

  it('takes a page with a condition and a list, whose markers are empty text the HTML cannot hold', () => {
    const show = state(true)
    const items = state(['a', 'b'])
    const view = (r: Renderer<any, any>) =>
      r.el(
        'div',
        {},
        r.cond(
          () => (show.value ? 0 : 1),
          [() => r.el('p', {}, 'shown'), () => r.el('p', {}, 'hidden')],
        ),
        r.el(
          'ul',
          {},
          r.each(
            () => items.value,
            (x) => x,
            (item) => r.el('li', {}, () => item.value),
          ),
        ),
      )
    const html = serve(view)
    const { container, mismatch } = hydrate(html, view)
    expect(mismatch).toBeUndefined()
    const first = container.querySelector('li')!
    items.value = ['a', 'b', 'c']
    show.value = false
    flush()
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(container.querySelector('li')).toBe(first)
    expect(container.querySelector('p')!.textContent).toBe('hidden')
  })

  it('goes on working after it is done: new elements are made as usual', () => {
    const items = state(['a'])
    const view = (r: Renderer<any, any>) =>
      r.el(
        'ul',
        {},
        r.each(
          () => items.value,
          (x) => x,
          (item) => r.el('li', {}, () => item.value),
        ),
      )
    const { container } = hydrate(serve(view), view)
    items.value = ['a', 'z']
    flush()
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('[data-h]')).toBeNull()
  })

  it('does not mind an element the server made and then threw away', () => {
    const view = (r: Renderer<any, any>) => {
      // Made, never put in the page: the numbering has a gap, and the client makes (and drops) it too.
      r.el('span', {}, 'dropped')
      return r.el('p', {}, 'kept')
    }
    const { container, mismatch } = hydrate(serve(view), view)
    expect(mismatch).toBeUndefined()
    expect(container.querySelector('p')!.textContent).toBe('kept')
  })
})

describe('when the page is not what the server wrote', () => {
  it('says so when an element is a different tag', () => {
    const html = serve((r) => r.el('div', {}, r.el('p', {}, 'x')))
    const { mismatch } = hydrate(html, (r) => r.el('div', {}, r.el('section', {}, 'x')))
    expect(mismatch).toBeInstanceOf(HydrationMismatch)
    expect(String(mismatch)).toMatch(/section/)
  })

  it('says so when the HTML has something the app does not make', () => {
    const html = serve((r) => r.el('div', {}, r.el('p', {}, 'one'), r.el('p', {}, 'two')))
    const { mismatch } = hydrate(html, (r) => r.el('div', {}, r.el('p', {}, 'one')))
    expect(mismatch).toBeInstanceOf(HydrationMismatch)
  })

  it('says so when the app makes something the HTML does not have', () => {
    const html = serve((r) => r.el('div', {}, r.el('p', {}, 'one')))
    const { mismatch } = hydrate(html, (r) =>
      r.el('div', {}, r.el('p', {}, 'one'), r.el('p', {}, 'two')),
    )
    expect(mismatch).toBeInstanceOf(HydrationMismatch)
  })

  it('says so when the text is not the text', () => {
    const html = serve((r) => r.el('p', {}, 'server'))
    const { mismatch } = hydrate(html, (r) => r.el('p', {}, 'client'))
    expect(mismatch).toBeInstanceOf(HydrationMismatch)
  })

  it('does not throw while the page renders, so a render that is in the middle of something is not broken', () => {
    const html = serve((r) => r.el('p', {}, 'x'))
    const container = document.createElement('div')
    container.innerHTML = html
    const hydration = createHydrationAdapter(createDomAdapter(), container)
    const r = createRenderer(hydration)
    expect(() => r.mount(container, () => r.el('section', {}, 'x'))).not.toThrow()
    expect(() => hydration.finish()).toThrow(HydrationMismatch)
  })

  it('can be told to stop, and then makes everything fresh', () => {
    const container = document.createElement('div')
    container.innerHTML = serve((r) => r.el('p', {}, 'x'))
    const hydration = createHydrationAdapter(createDomAdapter(), container)
    hydration.abort()
    const r = createRenderer(hydration)
    container.replaceChildren()
    r.mount(container, () => r.el('p', {}, 'y'))
    expect(container.textContent).toBe('y')
  })
})
