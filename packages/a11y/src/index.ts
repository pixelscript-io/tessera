/**
 * Accessibility tests generated from component contracts. Hand one this folder's components and their
 * source text and it registers, for each component: an axe-core run for every combination of variant values
 * and state, in every theme; a check that the root has the role the contract declares; a visible focus
 * indicator; disabled semantics; and the conformance suite of the behavior the contract names.
 *
 * Browser only: it needs real layout, real focus and a real keyboard, so it runs under Vitest's browser mode.
 */
import axe from 'axe-core'
import { userEvent } from '@vitest/browser/context'
import { afterEach, describe, expect, it } from 'vitest'
import {
  comboboxConformance,
  dialogConformance,
  disclosureConformance,
  domComboboxHarness,
  domDialogHarness,
  domHarness,
  domTabsHarness,
  pressConformance,
  tabsConformance,
  toggleConformance,
} from '@tessera/behavior/conformance'
import { extractContract, type Contract } from '@tessera/compiler'
import { constant, flush, getRenderer, state, type Component } from '@tessera/core'
import { setTheme } from '@tessera/tokens'

/** What automation here does not check. The docs list this next to each component's results. */
export const NOT_COVERED = [
  'How a screen reader announces the component: name, role, state and value, in each reader and browser pair.',
  'Whether labels and content are good: axe checks that a button has a name, not that the name makes sense.',
  'Focus order and focus management in the context of a whole page.',
  'Reduced-motion behavior: the tests run with default motion preferences.',
  'Zoom and reflow, forced-colors (high contrast) mode, and text spacing overrides.',
  'Touch target sizing beyond what axe checks, and gestures.',
  'Real hover, pressed and focus states for components whose contracts name states the test cannot create (for example drag).',
  'Combinations of a component with others, and content the app puts in its slots.',
] as const

export type State =
  'rest' | 'hover' | 'focus-visible' | 'pressed' | 'disabled' | 'checked' | 'expanded' | 'open'

/** Every combination of one value per variant. A component with no variants has one empty combination. */
export function variantCombinations(contract: Contract): Array<Record<string, string>> {
  let combos: Array<Record<string, string>> = [{}]
  for (const [name, values] of Object.entries(contract.variants)) {
    combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [name]: value })))
  }
  return combos
}

/** `rest`, then each state the contract declares that the test can create. */
export function statesFor(contract: Contract): State[] {
  const supported: State[] = [
    'hover',
    'focus-visible',
    'pressed',
    'checked',
    'expanded',
    'open',
    'disabled',
  ]
  return ['rest', ...supported.filter((s) => contract.states.includes(s))]
}

export interface A11yOptions {
  /** Compiled components by file path, for example from `import.meta.glob('./*.tess', { eager: true, import: 'default' })`. */
  components: Record<string, Component>
  /** Source text of the same files, from `import.meta.glob('./*.tess', { query: '?raw', eager: true, import: 'default' })`. */
  sources: Record<string, string>
  /** Themes to run in. `null` is the default theme. */
  themes?: Array<string | null>
  /**
   * Props a component needs to be tested with, by component name: a combobox needs options to show. They are given as
   * props in every run of that component.
   */
  fixtures?: Record<string, { props?: Record<string, unknown> }>
}

const r = getRenderer()

/** What an event carried, as a conformance suite reads it. */
type Recorded = {
  source: string
  checked?: boolean
  expanded?: boolean
  reason?: string
  label?: string
}

interface Mounted {
  host: HTMLElement
  root: HTMLElement
  disabled: ReturnType<typeof state<boolean>>
  /** Whether the component is open, for a dialog. */
  open: ReturnType<typeof state<boolean>>
  /** The events of the contract's behavior, in order. */
  presses: Recorded[]
  dispose(): void
}

/** The event each behavior produces, which is what its conformance suite counts. */
const BEHAVIOR_EVENT: Record<string, string> = {
  press: 'press',
  toggle: 'toggle',
  disclosure: 'expand',
  dialog: 'dismiss',
  // A combobox's own event is its keys; what the suite counts is what was chosen.
  combobox: 'select',
  tabs: 'activate',
}

