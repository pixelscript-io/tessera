import type { RendererAdapter } from '@tessera/core'

/** What a `choose` event carries: the radio the person chose, from the keyboard or the pointer. */
export interface RadioGroupChoose {
  /** The chosen radio's `data-value`, or its `id` if it has none, or its position (`"0"`, `"1"`). */
  value: string
  source: 'keyboard' | 'pointer'
  event: unknown
}

export interface RadioGroupOptions {
  onChoose: (detail: RadioGroupChoose) => void
}

type RadioEvent = {
  key?: string
  detail?: number
  target: unknown
  preventDefault(): void
}

const RADIO = '[role="radio"]'

/**
 * A radio group: the keys and the pointer of a set of radios (the ARIA radio group pattern), on the element that has
 * `role="radiogroup"`. It needs a DOM: it finds the radios and moves focus.
 *
 * It does not own which radio is checked. The component does, and binds on each radio `aria-checked` and `tabindex`
 * (0 for the checked one, or for the first enabled one when none is checked, and -1 for the others, so Tab leaves the
 * group). The behavior reports where the person is going and the component moves its state:
 *
 * - Arrow Right and Arrow Down focus the next radio and choose it; Arrow Left and Arrow Up the previous one. Both
 *   wrap at the ends. (A radio group moves in any direction, unlike tabs.)
 * - Space chooses the focused radio, and so does a click.
 * - A disabled radio (`disabled`, or `aria-disabled="true"`) is skipped by the keys and gives no click.
 * - It sets `role="radiogroup"` if the element has none.
 *
 * Returns a function that removes everything it added.
 */
export function attachRadioGroup<N, E extends N>(
  adapter: RendererAdapter<N, E>,
  group: E,
  options: RadioGroupOptions,
): () => void {
  const root = group as unknown as HTMLElement
  if (adapter.getAttribute(group, 'role') === null)
    adapter.setAttribute(group, 'role', 'radiogroup')

  const radios = () => [...root.querySelectorAll<HTMLElement>(RADIO)]
  const disabled = (radio: HTMLElement) =>
    radio.hasAttribute('disabled') || radio.getAttribute('aria-disabled') === 'true'
  const valueOf = (radio: HTMLElement) =>
    radio.dataset.value ?? (radio.id || String(radios().indexOf(radio)))
  const radioOf = (event: RadioEvent) =>
    (event.target as Element | null)?.closest<HTMLElement>(RADIO)

  const go = (radio: HTMLElement, source: RadioGroupChoose['source'], event: RadioEvent) => {
    options.onChoose({ value: valueOf(radio), source, event })
  }

  const onKeydown = (event: RadioEvent) => {
    const current = radioOf(event)
    if (!current || !root.contains(current)) return
    if (event.key === ' ') {
      event.preventDefault()
      if (!disabled(current)) go(current, 'keyboard', event)
      return
    }
    const enabled = radios().filter((r) => !disabled(r) || r === current)
    const at = enabled.indexOf(current)
    let next: HTMLElement | undefined
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = enabled[(at + 1) % enabled.length]
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = enabled[(at - 1 + enabled.length) % enabled.length]
        break
      default:
        return
    }
    event.preventDefault()
    if (!next || disabled(next)) return
    next.focus()
    go(next, 'keyboard', event)
  }

  const onClick = (event: RadioEvent) => {
    const radio = radioOf(event)
    if (!radio || !root.contains(radio) || disabled(radio)) return
    // A click with no pointer (`detail` 0) is Enter or Space on a button.
    go(radio, event.detail === 0 ? 'keyboard' : 'pointer', event)
  }

  adapter.addListener(group, 'keydown', onKeydown)
  adapter.addListener(group, 'click', onClick)
  return () => {
    adapter.removeListener(group, 'keydown', onKeydown)
    adapter.removeListener(group, 'click', onClick)
  }
}
