import type { ConformanceCase, Driver } from './conformance'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** What a case may do to a radio group under test. */
export interface RadioGroupHarness {
  readonly group: HTMLElement
  radios(): HTMLElement[]
  /** The position of the radio that is checked, or -1. */
  checked(): number
  /** One entry per `choose` the group has reported. */
  choices(): Array<{ value: string; source: string }>
  setDisabled(index: number, disabled: boolean): Promise<void>
  /** Focus a radio as a person would arrive at it. */
  focus(index: number): Promise<void>
  press(key: 'ArrowRight' | 'ArrowLeft' | 'ArrowDown' | 'ArrowUp' | 'Space'): Promise<void>
  click(index: number): Promise<void>
  /** A real tab key press from where focus is. */
  tab(): Promise<void>
}

const focused = (h: RadioGroupHarness) => h.radios().indexOf(document.activeElement as HTMLElement)

/**
 * Conformance for `radio-group`. The component under test checks what it is told to choose, as a real one does, so each
 * case that chooses also checks that the checked radio and the focus followed. The group has at least three radios.
 */
export const radioGroupConformance: ConformanceCase<RadioGroupHarness>[] = [
  {
    name: 'is a radio group of radios, with exactly one checked',
    async run(h) {
      assert(
        h.group.getAttribute('role') === 'radiogroup',
        'the group does not have role="radiogroup"',
      )
      assert(h.radios().length >= 3, 'the case needs at least three radios')
      for (const radio of h.radios())
        assert(radio.getAttribute('role') === 'radio', 'a radio does not have role="radio"')
      const checked = h.radios().filter((r) => r.getAttribute('aria-checked') === 'true')
      assert(checked.length === 1, `expected 1 checked radio, got ${checked.length}`)
    },
  },
  {
    name: 'only the checked radio is in the tab order',
    async run(h) {
      h.radios().forEach((radio, i) => {
        const expected = i === h.checked() ? 0 : -1
        assert(
          radio.tabIndex === expected,
          `radio ${i} has tabindex ${radio.tabIndex}, expected ${expected}: Tab would stop on every radio`,
        )
      })
    },
  },
  {
    name: 'Arrow Right and Arrow Down choose and focus the next radio, and wrap at the end',
    async run(h) {
      await h.focus(0)
      await h.press('ArrowRight')
      assert(h.checked() === 1 && focused(h) === 1, 'Arrow Right did not move to the second radio')
      await h.press('ArrowDown')
      assert(h.checked() === 2, 'Arrow Down did not move to the third radio')
      for (let i = 2; i < h.radios().length; i++) await h.press('ArrowRight')
      assert(
        h.checked() === 0 && focused(h) === 0,
        'the arrow keys did not wrap to the first radio',
      )
      assert(
        h.choices().every((c) => c.source === 'keyboard'),
        'a key choice was not "keyboard"',
      )
    },
  },
  {
    name: 'Arrow Left and Arrow Up choose and focus the previous radio, and wrap at the start',
    async run(h) {
      const last = h.radios().length - 1
      await h.focus(0)
      await h.press('ArrowLeft')
      assert(
        h.checked() === last && focused(h) === last,
        'Arrow Left did not wrap to the last radio',
      )
      await h.press('ArrowUp')
      assert(h.checked() === last - 1, 'Arrow Up did not move to the previous radio')
    },
  },
  {
    name: 'Space chooses the focused radio',
    async run(h) {
      await h.focus(2)
      assert(h.checked() === 0, 'focus alone changed the choice')
      await h.press('Space')
      assert(h.checked() === 2, 'Space did not choose the focused radio')
    },
  },
  {
    name: 'skips a disabled radio',
    async run(h) {
      await h.setDisabled(1, true)
      await h.focus(0)
      await h.press('ArrowRight')
      assert(h.checked() === 2, `a disabled radio was chosen: radio ${h.checked()} is checked`)
      await h.click(1)
      assert(h.checked() === 2, 'a click on a disabled radio chose it')
    },
  },
  {
    name: 'a click chooses the radio as a pointer choice',
    async run(h) {
      await h.click(2)
      assert(h.checked() === 2, 'a click did not choose the radio')
      const last = h.choices()[h.choices().length - 1]
      assert(last?.source === 'pointer', `expected source "pointer", got "${last?.source}"`)
    },
  },
  {
    name: 'reports the value of the radio it chooses',
    async run(h) {
      await h.click(1)
      const radio = h.radios()[1]!
      assert(
        h.choices()[0]?.value === (radio.dataset.value ?? radio.id),
        `the choice carried "${h.choices()[0]?.value}"`,
      )
    },
  },
  {
    name: 'Tab leaves the group instead of stepping through every radio',
    async run(h) {
      await h.focus(h.checked())
      await h.tab()
      assert(
        !h.group.contains(document.activeElement),
        'Tab moved to another radio; it should leave the group',
      )
    },
  },
]

/** A harness over a real radio group in a real browser. */
export function domRadioGroupHarness(
  group: HTMLElement,
  driver: Driver,
  options: {
    choices: Array<{ value: string; source: string }>
    setDisabled(index: number, disabled: boolean): Promise<void> | void
  },
): RadioGroupHarness {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  const radios = () => [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
  return {
    group,
    radios,
    checked: () => radios().findIndex((r) => r.getAttribute('aria-checked') === 'true'),
    choices: () => options.choices,
    async setDisabled(index, disabled) {
      await options.setDisabled(index, disabled)
      await settle()
    },
    async focus(index) {
      radios()[index]!.focus()
      await settle()
    },
    async press(key) {
      await driver.keyboard(key === 'Space' ? '[Space]' : `{${key}}`)
      await settle()
    },
    async click(index) {
      const radio = radios()[index]!
      // A real click cannot reach a disabled radio, so send one from code: the behavior must still ignore it.
      if (radio.hasAttribute('disabled') || radio.getAttribute('aria-disabled') === 'true')
        radio.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      else await driver.click(radio)
      await settle()
    },
    async tab() {
      await driver.tab()
      await settle()
    },
  }
}