function mount(
  component: Component,
  contract: Contract,
  variants: Record<string, string>,
  initial: { disabled?: boolean } = {},
  fixture: { props?: Record<string, unknown> } = {},
): Mounted {
  const host = document.createElement('div')
  // A page-like surface, so contrast is measured against what a real page would paint.
  host.style.cssText =
    'padding: 16px; background: var(--t-color-surface-default); color: var(--t-color-text-default);'
  document.body.append(host)
  const disabled = state(initial.disabled ?? false)
  const open = state(false)
  const presses: Recorded[] = []
  const own = contract.behavior ? BEHAVIOR_EVENT[contract.behavior] : undefined
  const dispose = r.mount(host, () =>
    component({
      props: {
        ...Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, constant(v)])),
        disabled,
        open,
        ...Object.fromEntries(
          Object.entries(fixture.props ?? {}).map(([k, v]) => [k, constant(v)]),
        ),
      },
      events: Object.fromEntries(
        Object.keys(contract.events).map((name) => [
          name,
          (detail: unknown) => {
            if (name !== own) return
            const d = detail as Recorded | undefined
            presses.push({ ...(d ?? {}), source: d?.source ?? 'unknown' })
          },
        ]),
      ),
      // Every slot the contract declares has text, so a component that needs a label has one.
      slots: Object.fromEntries(
        Object.keys(contract.slots).map((name) => [
          name,
          () => [name === 'default' ? 'Label' : `${name} text`],
        ]),
      ),
    }),
  )
  return {
    host,
    root: host.firstElementChild as HTMLElement,
    disabled,
    open,
    presses,
    dispose: () => (dispose(), host.remove()),
  }
}

/** The element a behavior's conformance runs against: the root, a trigger inside it, or a form control inside it. */
function subjectOf(root: HTMLElement, contract: Contract): HTMLElement {
  if (contract.behavior === 'disclosure')
    return root.querySelector<HTMLElement>('[class*="__trigger"]') ?? root
  // The tab list is the element a tabs behavior is attached to.
  if (contract.behavior === 'tabs')
    return root.matches('[role="tablist"]')
      ? root
      : (root.querySelector<HTMLElement>('[role="tablist"]') ?? root)
  // A dialog is the element that has the role, which is the root.
  if (contract.behavior === 'dialog') return root
  if (root.matches('button, input, select, textarea, [role]')) return root
  return root.querySelector<HTMLElement>('input, select, textarea, button') ?? root
}

async function settle(root: HTMLElement): Promise<void> {
  flush()
  // Colors are measured after any transition finishes, not partway through.
  await Promise.all(root.getAnimations().map((a) => a.finished.catch(() => undefined)))
}

async function enter(state: State, m: Mounted, subject: HTMLElement): Promise<void> {
  if (state === 'disabled') m.disabled.value = true
  else if (state === 'pressed') subject.setAttribute('data-state', 'pressed')
  else if (state === 'hover') await userEvent.hover(subject)
  else if (state === 'focus-visible') await userEvent.tab()
  // Checked and expanded are reached the way a person reaches them: by pressing it.
  else if (state === 'checked' || state === 'expanded') {
    // A combobox is expanded from the keyboard, with focus in the field.
    if (subject.getAttribute('role') === 'combobox') {
      subject.focus()
      await userEvent.keyboard('{ArrowDown}')
    } else await userEvent.click(subject)
  } else if (state === 'open') {
    m.open.value = true
    // The behavior follows the attribute in a microtask, and the browser moves focus.
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  await settle(m.root)
}

async function leave(state: State, m: Mounted, subject: HTMLElement): Promise<void> {
  if (state === 'hover') await userEvent.unhover(subject)
  ;(document.activeElement as HTMLElement | null)?.blur()
}

async function runAxe(host: HTMLElement): Promise<string[]> {
  const results = await axe.run(host, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
    // The fixture is a fragment, not a page, so page-level rules do not apply.
    rules: {
      region: { enabled: false },
      'landmark-one-main': { enabled: false },
      'page-has-heading-one': { enabled: false },
    },
  })
  return results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.html}\n    ${n.failureSummary?.replace(/\n/g, '\n    ')}`).join('\n')}`,
  )
}

