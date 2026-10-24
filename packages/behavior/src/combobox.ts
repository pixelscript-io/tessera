import type { RendererAdapter } from '@tessera/core'

/** What a `command` event carries: what the person asked the combobox to do, from the keyboard. */
export interface ComboboxCommand {
  /**
   * - `open`: show the list and make the first option active (Arrow Down while closed)
   * - `open-last`: show the list and make the last option active (Arrow Up while closed)
   * - `next`, `prev`: move the active option (Arrow Down and Arrow Up while open)
   * - `select`: choose the active option (Enter)
   * - `close`: hide the list without choosing (Escape, or Tab leaving the field)
   */
  command: 'open' | 'open-last' | 'next' | 'prev' | 'select' | 'close'
  source: 'keyboard'
  event: unknown
}

export interface ComboboxOptions {
  onCommand: (detail: ComboboxCommand) => void
  native?: boolean
  role?: string
}

type KeyEvent = {
  key?: string
  altKey?: boolean
  isComposing?: boolean
  preventDefault(): void
}

/**
 * Combobox: the keyboard of an editable combobox with a listbox popup (the ARIA 1.2 pattern), on the text input.
 *
 * It is the keys and the attributes, nothing else. The component owns the text, the options, which one is active and
 * whether the list is open, and binds `aria-expanded` and `aria-activedescendant` on the input. The behavior reads
 * those from the element, turns keys into commands, and the component moves its state:
 *
 * - Arrow Down opens the list (or moves to the next option); Arrow Up opens it on the last option (or moves back).
 * - Enter chooses the active option, and does not submit a form while it does. With no active option it does nothing.
 * - Escape closes an open list and keeps what was typed.
 * - Tab closes an open list and leaves the field as usual.
 * - It sets `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded="false"` and `autocomplete="off"` if the input
 *   has none of them, so the pattern is complete even if the component forgot one.
 * - A disabled input (or one with `aria-disabled="true"`) gives no commands. Keys during text composition (an input
 *   method editor) are left alone.
 *
 * Returns a function that removes everything it added.
 */
export function attachCombobox<N, E extends N>(
  adapter: RendererAdapter<N, E>,
  input: E,
  options: ComboboxOptions,
): () => void {
  const defaults: Array<[string, string]> = [
    ['role', 'combobox'],
    ['aria-autocomplete', 'list'],
    ['aria-expanded', 'false'],
    ['autocomplete', 'off'],
  ]
  for (const [name, value] of defaults)
    if (adapter.getAttribute(input, name) === null) adapter.setAttribute(input, name, value)

  const isDisabled = () =>
    adapter.getAttribute(input, 'disabled') !== null ||
    adapter.getAttribute(input, 'aria-disabled') === 'true'
  const isOpen = () => adapter.getAttribute(input, 'aria-expanded') === 'true'
  const hasActive = () => !!adapter.getAttribute(input, 'aria-activedescendant')

  const send = (command: ComboboxCommand['command'], event: KeyEvent) =>
    options.onCommand({ command, source: 'keyboard', event })

  const onKeydown = (event: KeyEvent) => {
    if (isDisabled() || event.isComposing) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        send(isOpen() ? 'next' : 'open', event)
        break
      case 'ArrowUp':
        event.preventDefault()
        send(isOpen() ? 'prev' : 'open-last', event)
        break
      case 'Enter':
        // Only while an option is active, so Enter still submits a form from a field with nothing chosen.
        if (isOpen() && hasActive()) {
          event.preventDefault()
          send('select', event)
        }
        break
      case 'Escape':
        if (isOpen()) {
          event.preventDefault()
          send('close', event)
        }
        break
      case 'Tab':
        if (isOpen()) send('close', event)
        break
    }
  }

  adapter.addListener(input, 'keydown', onKeydown)
  return () => adapter.removeListener(input, 'keydown', onKeydown)
}
