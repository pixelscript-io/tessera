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

// --- dialog -----------------------------------------------------------------------------------------------------

/** What a case may do to a dialog, and see of it. */
export interface DialogHarness {
  readonly dialog: HTMLDialogElement
  /** The element that has focus before the dialog opens, and should have it back after. */
  readonly opener: HTMLElement
  /** Open or close it the way its owner does: by the state the component binds. */
  setOpen(open: boolean): Promise<void>
  /** One entry per `dismiss` the dialog has reported. */
  dismissals(): Array<{ reason: string }>
  /** A key sent to whatever has focus, such as `Escape`. */
  press(key: 'Escape'): Promise<void>
  /** Tab, or Shift+Tab with `back`, from where focus is. */
  tab(back?: boolean): Promise<void>
  /** A click on the dimmed page around the dialog. */
  clickBackdrop(): Promise<void>
  /** A real click on the dialog's own content. */
  clickPanel(): Promise<void>
}

const pageLocked = () => getComputedStyle(document.documentElement).overflow === 'hidden'

/**
 * Conformance for `dialog`. The component under test closes when it is told to dismiss, as a real one does, so each
 * case that dismisses also checks that the dialog followed.
 */
export const dialogConformance: ConformanceCase<DialogHarness>[] = [
  {
    name: 'is closed until it is opened',
    async run(h) {
      assert(!h.dialog.open, 'the dialog is open before it was asked to open')
      assert(!pageLocked(), 'the page is locked while the dialog is closed')
    },
  },
  {
    name: 'opens as a modal dialog, with focus inside it',
    async run(h) {
      h.opener.focus()
      await h.setOpen(true)
      assert(h.dialog.open, 'the dialog did not open')
      assert(
        h.dialog.matches(':modal'),
        'the dialog is open but not modal: the page behind it is still reachable',
      )
      assert(h.dialog.contains(document.activeElement), 'focus did not move into the dialog')
    },
  },
  {
    name: 'has an accessible name',
    async run(h) {
      await h.setOpen(true)
      const labelled = h.dialog.getAttribute('aria-labelledby')
      const text = labelled
        ? labelled
            .split(' ')
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .join(' ')
            .trim()
        : (h.dialog.getAttribute('aria-label') ?? '').trim()
      assert(
        text.length > 0,
        'the dialog has no name: aria-labelledby points at nothing, or aria-label is empty',
      )
    },
  },
  {
    name: 'Escape asks to dismiss, and the dialog closes when its owner lets it',
    async run(h) {
      await h.setOpen(true)
      await h.press('Escape')
      assert(h.dismissals().length === 1, `expected 1 dismissal, got ${h.dismissals().length}`)
      assert(
        h.dismissals()[0]!.reason === 'escape',
        `expected reason "escape", got "${h.dismissals()[0]!.reason}"`,
      )
      assert(!h.dialog.open, 'the dialog did not close after it was dismissed')
    },
  },
  {
    name: 'a click on the backdrop dismisses it, and a click inside does not',
    async run(h) {
      await h.setOpen(true)
      await h.clickPanel()
      assert(h.dismissals().length === 0, 'a click inside the dialog dismissed it')
      assert(h.dialog.open, 'a click inside the dialog closed it')
      await h.clickBackdrop()
      assert(h.dismissals().length === 1, `expected 1 dismissal, got ${h.dismissals().length}`)
      assert(
        h.dismissals()[0]!.reason === 'backdrop',
        `expected reason "backdrop", got "${h.dismissals()[0]!.reason}"`,
      )
      assert(!h.dialog.open, 'the dialog did not close after the backdrop click')
    },
  },
  {
    name: 'locks the page from scrolling while open, and unlocks it on close',
    async run(h) {
      await h.setOpen(true)
      assert(pageLocked(), 'the page can still scroll behind the open dialog')
      await h.setOpen(false)
      assert(!pageLocked(), 'the page is still locked after the dialog closed')
    },
  },
  {
    name: 'keeps focus inside while open, going either way with Tab',
    async run(h) {
      await h.setOpen(true)
      for (let i = 0; i < 4; i++) {
        await h.tab()
        assert(
          h.dialog.contains(document.activeElement),
          `focus left the dialog after ${i + 1} Tab presses`,
        )
      }
      for (let i = 0; i < 4; i++) {
        await h.tab(true)
        assert(
          h.dialog.contains(document.activeElement),
          `focus left the dialog after ${i + 1} Shift+Tab presses`,
        )
      }
    },
  },
  {
    name: 'returns focus to what opened it',
    async run(h) {
      h.opener.focus()
      await h.setOpen(true)
      await h.setOpen(false)
      assert(
        document.activeElement === h.opener,
        `focus did not return to the opener; it is on ${document.activeElement?.tagName.toLowerCase() ?? 'nothing'}`,
      )
    },
  },
  {
    name: 'opens and closes again and again without leaving the page locked',
    async run(h) {
      for (let i = 0; i < 3; i++) {
        await h.setOpen(true)
        await h.setOpen(false)
      }
      assert(!pageLocked(), 'the page stayed locked after three open and close cycles')
      assert(!h.dialog.open, 'the dialog is open after the last close')
    },
  },
]