const label = (variants: Record<string, string>) =>
  Object.entries(variants)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ') || 'no variants'

const IMPLICIT_ROLES: Record<string, string> = {
  button: 'button',
  a: 'link',
  summary: 'button',
  input: 'textbox',
  select: 'combobox',
  textarea: 'textbox',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  nav: 'navigation',
  dialog: 'dialog',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  table: 'table',
}

/**
 * What a behavior's conformance suite runs against, and how to make that from a mounted component. A press, toggle or
 * disclosure is one element; a dialog and a combobox are a component with an opener, a list and the rest.
 */
interface Suite {
  title: string
  cases: ReadonlyArray<{ name: string; run(harness: any): Promise<void> }>
  /** Whether the visible focus ring is checked on the subject at rest (not for a dialog, which starts closed). */
  focusRing: boolean
  harness(m: Mounted, subject: HTMLElement, fixture: { props?: Record<string, unknown> }): any
}

const SUITES: Record<string, Suite> = {
  press: {
    title: 'press behavior conformance',
    cases: pressConformance,
    focusRing: true,
    harness: (m, subject) => elementHarness(m, subject),
  },
  toggle: {
    title: 'toggle behavior conformance',
    cases: toggleConformance,
    focusRing: true,
    harness: (m, subject) => elementHarness(m, subject),
  },
  disclosure: {
    title: 'disclosure behavior conformance',
    cases: disclosureConformance,
    focusRing: true,
    harness: (m, subject) =>
      elementHarness(m, subject, m.root.querySelector<HTMLElement>('[class*="__content"]')),
  },
  dialog: {
    title: 'dialog behavior conformance',
    cases: dialogConformance,
    focusRing: false,
    harness: (m, subject) => {
      const opener = document.createElement('button')
      opener.textContent = 'Open'
      m.host.append(opener)
      return domDialogHarness(subject as HTMLDialogElement, opener, userEvent, {
        dismissals: m.presses as Array<{ reason: string }>,
        setOpen: async (open) => {
          m.open.value = open
          flush()
        },
      })
    },
  },
  tabs: {
    title: 'tabs behavior conformance',
    cases: tabsConformance,
    focusRing: false,
    harness: (m, subject) =>
      domTabsHarness(subject, userEvent, {
        panels: () => [...m.root.querySelectorAll<HTMLElement>('[role="tabpanel"]')],
        activations: m.presses as Array<{ value: string; source: string }>,
        // The behavior reads the attribute, so the case sets the one a component would bind.
        setDisabled: (index, disabled) => {
          const tab = subject.querySelectorAll('[role="tab"]')[index]!
          if (disabled) tab.setAttribute('aria-disabled', 'true')
          else tab.removeAttribute('aria-disabled')
        },
      }),
  },
  combobox: {
    title: 'combobox behavior conformance',
    cases: comboboxConformance,
    focusRing: true,
    harness: (m, subject, fixture) => {
      const given = (fixture.props?.options ?? []) as Array<{ label: string }>
      const listbox = () => m.root.querySelector<HTMLElement>('[role="listbox"]')
      return domComboboxHarness(subject as HTMLInputElement, userEvent, {
        listbox,
        options: () => [...(listbox()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])],
        labels: given.map((o) => o.label),
        selections: m.presses,
        setDisabled: async (disabled) => {
          m.disabled.value = disabled
          flush()
        },
      })
    },
  },
}

/** The harness of the one-element behaviors: the element, the events it produced, and how to disable it. */
function elementHarness(m: Mounted, subject: HTMLElement, content?: HTMLElement | null) {
  return domHarness(subject, userEvent, {
    presses: m.presses,
    setDisabled: async (disabled) => {
      m.disabled.value = disabled
      flush()
    },
    ...(content !== undefined ? { content } : {}),
  })
}

