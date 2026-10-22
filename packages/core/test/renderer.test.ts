// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  createDomAdapter,
  createRenderer,
  flush,
  onCleanup,
  state,
  type RendererAdapter,
} from '../src'

/** Wraps the DOM adapter so tests can count exactly which nodes were touched. */
function spiedAdapter() {
  const base = createDomAdapter(document)
  const setText = vi.fn(base.setText)
  const move = vi.fn(base.move)
  const insert = vi.fn(base.insert)
  const setAttribute = vi.fn(base.setAttribute)
  const adapter: RendererAdapter<Node, Element> = { ...base, setText, move, insert, setAttribute }
  return { adapter, setText, move, insert, setAttribute }
}

describe('fine-grained text updates', () => {
  it('updates only the text node that depends on the changed signal', () => {
    const { adapter, setText } = spiedAdapter()
    const r = createRenderer(adapter)
    const first = state('Ada')
    const last = state('Lovelace')
    const container = document.createElement('div')

    let firstNode!: Node
    let lastNode!: Node
    r.mount(container, () => {
      const p = r.el(
        'p',
        {},
        () => first.value,
        ' ',
        () => last.value,
      )
      firstNode = p.childNodes[0]!
      lastNode = p.childNodes[2]!
      return p
    })
    expect(container.textContent).toBe('Ada Lovelace')

    setText.mockClear()
    first.value = 'Grace'
    flush()

    expect(container.textContent).toBe('Grace Lovelace')
    expect(setText).toHaveBeenCalledTimes(1)
    expect(setText.mock.calls[0]![0]).toBe(firstNode)
    expect(setText.mock.calls[0]![0]).not.toBe(lastNode)
    // Same node objects: nothing was re-created.
    expect(container.querySelector('p')!.childNodes[0]).toBe(firstNode)
  })

  it('binds attributes and properties reactively, and wires events', () => {
    const r = createRenderer(createDomAdapter(document))
    const count = state(0)
    const disabled = state(false)
    const container = document.createElement('div')
    const dispose = r.mount(container, () =>
      r.el(
        'button',
        {
          attrs: { 'data-count': () => String(count.value), disabled: () => disabled.value },
          on: { click: () => count.value++ },
        },
        () => `Clicked ${count.value}`,
      ),
    )
    const button = container.querySelector('button')!
    expect(button.textContent).toBe('Clicked 0')
    expect(button.hasAttribute('disabled')).toBe(false)

    button.click()
    flush()
    expect(button.textContent).toBe('Clicked 1')
    expect(button.getAttribute('data-count')).toBe('1')

    disabled.value = true
    flush()
    expect(button.getAttribute('disabled')).toBe('')

    dispose()
    expect(container.childNodes.length).toBe(0)
    button.click()
    flush()
    expect(count.value).toBe(1) // listener was removed on disposal
  })
})

describe('keyed lists', () => {
  interface Item {
    id: number
    label: string
  }
  const setup = (initial: Item[]) => {
    const spies = spiedAdapter()
    const r = createRenderer(spies.adapter)
    const items = state(initial)
    const cleanups: number[] = []
    const container = document.createElement('div')
    const dispose = r.mount(container, () =>
      r.el(
        'ul',
        {},
        r.each(
          () => items.value,
          (item) => item.id,
          (item) => {
            onCleanup(() => cleanups.push(item.peek().id))
            return r.el('li', {}, () => item.value.label)
          },
        ),
      ),
    )
    const lis = () => [...container.querySelectorAll('li')]
    return { ...spies, items, container, cleanups, lis, dispose }
  }

  it('renders items in order', () => {
    const { lis } = setup([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ])
    expect(lis().map((li) => li.textContent)).toEqual(['a', 'b'])
  })

  it('keeps node identity when reordering, and moves as few nodes as needed', () => {
    const { items, lis, move } = setup([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ])
    const [a, b, c] = lis()
    move.mockClear()
    items.value = [
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
      { id: 1, label: 'a' },
    ]
    flush()
    expect(lis()).toEqual([b, c, a])
    expect(move).toHaveBeenCalledTimes(1)
  })

  it('inserts new items without touching existing ones', () => {
    const { items, lis, insert, move } = setup([
      { id: 1, label: 'a' },
      { id: 3, label: 'c' },
    ])
    const [a, c] = lis()
    insert.mockClear()
    move.mockClear()
    items.value = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ]
    flush()
    const after = lis()
    expect(after[0]).toBe(a)
    expect(after[2]).toBe(c)
    expect(after.map((li) => li.textContent)).toEqual(['a', 'b', 'c'])
    const insertedItems = insert.mock.calls.filter(([, node]) => node.nodeName === 'LI')
    expect(insertedItems).toHaveLength(1)
    expect(move).not.toHaveBeenCalled()
  })

  it('removes items and disposes their scopes', () => {
    const { items, lis, cleanups } = setup([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ])
    items.value = [{ id: 2, label: 'b' }]
    flush()
    expect(lis().map((li) => li.textContent)).toEqual(['b'])
    expect(cleanups).toEqual([1])
  })

  it('updates an existing item in place when its data changes under the same key', () => {
    const { items, lis, setText } = setup([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ])
    const [first, second] = lis()
    setText.mockClear()
    items.value = [
      { id: 1, label: 'a' },
      { id: 2, label: 'B!' },
    ]
    flush()
    expect(lis()).toEqual([first, second])
    expect(second!.textContent).toBe('B!')
    expect(setText).toHaveBeenCalledTimes(1)
  })

  it('disposes all item scopes when the parent is disposed', () => {
    const { dispose, cleanups, container } = setup([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ])
    dispose()
    expect(cleanups.sort()).toEqual([1, 2])
    expect(container.childNodes.length).toBe(0)
  })

  it('throws a clear error on duplicate keys', () => {
    const r = createRenderer(createDomAdapter(document))
    const container = document.createElement('div')
    expect(() =>
      r.mount(container, () =>
        r.el(
          'ul',
          {},
          r.each(
            () => [{ id: 1 }, { id: 1 }],
            (i) => i.id,
            () => r.el('li'),
          ),
        ),
      ),
    ).toThrow('Duplicate key 1 in each. Keys must be unique within a list.')
  })
})

describe('view()', () => {
  it('keeps what it built while select keeps returning the same builder, and rebuilds for another', () => {
    const r = createRenderer(createDomAdapter(document))
    const which = state('a')
    const other = state(0)
    let built = 0
    const make = () => {
      built++
      return r.el('p', {}, 'x')
    }
    const alt = () => r.el('span', {}, 'y')
    const seen: Node[] = []
    const container = document.createElement('div')
    r.mount(container, () => {
      const root = r.el('div', {})
      r.view(
        () => {
          other.value // a dependency that changes without changing the result
          return which.value === 'a' ? make : alt
        },
        (node) => {
          // Reading a signal here must not make the view depend on it.
          which.value
          seen.push(node)
        },
      ).mount(root, null)
      return root
    })
    flush()
    expect(built).toBe(1)
    other.value = 1
    flush()
    expect(built).toBe(1)
    expect(seen.length).toBe(1)
    which.value = 'b'
    flush()
    expect(container.querySelector('span')).not.toBeNull()
    expect(container.querySelector('p')).toBeNull()
    expect(seen.length).toBe(2)
  })
})