// --- combobox ---------------------------------------------------------------------------------------------------

/** What a case may do to an editable combobox with a listbox popup, and see of it. */
export interface ComboboxHarness {
  readonly input: HTMLInputElement
  /** The popup, if it is in the page. */
  listbox(): HTMLElement | null
  /** The options that can be chosen right now. */
  options(): HTMLElement[]
  /** Every option's label when nothing is typed: what a typed filter is matched against. */
  readonly labels: readonly string[]
  /** One entry per choice the combobox has reported, with the label it showed. */
  selections(): Array<{ label?: string }>
  setDisabled(disabled: boolean): Promise<void>
  focus(): Promise<void>
  /** Characters typed into the field, as a person types. */
  type(text: string): Promise<void>
  press(key: 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Escape'): Promise<void>
  tab(): Promise<void>
  clickOption(index: number): Promise<void>
}

const expanded = (h: ComboboxHarness) => h.input.getAttribute('aria-expanded') === 'true'
const active = (h: ComboboxHarness) => h.input.getAttribute('aria-activedescendant')
const listVisible = (h: ComboboxHarness) => {
  const box = h.listbox()
  return !!box && !box.hidden && getComputedStyle(box).display !== 'none'
}

/**
 * Conformance for `combobox`: an editable combobox with a listbox popup (ARIA 1.2). It needs at least three options
 * that share a letter in their labels, and a typed filter that keeps the options whose label contains what was typed.
 */
export const comboboxConformance: ConformanceCase<ComboboxHarness>[] = [
  {
    name: 'has the combobox pattern at rest: role, closed, a list to control',
    async run(h) {
      assert(h.input.getAttribute('role') === 'combobox', 'the input does not have role="combobox"')
      assert(!expanded(h), 'the combobox starts open')
      assert(
        h.input.getAttribute('aria-autocomplete') === 'list',
        'aria-autocomplete should be "list"',
      )
      const controls = h.input.getAttribute('aria-controls')
      assert(
        !!controls && document.getElementById(controls)?.getAttribute('role') === 'listbox',
        'aria-controls must name an element with role="listbox"',
      )
      assert(!listVisible(h), 'the list is visible while the combobox is closed')
    },
  },
  {
    name: 'Arrow Down opens the list and makes the first option active',
    async run(h) {
      await h.focus()
      await h.press('ArrowDown')
      assert(expanded(h), 'aria-expanded did not become "true"')
      assert(listVisible(h), 'the list is not visible')
      const options = h.options()
      assert(options.length > 0, 'the list has no options')
      assert(
        options.every((o) => o.getAttribute('role') === 'option'),
        'every option needs role="option"',
      )
      assert(
        active(h) === options[0]!.id && options[0]!.id !== '',
        `aria-activedescendant should name the first option, got ${JSON.stringify(active(h))}`,
      )
      assert(document.activeElement === h.input, 'focus left the input; it should stay on it')
    },
  },
  {
    name: 'Arrow Down and Arrow Up move the active option',
    async run(h) {
      await h.focus()
      await h.press('ArrowDown')
      await h.press('ArrowDown')
      assert(active(h) === h.options()[1]!.id, 'Arrow Down did not move to the second option')
      await h.press('ArrowUp')
      assert(active(h) === h.options()[0]!.id, 'Arrow Up did not move back to the first option')
    },
  },
  {
    name: 'Arrow Up while closed opens the list on the last option',
    async run(h) {
      await h.focus()
      await h.press('ArrowUp')
      assert(expanded(h), 'the list did not open')
      const options = h.options()
      assert(
        active(h) === options[options.length - 1]!.id,
        'the last option should be active after Arrow Up',
      )
    },
  },
  {
    name: 'Enter chooses the active option and closes the list',
    async run(h) {
      await h.focus()
      await h.press('ArrowDown')
      const label = h.options()[0]!.textContent!.trim()
      await h.press('Enter')
      assert(h.selections().length === 1, `expected 1 choice, got ${h.selections().length}`)
      assert(h.selections()[0]!.label === label, `expected the choice to be "${label}"`)
      assert(!expanded(h), 'the list stayed open after a choice')
      assert(h.input.value === label, `the field should show "${label}", shows "${h.input.value}"`)
    },
  },
  {
    name: 'Enter with no active option chooses nothing',
    async run(h) {
      await h.focus()
      await h.press('Enter')
      assert(h.selections().length === 0, 'Enter chose something with nothing active')
    },
  },
  {
    name: 'Escape closes the list and keeps what was typed',
    async run(h) {
      await h.focus()
      await h.type(h.labels[0]!.slice(0, 2).toLowerCase())
      await h.press('ArrowDown')
      await h.press('Escape')
      assert(!expanded(h), 'the list stayed open after Escape')
      assert(
        h.input.value === h.labels[0]!.slice(0, 2).toLowerCase(),
        `Escape changed the text to "${h.input.value}"`,
      )
    },
  },
  {
    name: 'typing opens the list and keeps only the options that match',
    async run(h) {
      await h.focus()
      const typed = h.labels[0]!.slice(0, 2).toLowerCase()
      await h.type(typed)
      assert(expanded(h), 'typing did not open the list')
      const expected = h.labels.filter((l) => l.toLowerCase().includes(typed))
      assert(
        h.options().length === expected.length,
        `expected ${expected.length} options for "${typed}", got ${h.options().length}`,
      )
    },
  },
  {
    name: 'with nothing matching, there is nothing to choose',
    async run(h) {
      await h.focus()
      await h.type('zzzzqx')
      await h.press('ArrowDown')
      await h.press('Enter')
      assert(h.options().length === 0, 'options are shown for text that matches none')
      assert(h.selections().length === 0, 'something was chosen from an empty list')
      assert(!active(h), 'an option is active in an empty list')
    },
  },
  {
    name: 'a click on an option chooses it',
    async run(h) {
      await h.focus()
      await h.press('ArrowDown')
      const label = h.options()[1]!.textContent!.trim()
      await h.clickOption(1)
      assert(h.selections().length === 1, `expected 1 choice, got ${h.selections().length}`)
      assert(h.selections()[0]!.label === label, `expected the choice to be "${label}"`)
      assert(!expanded(h), 'the list stayed open after a click')
    },
  },
  {
    name: 'Tab closes the list and moves on',
    async run(h) {
      await h.focus()
      await h.press('ArrowDown')
      await h.tab()
      assert(!expanded(h), 'the list stayed open after Tab')
      assert(document.activeElement !== h.input, 'Tab did not leave the field')
    },
  },
  {
    name: 'does nothing while disabled',
    async run(h) {
      await h.setDisabled(true)
      h.input.focus()
      await h.press('ArrowDown')
      assert(!expanded(h), 'a disabled combobox opened')
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

/** A harness over a real `<dialog>` in a real browser. */
export function domDialogHarness(
  dialog: HTMLDialogElement,
  opener: HTMLElement,
  driver: Driver,
  options: {
    dismissals: Array<{ reason: string }>
    setOpen(open: boolean): Promise<void> | void
  },
): DialogHarness {
  return {
    dialog,
    opener,
    async setOpen(open) {
      await options.setOpen(open)
      // The behavior follows the attribute in a microtask; give it, and the browser's focus move, a turn.
      await new Promise((resolve) => setTimeout(resolve, 30))
    },
    dismissals: () => options.dismissals,
    press: (key) => driver.keyboard(`{${key}}`),
    async tab(back = false) {
      await driver.tab(back ? { shift: true } : undefined)
    },
    async clickBackdrop() {
      const box = dialog.getBoundingClientRect()
      // A click on the ::backdrop is delivered to the dialog itself, at a point outside its box.
      dialog.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: Math.max(1, box.left - 20),
          clientY: Math.max(1, box.top - 20),
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
    },
    async clickPanel() {
      await driver.click((dialog.firstElementChild as Element | null) ?? dialog)
      await new Promise((resolve) => setTimeout(resolve, 30))
    },
  }
}

/** A harness over a real combobox in a real browser. */
export function domComboboxHarness(
  input: HTMLInputElement,
  driver: Driver,
  options: {
    listbox(): HTMLElement | null
    options(): HTMLElement[]
    labels: readonly string[]
    selections: Array<{ label?: string }>
    setDisabled(disabled: boolean): Promise<void> | void
  },
): ComboboxHarness {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  return {
    input,
    listbox: options.listbox,
    options: options.options,
    labels: options.labels,
    selections: () => options.selections,
    async setDisabled(disabled) {
      await options.setDisabled(disabled)
    },
    async focus() {
      input.focus()
    },
    async type(text) {
      await driver.keyboard(text)
      await settle()
    },
    async press(key) {
      await driver.keyboard(`{${key}}`)
      await settle()
    },
    async tab() {
      await driver.tab()
      await settle()
    },
    async clickOption(index) {
      await driver.click(options.options()[index]!)
      await settle()
    },
  }
}
