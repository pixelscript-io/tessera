import type { ConformanceCase, Driver } from './conformance'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** What a case may do to a tab list under test. */
export interface TabsHarness {
  readonly list: HTMLElement
  tabs(): HTMLElement[]
  panels(): HTMLElement[]
  /** The position of the tab that is selected, or -1. */
  selected(): number
  /** One entry per `activate` the list has reported. */
  activations(): Array<{ value: string; source: string }>
  setDisabled(index: number, disabled: boolean): Promise<void>
  /** Focus a tab as a person would arrive at it. */
  focus(index: number): Promise<void>
  press(key: 'ArrowRight' | 'ArrowLeft' | 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): Promise<void>
  click(index: number): Promise<void>
  /** A real tab key press from where focus is. */
  tab(): Promise<void>
}

const focusedTab = (h: TabsHarness) => h.tabs().indexOf(document.activeElement as HTMLElement)

/**
 * Conformance for `tabs`. The component under test selects what it is told to activate, as a real one does, so each case
 * that activates also checks that the selection and the focus followed. The list has at least three tabs.
 */
export const tabsConformance: ConformanceCase<TabsHarness>[] = [
  {
    name: 'is a tab list of tabs, with exactly one selected',
    async run(h) {
      assert(h.list.getAttribute('role') === 'tablist', 'the list does not have role="tablist"')
      assert(h.tabs().length >= 3, 'the case needs at least three tabs')
      for (const tab of h.tabs())
        assert(tab.getAttribute('role') === 'tab', 'a tab does not have role="tab"')
      const selected = h.tabs().filter((t) => t.getAttribute('aria-selected') === 'true')
      assert(selected.length === 1, `expected 1 selected tab, got ${selected.length}`)
    },
  },
  {
    name: 'only the selected tab is in the tab order',
    async run(h) {
      h.tabs().forEach((tab, i) => {
        const expected = i === h.selected() ? 0 : -1
        assert(
          tab.tabIndex === expected,
          `tab ${i} has tabindex ${tab.tabIndex}, expected ${expected}: Tab would stop on every tab`,
        )
      })
    },
  },
  {
    name: 'each tab controls a panel that it names, and only the selected panel is visible',
    async run(h) {
      h.tabs().forEach((tab, i) => {
        const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '')
        assert(panel, `tab ${i} has no aria-controls that points at a panel`)
        assert(
          panel.getAttribute('role') === 'tabpanel',
          `panel ${i} does not have role="tabpanel"`,
        )
        assert(
          !!tab.id && panel.getAttribute('aria-labelledby') === tab.id,
          `panel ${i} is not named by its tab`,
        )
        const visible = !panel.hidden
        assert(
          visible === (i === h.selected()),
          `panel ${i} is ${visible ? 'visible' : 'hidden'} but its tab is ${i === h.selected() ? '' : 'not '}selected`,
        )
      })
    },
  },
  {
    name: 'Arrow Right selects and focuses the next tab, and wraps at the end',
    async run(h) {
      await h.focus(0)
      await h.press('ArrowRight')
      assert(
        h.selected() === 1 && focusedTab(h) === 1,
        'Arrow Right did not move to the second tab',
      )
      for (let i = 1; i < h.tabs().length; i++) await h.press('ArrowRight')
      assert(h.selected() === 0 && focusedTab(h) === 0, 'Arrow Right did not wrap to the first tab')
      assert(
        h.activations().every((a) => a.source === 'keyboard'),
        'a key activation was not "keyboard"',
      )
    },
  },
  {
    name: 'Arrow Left selects and focuses the previous tab, and wraps at the start',
    async run(h) {
      const last = h.tabs().length - 1
      await h.focus(0)
      await h.press('ArrowLeft')
      assert(
        h.selected() === last && focusedTab(h) === last,
        'Arrow Left did not wrap to the last tab',
      )
      await h.press('ArrowLeft')
      assert(h.selected() === last - 1, 'Arrow Left did not move to the previous tab')
    },
  },
  {
    name: 'Home and End go to the first and last tab',
    async run(h) {
      await h.focus(0)
      await h.press('End')
      assert(h.selected() === h.tabs().length - 1, 'End did not select the last tab')
      await h.press('Home')
      assert(h.selected() === 0 && focusedTab(h) === 0, 'Home did not select the first tab')
    },
  },
  {
    name: 'a vertical list uses Arrow Down and Up instead',
    async run(h) {
      h.list.setAttribute('aria-orientation', 'vertical')
      await h.focus(0)
      await h.press('ArrowRight')
      assert(h.selected() === 0, 'Arrow Right moved a vertical list')
      await h.press('ArrowDown')
      assert(h.selected() === 1, 'Arrow Down did not move a vertical list')
      await h.press('ArrowUp')
      assert(h.selected() === 0, 'Arrow Up did not move a vertical list back')
    },
  },
  {
    name: 'skips a disabled tab',
    async run(h) {
      await h.setDisabled(1, true)
      await h.focus(0)
      await h.press('ArrowRight')
      assert(h.selected() === 2, `a disabled tab was selected: tab ${h.selected()} is selected`)
      await h.click(1)
      assert(h.selected() === 2, 'a click on a disabled tab selected it')
    },
  },
  {
    name: 'a click selects the tab as a pointer activation',
    async run(h) {
      await h.click(2)
      assert(h.selected() === 2, 'a click did not select the tab')
      const last = h.activations()[h.activations().length - 1]
      assert(last?.source === 'pointer', `expected source "pointer", got "${last?.source}"`)
    },
  },
  {
    name: 'reports the value of the tab it activates',
    async run(h) {
      await h.click(1)
      const tab = h.tabs()[1]!
      assert(
        h.activations()[0]?.value === (tab.dataset.value ?? tab.id),
        `the activation carried "${h.activations()[0]?.value}"`,
      )
    },
  },
  {
    name: 'Tab leaves the list instead of stepping through every tab',
    async run(h) {
      await h.focus(h.selected())
      await h.tab()
      assert(
        !h.list.contains(document.activeElement),
        'Tab moved to another tab; it should leave the list',
      )
    },
  },
]

/** A harness over a real tab list in a real browser. */
export function domTabsHarness(
  list: HTMLElement,
  driver: Driver,
  options: {
    panels(): HTMLElement[]
    activations: Array<{ value: string; source: string }>
    setDisabled(index: number, disabled: boolean): Promise<void> | void
  },
): TabsHarness {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  const tabs = () => [...list.querySelectorAll<HTMLElement>('[role="tab"]')]
  return {
    list,
    tabs,
    panels: options.panels,
    selected: () => tabs().findIndex((t) => t.getAttribute('aria-selected') === 'true'),
    activations: () => options.activations,
    async setDisabled(index, disabled) {
      await options.setDisabled(index, disabled)
      await settle()
    },
    async focus(index) {
      tabs()[index]!.focus()
      await settle()
    },
    async press(key) {
      await driver.keyboard(`{${key}}`)
      await settle()
    },
    async click(index) {
      const tab = tabs()[index]!
      // A real click cannot reach a disabled tab, so send one from code: the behavior must still ignore it.
      if (tab.hasAttribute('disabled') || tab.getAttribute('aria-disabled') === 'true')
        tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      else await driver.click(tab)
      await settle()
    },
    async tab() {
      await driver.tab()
      await settle()
    },
  }
}
