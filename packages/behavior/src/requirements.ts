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

/**
 * What a contract must declare to use each behavior. The compiler validates `"behavior"` against this table.
 * `toggle` and `disclosure` are reserved names until Milestone 17.
 */
export const BEHAVIOR_REQUIREMENTS: Readonly<Record<string, BehaviorRequirements>> = {
  press: { parts: ['root'], events: ['press'], states: [], implemented: true },
  toggle: { parts: ['root'], events: ['toggle'], states: [], implemented: false },
  disclosure: {
    parts: ['root', 'trigger', 'content'],
    events: ['toggle'],
    states: [],
    implemented: false,
  },
}

/** Behavior event name to the behavior that produces it, so `@press` in a template can be wired. */
export const BEHAVIOR_EVENTS: Readonly<Record<string, string>> = {
  press: 'press',
  toggle: 'toggle',
}
