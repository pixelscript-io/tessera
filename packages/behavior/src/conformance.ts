/**
 * Conformance tests for behaviors: keyboard, pointer, disabled and ARIA expectations written once, run
 * against any element or component that uses the behavior. They carry no test framework: each case is a
 * name and an async function that throws on failure, so a vitest suite (or anything else) can register them.
 */

/** What a case may do to the element under test. */
export interface PressHarness {
  readonly element: HTMLElement
  /** One entry per press the element has produced so far. */
  presses(): Array<{ source: string }>
  /** The role the element has, explicit or implied by its tag. */
  role(): string | undefined
  setDisabled(disabled: boolean): Promise<void>
  focus(): Promise<void>
  /** A real tab key press from the start of the page. */
  tab(): Promise<void>
  /** A real mouse click. */
  click(): Promise<void>
  /** A click event sent from code, which still reaches a disabled element's listeners if they exist. */
  dispatchClick(): Promise<void>
  keyDown(key: 'Enter' | 'Space' | 'a' | 'Escape'): Promise<void>
  keyUp(key: 'Enter' | 'Space' | 'a' | 'Escape'): Promise<void>
  pointerDown(): Promise<void>
  pointerUp(): Promise<void>
}

export interface ConformanceCase<H> {
  name: string
  run(harness: H): Promise<void>
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const state = (h: PressHarness) => h.element.getAttribute('data-state')

export const pressConformance: ConformanceCase<PressHarness>[] = [
  {
    name: 'a click presses once, from the pointer',
    async run(h) {
      await h.click()
      assert(h.presses().length === 1, `expected 1 press after a click, got ${h.presses().length}`)
      assert(
        h.presses()[0]!.source === 'pointer',
        `expected source "pointer", got "${h.presses()[0]!.source}"`,
      )
    },
  },
  {
    name: 'a click sent from code presses once, as virtual',
    async run(h) {
      await h.dispatchClick()
      assert(h.presses().length === 1, `expected 1 press, got ${h.presses().length}`)
      assert(
        h.presses()[0]!.source === 'virtual',
        `expected source "virtual", got "${h.presses()[0]!.source}"`,
      )
    },
  },
  {
    name: 'Enter presses once, on keydown, from the keyboard',
    async run(h) {
      await h.focus()
      await h.keyDown('Enter')
      assert(
        h.presses().length === 1,
        `expected 1 press when Enter goes down, got ${h.presses().length}`,
      )
      await h.keyUp('Enter')
      assert(
        h.presses().length === 1,
        `Enter pressed again on keyup: ${h.presses().length} presses`,
      )
      assert(
        h.presses()[0]!.source === 'keyboard',
        `expected source "keyboard", got "${h.presses()[0]!.source}"`,
      )
    },
  },
  {
    name: 'Space presses once, on keyup, from the keyboard',
    async run(h) {
      await h.focus()
      await h.keyDown('Space')
      assert(
        h.presses().length === 0,
        `Space pressed on keydown (${h.presses().length} presses); it should wait for keyup`,
      )
      await h.keyUp('Space')
      assert(
        h.presses().length === 1,
        `expected 1 press after Space is released, got ${h.presses().length}`,
      )
      assert(
        h.presses()[0]!.source === 'keyboard',
        `expected source "keyboard", got "${h.presses()[0]!.source}"`,
      )
    },
  },
  {
    name: 'other keys do not press',
    async run(h) {
      await h.focus()
      await h.keyDown('a')
      await h.keyUp('a')
      await h.keyDown('Escape')
      await h.keyUp('Escape')
      assert(
        h.presses().length === 0,
        `expected no presses for other keys, got ${h.presses().length}`,
      )
    },
  },
  {
    name: 'shows data-state="pressed" while Space is held, and clears it on release',
    async run(h) {
      await h.focus()
      assert(state(h) === null, `expected no data-state at rest, got "${state(h)}"`)
      await h.keyDown('Space')
      assert(state(h) === 'pressed', `expected data-state="pressed" while held, got "${state(h)}"`)
      await h.keyUp('Space')
      assert(state(h) === null, `expected data-state cleared on release, got "${state(h)}"`)
    },
  },
  {
    name: 'shows data-state="pressed" while the pointer is down',
    async run(h) {
      await h.pointerDown()
      assert(
        state(h) === 'pressed',
        `expected data-state="pressed" while the pointer is down, got "${state(h)}"`,
      )
      await h.pointerUp()
      assert(
        state(h) === null,
        `expected data-state cleared after the pointer is released, got "${state(h)}"`,
      )
    },
  },
  {
    name: 'can be reached with the Tab key',
    async run(h) {
      await h.tab()
      assert(document.activeElement === h.element, 'Tab did not move focus to the element')
    },
  },
  {
    name: 'does nothing while disabled',
    async run(h) {
      await h.setDisabled(true)
      await h.dispatchClick()
      await h.focus()
      await h.keyDown('Enter')
      await h.keyUp('Enter')
      await h.keyDown('Space')
      await h.keyUp('Space')
      assert(h.presses().length === 0, `a disabled element pressed ${h.presses().length} times`)
      assert(state(h) === null, `a disabled element showed data-state="${state(h)}"`)
    },
  },
  {
    name: 'presses again after being enabled',
    async run(h) {
      await h.setDisabled(true)
      await h.setDisabled(false)
      await h.click()
      assert(
        h.presses().length === 1,
        `expected a press after re-enabling, got ${h.presses().length}`,
      )
    },
  },
]

/** What a driver must be able to do. `@vitest/browser`'s `userEvent` satisfies it directly. */
export interface Driver {
  click(element: Element): Promise<void>
  keyboard(sequence: string): Promise<void>
  tab(options?: { shift?: boolean }): Promise<void>
}

const KEYS = { Enter: '{Enter', Space: '[Space', a: '{a', Escape: '{Escape' } as const
const CLOSE = { Enter: '}', Space: ']', a: '}', Escape: '}' } as const

const IMPLICIT_ROLES: Record<string, string> = { button: 'button', summary: 'button', a: 'link' }

/**
 * A harness over a real element in a real browser. `presses` is the array the element's press handler
 * pushes into; `setDisabled` is how the component under test is disabled (native `disabled`, or `aria-disabled`).
 */
export function domHarness(
  element: HTMLElement,
  driver: Driver,
  options: {
    presses: Array<{ source: string }>
    setDisabled(disabled: boolean): Promise<void> | void
  },
): PressHarness {
  return {
    element,
    presses: () => options.presses,
    role: () => element.getAttribute('role') ?? IMPLICIT_ROLES[element.tagName.toLowerCase()],
    async setDisabled(disabled) {
      await options.setDisabled(disabled)
    },
    async focus() {
      element.focus()
    },
    async tab() {
      ;(document.activeElement as HTMLElement | null)?.blur()
      await driver.tab()
    },
    click: () => driver.click(element),
    async dispatchClick() {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    keyDown: (key) => driver.keyboard(`${KEYS[key]}>${CLOSE[key]}`),
    keyUp: (key) =>
      driver.keyboard(`${KEYS[key].replace('{', '{/').replace('[', '[/')}${CLOSE[key]}`),
    async pointerDown() {
      const box = element.getBoundingClientRect()
      const init = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: box.x + 2,
        clientY: box.y + 2,
        pointerId: 1,
      }
      element.dispatchEvent(new PointerEvent('pointerdown', init))
    },
    async pointerUp() {
      element.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }),
      )
    },
  }
}
