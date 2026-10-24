import type { RendererAdapter } from '@tessera/core'

/** What an `activate` event carries: the tab the person chose, from the keyboard or the pointer. */
export interface TabsActivate {
  /** The chosen tab's `data-value`, or its `id` if it has none, or its position (`"0"`, `"1"`). */
  value: string
  source: 'keyboard' | 'pointer'
  event: unknown
}

export interface TabsOptions {
  onActivate: (detail: TabsActivate) => void
}

type TabsEvent = {
  key?: string
  detail?: number
  target: unknown
  preventDefault(): void
}

const TAB = '[role="tab"]'

/**
 * Tabs: the keys and the pointer of a tab list (the ARIA tabs pattern, with automatic activation), on the element that
 * has `role="tablist"`. It needs a DOM: it finds the tabs and moves focus.
 *
 * It does not own which tab is selected. The component does, and binds on each tab `aria-selected`, `tabindex` (0 for
 * the selected one, -1 for the others, so Tab leaves the list) and `aria-controls`, and on each panel `hidden` and
 * `aria-labelledby`. The behavior reports where the person is going and the component moves its state:
 *
 * - Arrow Right and Arrow Left (Down and Up when the list has `aria-orientation="vertical"`) focus the next and previous
 *   tab and activate it, wrapping at the ends. Home and End go to the first and last.
 * - A click on a tab activates it (so does Enter or Space on a `<button>`, which the browser turns into a click).
 * - A disabled tab (`disabled`, or `aria-disabled="true"`) is skipped by the keys and gives no click.
 * - It sets `role="tablist"` if the element has none.
 *
 * Returns a function that removes everything it added.
 */
export function attachTabs<N, E extends N>(
  adapter: RendererAdapter<N, E>,
  list: E,
  options: TabsOptions,
): () => void {
  const root = list as unknown as HTMLElement
  if (adapter.getAttribute(list, 'role') === null) adapter.setAttribute(list, 'role', 'tablist')

  const tabs = () => [...root.querySelectorAll<HTMLElement>(TAB)]
  const disabled = (tab: HTMLElement) =>
    tab.hasAttribute('disabled') || tab.getAttribute('aria-disabled') === 'true'
  const valueOf = (tab: HTMLElement) => tab.dataset.value ?? (tab.id || String(tabs().indexOf(tab)))
  const tabOf = (event: TabsEvent) => (event.target as Element | null)?.closest<HTMLElement>(TAB)

  const go = (tab: HTMLElement, source: TabsActivate['source'], event: TabsEvent) => {
    options.onActivate({ value: valueOf(tab), source, event })
  }

  const onKeydown = (event: TabsEvent) => {
    const current = tabOf(event)
    if (!current || !root.contains(current)) return
    const vertical = adapter.getAttribute(list, 'aria-orientation') === 'vertical'
    const enabled = tabs().filter((t) => !disabled(t) || t === current)
    const at = enabled.indexOf(current)
    let next: HTMLElement | undefined
    switch (event.key) {
      case vertical ? 'ArrowDown' : 'ArrowRight':
        next = enabled[(at + 1) % enabled.length]
        break
      case vertical ? 'ArrowUp' : 'ArrowLeft':
        next = enabled[(at - 1 + enabled.length) % enabled.length]
        break
      case 'Home':
        next = enabled[0]
        break
      case 'End':
        next = enabled[enabled.length - 1]
        break
      default:
        return
    }
    event.preventDefault()
    if (!next || disabled(next)) return
    next.focus()
    go(next, 'keyboard', event)
  }

  const onClick = (event: TabsEvent) => {
    const tab = tabOf(event)
    if (!tab || !root.contains(tab) || disabled(tab)) return
    // A click with no pointer (`detail` 0) is Enter or Space on a button.
    go(tab, event.detail === 0 ? 'keyboard' : 'pointer', event)
  }

  adapter.addListener(list, 'keydown', onKeydown)
  adapter.addListener(list, 'click', onClick)
  return () => {
    adapter.removeListener(list, 'keydown', onKeydown)
    adapter.removeListener(list, 'click', onClick)
  }
}