export function defineA11ySuites(options: A11yOptions): void {
  const themes = options.themes ?? [null, 'dark']
  const entries = Object.entries(options.sources)
    .map(([path, source]) => ({
      path,
      source,
      contract: extractContract(source, path),
      component: options.components[path],
    }))
    .filter(
      (e): e is typeof e & { contract: Contract; component: Component } =>
        !!e.contract && !!e.component,
    )

  afterEach(() => {
    setTheme(null)
    document.body.innerHTML = ''
  })

  it('finds components to test', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  for (const { contract, component } of entries) {
    const fixture = options.fixtures?.[contract.name] ?? {}
    describe(`${contract.name} accessibility`, () => {
      for (const theme of themes) {
        const themeName = theme ?? 'default theme'
        describe(themeName, () => {
          for (const state of statesFor(contract)) {
            for (const variants of variantCombinations(contract)) {
              it(`has no axe violations: ${label(variants)}, ${state}`, async () => {
                setTheme(theme)
                const m = mount(component, contract, variants, {}, fixture)
                const subject = subjectOf(m.root, contract)
                try {
                  await enter(state, m, subject)
                  expect(await runAxe(m.host)).toEqual([])
                } finally {
                  await leave(state, m, subject)
                  m.dispose()
                }
              })
            }
          }
        })
      }

      it(`has the ${contract.role} role its contract declares`, () => {
        const m = mount(component, contract, {}, {}, fixture)
        try {
          const actual = m.root.getAttribute('role') ?? IMPLICIT_ROLES[m.root.tagName.toLowerCase()]
          if (!['generic', 'none', 'presentation'].includes(contract.role))
            expect(actual).toBe(contract.role)
        } finally {
          m.dispose()
        }
      })

      if (contract.states.includes('disabled')) {
        it('is disabled in a way assistive technology can see', () => {
          const m = mount(component, contract, {}, { disabled: true })
          try {
            flush()
            const subject = subjectOf(m.root, contract)
            const disabled =
              subject.hasAttribute('disabled') || subject.getAttribute('aria-disabled') === 'true'
            expect(
              disabled,
              'the element has neither disabled nor aria-disabled="true" when disabled',
            ).toBe(true)
          } finally {
            m.dispose()
          }
        })
      }

      if (contract.states.includes('focus-visible') && !contract.behavior) {
        it('shows a visible focus indicator on its control when reached with the keyboard', async () => {
          const m = mount(component, contract, {})
          const subject = subjectOf(m.root, contract)
          try {
            await userEvent.tab()
            expect(document.activeElement).toBe(subject)
            const style = getComputedStyle(subject)
            expect(
              (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
                style.boxShadow !== 'none',
              'no outline or ring on :focus-visible',
            ).toBe(true)
          } finally {
            await leave('rest', m, subject)
            m.dispose()
          }
        })
      }

      const suite = contract.behavior ? SUITES[contract.behavior] : undefined
      if (suite) {
        if (suite.focusRing) {
          it('shows a visible focus indicator when reached with the keyboard', async () => {
            const m = mount(component, contract, {}, {}, fixture)
            const subject = subjectOf(m.root, contract)
            try {
              await userEvent.tab()
              expect(document.activeElement).toBe(subject)
              const style = getComputedStyle(subject)
              expect(
                style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
                'no outline on :focus-visible',
              ).toBe(true)
            } finally {
              await leave('rest', m, subject)
              m.dispose()
            }
          })
        }

        describe(suite.title, () => {
          for (const testCase of suite.cases) {
            it(testCase.name, async () => {
              const m = mount(component, contract, {}, {}, fixture)
              const subject = subjectOf(m.root, contract)
              try {
                await testCase.run(suite.harness(m, subject, fixture))
              } finally {
                await leave('rest', m, subject)
                m.dispose()
              }
            })
          }
        })
      }
    })
  }
}
