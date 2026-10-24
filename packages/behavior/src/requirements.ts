export interface BehaviorRequirements {
  /** Parts the contract must declare. */
  parts: readonly string[]
  /** Events the contract must declare. */
  events: readonly string[]
  /** States the contract must declare. */
  states: readonly string[]
  /** The behavior is built. Others are named in contracts but cannot be wired yet. */
  implemented: boolean
}

/** What a contract must declare to use each behavior. The compiler validates `"behavior"` against this table. */
export const BEHAVIOR_REQUIREMENTS: Readonly<Record<string, BehaviorRequirements>> = {
  press: { parts: ['root'], events: ['press'], states: [], implemented: true },
  toggle: { parts: ['root'], events: ['toggle'], states: [], implemented: true },
  disclosure: {
    parts: ['root', 'trigger', 'content'],
    events: ['expand'],
    states: [],
    implemented: true,
  },
  dialog: { parts: ['root'], events: ['dismiss'], states: [], implemented: true },
  combobox: { parts: ['root', 'input', 'listbox'], events: [], states: [], implemented: true },
}

/** Behavior event name to the behavior that produces it, so `@press` in a template can be wired. */
export const BEHAVIOR_EVENTS: Readonly<Record<string, string>> = {
  press: 'press',
  toggle: 'toggle',
  expand: 'disclosure',
  dismiss: 'dialog',
  command: 'combobox',
}

/** The function each behavior is attached with, exported from `@pixelscriptio/tessera/behavior`. */
export const BEHAVIOR_ATTACH: Readonly<Record<string, string>> = {
  press: 'attachPress',
  toggle: 'attachToggle',
  disclosure: 'attachDisclosure',
  dialog: 'attachDialog',
  combobox: 'attachCombobox',
}
