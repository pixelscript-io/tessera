// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  constant,
  createRoot,
  defineComponent,
  derived,
  flush,
  getRenderer,
  isSignal,
  onCleanup,
  onMount,
  state,
  unwrap,
} from '../src'

const r = getRenderer()
const host = () => {
  const el = document.createElement('div')
  document.body.append(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('signal helpers', () => {
  it('isSignal and unwrap recognise state, derived and constant', () => {
    const s = state(1)
    expect(isSignal(s)).toBe(true)
    expect(isSignal(derived(() => s.value))).toBe(true)
    expect(isSignal(constant(1))).toBe(true)
    expect(isSignal({ value: 1 })).toBe(false)
    expect(unwrap(s)).toBe(1)
    expect(unwrap(2)).toBe(2)
    expect(unwrap(constant('x'))).toBe('x')
  })

  it('onMount runs once after creation, and not after disposal', async () => {
    const ran = vi.fn()
    createRoot(() => onMount(ran))
    expect(ran).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(ran).toHaveBeenCalledTimes(1)

    const skipped = vi.fn()
    createRoot((dispose) => {
      onMount(skipped)
      dispose()
    })
    await Promise.resolve()
    expect(skipped).not.toHaveBeenCalled()
    expect(() => onMount(() => {})).toThrow(/outside of a component or root scope/)
  })

  it('warns once when a signal is rendered as text', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const holder = { name: state('x') }
    const container = host()
    r.mount(container, () => r.el('p', {}, () => holder.name as unknown as string))
    r.mount(container, () => r.el('p', {}, () => holder.name as unknown as string))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(
      'A signal was rendered as text without being unwrapped',
    )
    warn.mockRestore()
  })
})

describe('cond', () => {
  it('shows the selected branch and rebuilds only when the index changes', () => {
    const n = state(1)
    const built = vi.fn()
    const container = host()
    r.mount(container, () =>
      r.el(
        'div',
        {},
        'a',
        r.cond(
          () => (n.value > 2 ? 1 : n.value > 0 ? 0 : -1),
          [
            () => {
              built('low')
              return r.el('b', {}, () => `n=${n.value}`)
            },
            () => {
              built('high')
              return r.el('i', {}, 'high')
            },
          ],
        ),
        'z',
      ),
    )
    expect(container.textContent).toBe('an=1z')
    const first = container.querySelector('b')!

    n.value = 2
    flush()
    expect(container.textContent).toBe('an=2z')
    expect(container.querySelector('b')).toBe(first)
    expect(built).toHaveBeenCalledTimes(1)

    n.value = 3
    flush()
    expect(container.textContent).toBe('ahighz')
    expect(container.querySelector('b')).toBeNull()

    n.value = 0
    flush()
    expect(container.textContent).toBe('az')
  })

  it('disposes the old branch', () => {
    const on = state(true)
    const cleanup = vi.fn()
    r.mount(host(), () =>
      r.el(
        'div',
        {},
        r.cond(
          () => (on.value ? 0 : -1),
          [
            () => {
              onCleanup(cleanup)
              return r.el('p')
            },
          ],
        ),
      ),
    )
    on.value = false
    flush()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})

describe('components', () => {
  const Button = defineComponent('Button', { tone: 'primary', size: 'md' }, ($ctx) => {
    const { disabled } = $ctx.props({ disabled: false })
    return $ctx.root(
      r.el(
        'button',
        {
          attrs: { disabled: () => disabled!.value },
          on: { click: () => $ctx.emit('press', 42) },
        },
        r.el('span', {}, $ctx.slot('icon')),
        r.el(
          'b',
          {},
          $ctx.slot('default', () => ['fallback']),
        ),
      ),
      'root',
    )
  })

  it('applies variant defaults and parent values as data attributes, reactively', () => {
    const tone = state('danger')
    const container = host()
    r.mount(container, () => Button({ props: { tone: derived(() => tone.value) } }))
    const button = container.querySelector('button')!
    expect(button.getAttribute('data-tone')).toBe('danger')
    expect(button.getAttribute('data-size')).toBe('md')
    tone.value = 'neutral'
    flush()
    expect(button.getAttribute('data-tone')).toBe('neutral')
  })

  it('props() returns signals with defaults, and passes values through', () => {
    const disabled = state(false)
    const container = host()
    r.mount(container, () => Button({ props: { disabled } }))
    const button = container.querySelector('button')!
    expect(button.hasAttribute('disabled')).toBe(false)
    disabled.value = true
    flush()
    expect(button.getAttribute('disabled')).toBe('')
  })

  it('a prop the parent leaves undefined falls back to the default', () => {
    const tone = state<string | undefined>(undefined)
    const container = host()
    r.mount(container, () => Button({ props: { tone } }))
    expect(container.querySelector('button')!.getAttribute('data-tone')).toBe('primary')
  })

  it('forwards unclaimed attributes to the root, appending class', () => {
    const container = host()
    r.mount(container, () =>
      Button({
        props: {
          class: constant('extra'),
          'aria-label': constant('Save'),
          hidden: constant(true),
          title: constant(null),
        },
      }),
    )
    const button = container.querySelector('button')!
    expect(button.getAttribute('class')).toBe('root extra')
    expect(button.getAttribute('aria-label')).toBe('Save')
    expect(button.getAttribute('hidden')).toBe('')
    expect(button.hasAttribute('title')).toBe(false)
    // `disabled` is claimed by the component, so it is not applied twice.
  })

  it('emits events to the parent', () => {
    const onPress = vi.fn()
    const container = host()
    r.mount(container, () => Button({ events: { press: onPress } }))
    container.querySelector('button')!.click()
    expect(onPress).toHaveBeenCalledWith(42)
  })

  it('renders named and default slot content, with fallback', () => {
    const container = host()
    r.mount(container, () =>
      Button({
        slots: { icon: () => [r.el('i', {}, '!')], default: () => ['Save ', () => 'now'] },
      }),
    )
    expect(container.querySelector('span')!.innerHTML).toBe('<i>!</i>')
    expect(container.querySelector('b')!.textContent).toBe('Save now')

    const plain = host()
    r.mount(plain, () => Button())
    expect(plain.querySelector('b')!.textContent).toBe('fallback')
    expect(plain.querySelector('span')!.textContent).toBe('')
  })

  it('removes slot content when the component is disposed', () => {
    const container = host()
    const cleanup = vi.fn()
    const dispose = r.mount(container, () =>
      Button({
        slots: {
          default: () => [
            () => {
              onCleanup(cleanup)
              return 'x'
            },
          ],
        },
      }),
    )
    dispose()
    expect(container.innerHTML).toBe('')
  })
})

describe('hot updates', () => {
  it('re-evaluating a component with the same id re-renders live instances in place', () => {
    const make = (label: string) =>
      defineComponent(
        'Greeting',
        { tone: 'a' },
        ($ctx) => $ctx.root(r.el('p', { attrs: { class: 'root' } }, label)),
        'test/Greeting.tess',
      )
    const Greeting = make('hello')
    const container = host()
    r.mount(container, () =>
      r.el('section', {}, r.el('h1', {}, 'title'), Greeting(), r.el('h2', {}, 'after')),
    )
    const before = container.querySelector('p')!
    expect(before.textContent).toBe('hello')

    const Updated = make('goodbye')
    expect(Updated).toBe(Greeting) // importers keep the same function
    const after = container.querySelector('p')!
    expect(after.textContent).toBe('goodbye')
    expect(after).not.toBe(before)
    expect([...container.querySelector('section')!.children].map((c) => c.tagName)).toEqual([
      'H1',
      'P',
      'H2',
    ])
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('new instances use the latest implementation', () => {
    const make = (label: string) =>
      defineComponent('Label', {}, ($ctx) => $ctx.root(r.el('p', {}, label)), 'test/Label.tess')
    const Label = make('one')
    make('two')
    const container = host()
    r.mount(container, () => Label())
    expect(container.textContent).toBe('two')
  })
})
