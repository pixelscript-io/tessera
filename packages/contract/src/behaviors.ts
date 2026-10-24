export interface BehaviorRequirements {
  /** Parts the contract must declare for the behavior to attach to. */
  parts: readonly string[]
  /** Events the contract must declare. */
  events: readonly string[]
  /** States the contract must declare. */
  states: readonly string[]
}

/**
 * Provisional requirements for the v0.1 behaviors. `@tessera/behavior` (Milestone 7) becomes the source
 * of truth and passes its own table to `parseContract`; this default keeps the contract package usable alone.
 */
export const DEFAULT_BEHAVIORS: Readonly<Record<string, BehaviorRequirements>> = {
  press: { parts: ['root'], events: ['press'], states: [] },
  toggle: { parts: ['root'], events: ['toggle'], states: [] },
  disclosure: { parts: ['root', 'trigger', 'content'], events: ['expand'], states: [] },
  dialog: { parts: ['root'], events: ['dismiss'], states: [] },
  combobox: { parts: ['root', 'input', 'listbox'], events: [], states: [] },
}
