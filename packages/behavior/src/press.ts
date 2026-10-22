import type { RendererAdapter } from '@tessera/core'

/** What a `press` event carries. */
export interface PressDetail {
  /** How it was activated: a mouse or touch tap, a key, or code (`element.click()`, assistive technology). */
  source: 'pointer' | 'keyboard' | 'virtual'
  /** The DOM event that caused it. */
  event: unknown
}

export interface PressOptions {
  onPress: (detail: PressDetail) => void
  /**
   * The element already activates itself: `<button>`, `<a href>`, `<summary>`. Then the browser turns Enter and
   * Space into clicks, and the behavior only listens to `click`. Otherwise the behavior adds the keyboard
   * support, `tabindex` and `role` itself. The compiler decides this from the tag name.
   */
  native?: boolean
  /** ARIA role to set on an element that is not native. */
  role?: string
}

type DomEvent = {
  key?: string
  repeat?: boolean
  button?: number
  detail?: number
  preventDefault(): void
}

/**
 * Press: a click, a tap, or Enter or Space on the element, with none of the differences between them.
 *
 * - Disabled is read from the element (`disabled` or `aria-disabled="true"`), so it follows whatever the
 *   template binds. A disabled element never presses.
 * - While the pointer or Space or Enter is held, the element has `data-state="pressed"`, so styles can use
 *   it without JavaScript.
 * - On an element that is not natively pressable it adds `tabindex="0"` and the role, listens for Enter
 *   (on keydown) and Space (on keyup, after preventing the page from scrolling), and ignores key repeat.
 *
 * Works with no styles applied, and talks to the element only through the renderer adapter. Returns a
 * function that removes everything it added.
 */
export function attachPress<N, E extends N>(
  adapter: RendererAdapter<N, E>,
  el: E,
  options: PressOptions,
): () => void {
  const native = options.native ?? false
  const isDisabled = () =>
    adapter.getAttribute(el, 'disabled') !== null ||
    adapter.getAttribute(el, 'aria-disabled') === 'true'

  let lastInput: 'pointer' | 'keyboard' | undefined
  let spaceDown = false

  const setPressed = (pressed: boolean) =>
    adapter.setAttribute(el, 'data-state', pressed ? 'pressed' : null)
  const release = () => {
    spaceDown = false
    setPressed(false)
  }

  const press = (source: PressDetail['source'], event: unknown) => {
    if (isDisabled()) return
    options.onPress({ source, event })
  }

  const listeners: Array<[string, (event: any) => void]> = [
    [
      'pointerdown',
      (event: DomEvent) => {
        if (isDisabled() || (event.button !== undefined && event.button !== 0)) return
        lastInput = 'pointer'
        setPressed(true)
      },
    ],
    ['pointerup', release],
    ['pointercancel', release],
    ['pointerleave', release],
    ['blur', release],
    [
      'click',
      (event: DomEvent) => {
        if (isDisabled()) {
          event.preventDefault()
          return
        }
        // A click right after a key or pointer press is that press; otherwise it came from code.
        const source = lastInput ?? 'virtual'
        lastInput = undefined
        press(source, event)
      },
    ],
    [
      'keydown',
      (event: DomEvent) => {
        if (isDisabled()) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        lastInput = 'keyboard'
        setPressed(true)
        if (native) return
        // No native click for this element: Enter presses now, Space on release.
        event.preventDefault()
        if (event.key === 'Enter' && !event.repeat) {
          press('keyboard', event)
        } else if (event.key === ' ') spaceDown = true
      },
    ],
    [
      'keyup',
      (event: DomEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        setPressed(false)
        if (native) return
        if (event.key === ' ' && spaceDown) {
          spaceDown = false
          event.preventDefault()
          press('keyboard', event)
        }
      },
    ],
  ]

  // A native click is the only activation for natives; non-natives are driven by keys and pointer clicks.
  for (const [type, handler] of listeners) adapter.addListener(el, type, handler)

  if (!native) {
    if (options.role && adapter.getAttribute(el, 'role') === null)
      adapter.setAttribute(el, 'role', options.role)
    if (adapter.getAttribute(el, 'tabindex') === null) adapter.setAttribute(el, 'tabindex', '0')
  }

  return () => {
    for (const [type, handler] of listeners) adapter.removeListener(el, type, handler)
    setPressed(false)
  }
}
