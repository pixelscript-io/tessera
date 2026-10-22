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
import { domHarness, pressConformance } from '@tessera/behavior/conformance'
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

export type State = 'rest' | 'hover' | 'focus-visible' | 'pressed' | 'disabled'

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
  const supported: State[] = ['hover', 'focus-visible', 'pressed', 'disabled']
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

interface Mounted {
  host: HTMLElement
  root: HTMLElement
  disabled: ReturnType<typeof state<boolean>>
  presses: Array<{ source: string }>
  dispose(): void
}

function mount(
  component: Component,
  variants: Record<string, string>,
  initial: { disabled?: boolean } = {},
): Mounted {
  const host = document.createElement('div')
  // A page-like surface, so contrast is measured against what a real page would paint.
  host.style.cssText =
    'padding: 16px; background: var(--t-color-surface-default); color: var(--t-color-text-default);'
  document.body.append(host)
  const disabled = state(initial.disabled ?? false)
  const presses: Array<{ source: string }> = []
  const dispose = r.mount(host, () =>
    component({
      props: {
        ...Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, constant(v)])),
        disabled,
      },
      events: {
        press: (detail) =>
          presses.push({
            source: (detail as { source?: string } | undefined)?.source ?? 'unknown',
          }),
      },
      slots: { default: () => ['Label'] },
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

async function settle(root: HTMLElement): Promise<void> {
  flush()
  // Colors are measured after any transition finishes, not partway through.
  await Promise.all(root.getAnimations().map((a) => a.finished.catch(() => undefined)))
}

async function enter(state: State, m: Mounted): Promise<void> {
  if (state === 'disabled') m.disabled.value = true
  else if (state === 'pressed') m.root.setAttribute('data-state', 'pressed')
  else if (state === 'hover') await userEvent.hover(m.root)
  else if (state === 'focus-visible') await userEvent.tab()
  await settle(m.root)
}

async function leave(state: State, m: Mounted): Promise<void> {
  if (state === 'hover') await userEvent.unhover(m.root)
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
                const m = mount(component, variants)
                try {
                  await enter(state, m)
                  expect(await runAxe(m.host)).toEqual([])
                } finally {
                  await leave(state, m)
                  m.dispose()
                }
              })
            }
          }
        })
      }

      it(`has the ${contract.role} role its contract declares`, () => {
        const m = mount(component, {})
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
          const m = mount(component, {}, { disabled: true })
          try {
            flush()
            const disabled =
              m.root.hasAttribute('disabled') || m.root.getAttribute('aria-disabled') === 'true'
            expect(
              disabled,
              'the root has neither disabled nor aria-disabled="true" when disabled',
            ).toBe(true)
          } finally {
            m.dispose()
          }
        })
      }

      if (contract.behavior === 'press') {
        it('shows a visible focus indicator when reached with the keyboard', async () => {
          const m = mount(component, {})
          try {
            await userEvent.tab()
            expect(document.activeElement).toBe(m.root)
            const style = getComputedStyle(m.root)
            expect(
              style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
              'no outline on :focus-visible',
            ).toBe(true)
          } finally {
            await leave('rest', m)
            m.dispose()
          }
        })

        describe('press behavior conformance', () => {
          for (const testCase of pressConformance) {
            it(testCase.name, async () => {
              const m = mount(component, {})
              try {
                const harness = domHarness(m.root, userEvent, {
                  presses: m.presses,
                  setDisabled: async (disabled) => {
                    m.disabled.value = disabled
                    flush()
                  },
                })
                await testCase.run(harness)
              } finally {
                await leave('rest', m)
                m.dispose()
              }
            })
          }
        })
      }
    })
  }
}
