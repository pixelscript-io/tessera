import type { RendererAdapter } from '@tessera/core'
import { attachPress, type PressDetail } from './press'

/** What an `expand` event carries. */
export interface ExpandDetail {
  /** The state it is moving to: open (`true`) or closed. */
  expanded: boolean
  source: PressDetail['source']
  event: unknown
}

export interface DisclosureOptions {
  onExpand: (detail: ExpandDetail) => void
  /** The trigger activates itself (a `<button>`). See `PressOptions.native`. */
  native?: boolean
}

/**
 * Disclosure: a trigger that shows and hides a region, for an accordion item or a "show more".
 *
 * Attach it to the trigger. It is `press`, reading the current state from `aria-expanded` on the trigger (the component
 * binds it, and owns the state) and reporting where it is going. It starts as collapsed if the trigger has no state yet.
 * Showing and hiding the content is the component's job: bind `hidden` to the same state.
 *
 * Returns a function that removes everything it added.
 */
export function attachDisclosure<N, E extends N>(
  adapter: RendererAdapter<N, E>,
  trigger: E,
  options: DisclosureOptions,
): () => void {
  if (adapter.getAttribute(trigger, 'aria-expanded') === null)
    adapter.setAttribute(trigger, 'aria-expanded', 'false')
  return attachPress(adapter, trigger, {
    native: options.native ?? false,
    role: 'button',
    onPress: ({ source, event }) =>
      options.onExpand({
        expanded: adapter.getAttribute(trigger, 'aria-expanded') !== 'true',
        source,
        event,
      }),
  })
}
