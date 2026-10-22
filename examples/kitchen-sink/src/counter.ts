// Hand-written (not compiled) counter, standing in for Counter.tess until Milestone 4.
import { createDomAdapter, createRenderer, derived, state } from '../../../packages/core/src'

export function mountCounter(container: Element) {
  const r = createRenderer(createDomAdapter(container.ownerDocument))
  const count = state(0)
  const label = derived(() => `Clicked ${count.value} times`)
  const todos = state([{ id: 1, text: 'Write signals' }])
  return {
    count,
    todos,
    dispose: r.mount(container, () =>
      r.el(
        'div',
        {},
        r.el('button', { on: { click: () => count.value++ } }, () => label.value),
        r.el(
          'ul',
          {},
          r.each(
            () => todos.value,
            (t) => t.id,
            (t) => r.el('li', {}, () => t.value.text),
          ),
        ),
      ),
    ),
  }
}
