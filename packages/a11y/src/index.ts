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
  disclosureConformance,
  domHarness,
  pressConformance,
  toggleConformance,
  type PressHarness,
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
  'rest' | 'hover' | 'focus-visible' | 'pressed' | 'disabled' | 'checked' | 'expanded'

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
}

const r = getRenderer()

/** What an event carried, as a conformance suite reads it. */
type Recorded = { source: string; checked?: boolean; expanded?: boolean }

interface Mounted {
  host: HTMLElement
  root: HTMLElement
  disabled: ReturnType<typeof state<boolean>>
  /** The events of the contract's behavior, in order. */
  presses: Recorded[]
  dispose(): void
}

/** The event each behavior produces, which is what its conformance suite counts. */
const BEHAVIOR_EVENT: Record<string, string> = {
  press: 'press',
  toggle: 'toggle',
  disclosure: 'expand',
}

function mount(
  component: Component,
  contract: Contract,
  variants: Record<string, string>,
  initial: { disabled?: boolean } = {},
): Mounted {
  const host = document.createElement('div')
  // A page-like surface, so contrast is measured against what a real page would paint.
  host.style.cssText =
    'padding: 16px; background: var(--t-color-surface-default); color: var(--t-color-text-default);'
  document.body.append(host)
  const disabled = state(initial.disabled ?? false)
  const presses: Recorded[] = []
  const own = contract.behavior ? BEHAVIOR_EVENT[contract.behavior] : undefined
  const dispose = r.mount(host, () =>
    component({
      props: {
        ...Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, constant(v)])),
        disabled,
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
    presses,
    dispose: () => (dispose(), host.remove()),
  }
}

/** The element a behavior's conformance runs against: the root, a trigger inside it, or a form control inside it. */
function subjectOf(root: HTMLElement, contract: Contract): HTMLElement {
  if (contract.behavior === 'disclosure')
    return root.querySelector<HTMLElement>('[class*="__trigger"]') ?? root
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
  else if (state === 'checked' || state === 'expanded') await userEvent.click(subject)
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

/** The conformance suite of a behavior, and the text for it in a failing run. */
const SUITES = {
  press: { cases: pressConformance, title: 'press behavior conformance' },
  toggle: { cases: toggleConformance, title: 'toggle behavior conformance' },
  disclosure: { cases: disclosureConformance, title: 'disclosure behavior conformance' },
} as const

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
    describe(`${contract.name} accessibility`, () => {
      for (const theme of themes) {
        const themeName = theme ?? 'default theme'
        describe(themeName, () => {
          for (const state of statesFor(contract)) {
            for (const variants of variantCombinations(contract)) {
              it(`has no axe violations: ${label(variants)}, ${state}`, async () => {
                setTheme(theme)
                const m = mount(component, contract, variants)
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
        const m = mount(component, contract, {})
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

      const suite = contract.behavior ? SUITES[contract.behavior as keyof typeof SUITES] : undefined
      if (suite) {
        it('shows a visible focus indicator when reached with the keyboard', async () => {
          const m = mount(component, contract, {})
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

        describe(suite.title, () => {
          for (const testCase of suite.cases as ReadonlyArray<{
            name: string
            run(h: PressHarness): Promise<void>
          }>) {
            it(testCase.name, async () => {
              const m = mount(component, contract, {})
              const subject = subjectOf(m.root, contract)
              try {
                const harness = domHarness(subject, userEvent, {
                  presses: m.presses,
                  setDisabled: async (disabled) => {
                    m.disabled.value = disabled
                    flush()
                  },
                  ...(contract.behavior === 'disclosure'
                    ? { content: m.root.querySelector<HTMLElement>('[class*="__content"]') }
                    : {}),
                })
                await testCase.run(harness)
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
