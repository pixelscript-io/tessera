/**
 * Conformance tests for behaviors: keyboard, pointer, disabled and ARIA expectations written once, run
 * against any element or component that uses the behavior. They carry no test framework: each case is a
 * name and an async function that throws on failure, so a vitest suite (or anything else) can register them.
 */

/** What a case may do to the element under test. */
export interface PressHarness {
  readonly element: HTMLElement
  /** One entry per press (or toggle, or expand) the element has produced so far. */
  presses(): Array<{ source: string; checked?: boolean; expanded?: boolean }>
  /** For a disclosure: whether the region the trigger controls can be seen. */
  contentVisible?(): boolean
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

// --- toggle -----------------------------------------------------------------------------------------------------

const checkedAttribute = (h: PressHarness) =>
  h.role() === 'button' ? 'aria-pressed' : 'aria-checked'
const checkedOf = (h: PressHarness) => h.element.getAttribute(checkedAttribute(h))

/**
 * Conformance for `toggle`: a checkbox, a switch or a toggle button. The element under test must reflect the state in
 * `aria-checked` (`aria-pressed` for a toggle button) when it gets the event, the way a component does.
 */
export const toggleConformance: ConformanceCase<PressHarness>[] = [
  {
    name: 'has a state from the start, so it always has a value to announce',
    async run(h) {
      assert(
        checkedOf(h) === 'false' || checkedOf(h) === 'true',
        `expected ${checkedAttribute(h)} to be "true" or "false" at rest, got ${JSON.stringify(checkedOf(h))}`,
      )
    },
  },
  {
    name: 'a click turns it on, and the next click turns it off',
    async run(h) {
      const start = checkedOf(h) === 'true'
      await h.click()
      assert(h.presses().length === 1, `expected 1 toggle after a click, got ${h.presses().length}`)
      assert(
        h.presses()[0]!.checked === !start,
        `expected the event to say checked=${!start}, got ${h.presses()[0]!.checked}`,
      )
      assert(
        checkedOf(h) === String(!start),
        `expected ${checkedAttribute(h)}="${!start}" after the click, got ${JSON.stringify(checkedOf(h))}`,
      )
      await h.click()
      assert(
        h.presses().length === 2,
        `expected 2 toggles after two clicks, got ${h.presses().length}`,
      )
      assert(
        checkedOf(h) === String(start),
        `expected it back to ${start}, got ${JSON.stringify(checkedOf(h))}`,
      )
    },
  },
  {
    name: 'a click sent from code toggles once, as virtual',
    async run(h) {
      await h.dispatchClick()
      assert(h.presses().length === 1, `expected 1 toggle, got ${h.presses().length}`)
      assert(
        h.presses()[0]!.source === 'virtual',
        `expected source "virtual", got "${h.presses()[0]!.source}"`,
      )
    },
  },
  {
    name: 'Space toggles once, on keyup',
    async run(h) {
      await h.focus()
      await h.keyDown('Space')
      assert(
        h.presses().length === 0,
        `Space toggled on keydown (${h.presses().length}); it should wait for keyup`,
      )
      await h.keyUp('Space')
      assert(h.presses().length === 1, `expected 1 toggle after Space, got ${h.presses().length}`)
      assert(
        h.presses()[0]!.source === 'keyboard',
        `expected source "keyboard", got "${h.presses()[0]!.source}"`,
      )
    },
  },
  {
    name: 'Enter toggles a switch or a toggle button once, and does nothing on a checkbox',
    async run(h) {
      await h.focus()
      await h.keyDown('Enter')
      await h.keyUp('Enter')
      const expected = h.role() === 'checkbox' ? 0 : 1
      assert(
        h.presses().length === expected,
        `expected ${expected} toggle for Enter on a ${h.role()}, got ${h.presses().length}`,
      )
    },
  },
  {
    name: 'other keys do not toggle',
    async run(h) {
      await h.focus()
      await h.keyDown('a')
      await h.keyUp('a')
      await h.keyDown('Escape')
      await h.keyUp('Escape')
      assert(
        h.presses().length === 0,
        `expected no toggles for other keys, got ${h.presses().length}`,
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
      assert(h.presses().length === 0, `a disabled element toggled ${h.presses().length} times`)
    },
  },
]

// --- disclosure -------------------------------------------------------------------------------------------------

/**
 * Conformance for `disclosure`, run against the trigger. The harness needs `content`, the region it shows and hides.
 */
export const disclosureConformance: ConformanceCase<PressHarness>[] = [
  {
    name: 'starts collapsed: aria-expanded is false and the content is hidden',
    async run(h) {
      assert(
        h.element.getAttribute('aria-expanded') === 'false',
        `expected aria-expanded="false" at rest, got ${JSON.stringify(h.element.getAttribute('aria-expanded'))}`,
      )
      assert(h.contentVisible?.() === false, 'the content is visible while collapsed')
    },
  },
  {
    name: 'a click expands it, and the next click collapses it',
    async run(h) {
      await h.click()
      assert(h.presses().length === 1, `expected 1 expand event, got ${h.presses().length}`)
      assert(h.presses()[0]!.expanded === true, 'the first event should say expanded=true')
      assert(
        h.element.getAttribute('aria-expanded') === 'true',
        'aria-expanded did not become "true"',
      )
      assert(h.contentVisible?.() === true, 'the content is hidden while expanded')
      await h.click()
      assert(h.presses()[1]?.expanded === false, 'the second event should say expanded=false')
      assert(
        h.element.getAttribute('aria-expanded') === 'false',
        'aria-expanded did not go back to "false"',
      )
      assert(h.contentVisible?.() === false, 'the content is visible after collapsing')
    },
  },
  {
    name: 'Enter expands once, on keydown',
    async run(h) {
      await h.focus()
      await h.keyDown('Enter')
      assert(
        h.presses().length === 1,
        `expected 1 event when Enter goes down, got ${h.presses().length}`,
      )
      await h.keyUp('Enter')
      assert(h.presses().length === 1, `Enter fired again on keyup: ${h.presses().length}`)
    },
  },
  {
    name: 'Space expands once, on keyup',
    async run(h) {
      await h.focus()
      await h.keyDown('Space')
      assert(h.presses().length === 0, 'Space fired on keydown; it should wait for keyup')
      await h.keyUp('Space')
      assert(h.presses().length === 1, `expected 1 event after Space, got ${h.presses().length}`)
    },
  },
  {
    name: 'other keys do nothing',
    async run(h) {
      await h.focus()
      await h.keyDown('a')
      await h.keyUp('a')
      assert(
        h.presses().length === 0,
        `expected no events for other keys, got ${h.presses().length}`,
      )
    },
  },
  {
    name: 'can be reached with the Tab key',
    async run(h) {
      await h.tab()
      assert(document.activeElement === h.element, 'Tab did not move focus to the trigger')
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
      assert(h.presses().length === 0, `a disabled trigger fired ${h.presses().length} times`)
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
    presses: Array<{ source: string; checked?: boolean; expanded?: boolean }>
    setDisabled(disabled: boolean): Promise<void> | void
    /** For a disclosure: the region the trigger shows and hides. */
    content?: HTMLElement | null
  },
): PressHarness {
  return {
    element,
    presses: () => options.presses,
    ...(options.content !== undefined
      ? {
          contentVisible: () => {
            const content = options.content
            return !!content && !content.hidden && getComputedStyle(content).display !== 'none'
          },
        }
      : {}),
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
