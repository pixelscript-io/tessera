import type { RendererAdapter } from '@tessera/core'
import { attachPress, type PressDetail } from './press'

/** What a `toggle` event carries. */
export interface ToggleDetail {
  /** The state it is moving to: on (`true`) or off. */
  checked: boolean
  /** How it was activated: a tap, a key, or code. */
  source: PressDetail['source']
  /** The DOM event that caused it. */
  event: unknown
}

export interface ToggleOptions {
  onToggle: (detail: ToggleDetail) => void
  /** The element activates itself (a `<button>`). See `PressOptions.native`. */
  native?: boolean
  /** `checkbox`, `switch` or `button` (a toggle button). Decides the ARIA attribute and the keys. */
  role?: string
}

/** A toggle button is `aria-pressed`; a checkbox and a switch are `aria-checked`. */
export const toggleAttribute = (role: string | undefined): 'aria-pressed' | 'aria-checked' =>
  role === 'button' ? 'aria-pressed' : 'aria-checked'

/**
 * Toggle: press that moves between on and off, for a checkbox, a switch or a toggle button.
 *
 * - The current state is read from the element (`aria-checked`, or `aria-pressed` for a toggle button), so the
 *   component stays the owner of the value: it binds the attribute, and reacts to the event by setting its own state.
 *   The event says where it is going, never that it got there.
 * - Space toggles. Enter toggles a switch and a toggle button but not a checkbox, which is what browsers do for a
 *   native one. Everything else about activation (disabled, key repeat, `data-state="pressed"`) is `press`.
 * - Starts as off if the element has no state yet, so assistive technology always has a value to read.
 *
 * Returns a function that removes everything it added.
 */
export function attachToggle<N, E extends N>(
  adapter: RendererAdapter<N, E>,
  el: E,
  options: ToggleOptions,
): () => void {
  const role = options.role ?? 'checkbox'
  const attribute = toggleAttribute(role)
  if (adapter.getAttribute(el, attribute) === null) adapter.setAttribute(el, attribute, 'false')

  // A native button turns Enter into a click. A checkbox is not toggled by Enter, so that click must not happen.
  const swallowEnter = (event: { key?: string; preventDefault(): void }) => {
    if (role === 'checkbox' && event.key === 'Enter') event.preventDefault()
  }
  adapter.addListener(el, 'keydown', swallowEnter)

  const detach = attachPress(adapter, el, {
    native: options.native ?? false,
    role,
    onPress: ({ source, event }) => {
      if (role === 'checkbox' && (event as { key?: string } | undefined)?.key === 'Enter') return
      const checked = adapter.getAttribute(el, attribute) !== 'true'
      options.onToggle({ checked, source, event })
    },
  })

  return () => {
    detach()
    adapter.removeListener(el, 'keydown', swallowEnter)
  }
}
