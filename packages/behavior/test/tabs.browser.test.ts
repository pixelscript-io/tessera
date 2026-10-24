import { userEvent } from '@vitest/browser/context'
import { afterEach, describe, expect, it } from 'vitest'
import { createDomAdapter } from '@tessera/core'
import { attachTabs } from '../src'
import { domTabsHarness, tabsConformance } from '../src/conformance'

const adapter = createDomAdapter(document)
let cleanups: Array<() => void> = []

afterEach(() => {
  for (const c of cleanups) c()
  cleanups = []
  document.body.innerHTML = ''
})

/** Three tabs and their panels, wired as a component wires them: the selection is a value the tabs and panels follow. */
function tabsList(tag: 'button' | 'div') {
  const root = document.createElement('div')
  const list = document.createElement('div')
  const values = ['one', 'two', 'three']
  const tabs = values.map((value) => {
    const tab = document.createElement(tag)
    tab.id = `tab-${value}`
    tab.dataset.value = value
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', `panel-${value}`)
    tab.textContent = value
    return tab
  })
  const panels = values.map((value) => {
    const panel = document.createElement('div')
    panel.id = `panel-${value}`
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', `tab-${value}`)
    panel.textContent = `${value} panel`
    return panel
  })
  list.append(...tabs)
  root.append(list, ...panels)
  document.body.append(root)
  const select = (value: string) => {
    tabs.forEach((tab, i) => {
      const on = values[i] === value
      tab.setAttribute('aria-selected', String(on))
      tab.tabIndex = on ? 0 : -1
      panels[i]!.hidden = !on
    })
  }
  select('one')
  list.setAttribute('role', 'tablist')
  return { list, tabs, panels, select }
}

for (const tag of ['button', 'div'] as const) {
  describe(`tabs conformance: <${tag}> tabs`, () => {
    for (const testCase of tabsConformance) {
      it(testCase.name, async () => {
        const { list, tabs, panels, select } = tabsList(tag)
        const activations: Array<{ value: string; source: string }> = []
        cleanups.push(
          attachTabs(adapter, list, {
            onActivate: (detail) => {
              activations.push({ value: detail.value, source: detail.source })
              select(detail.value)
            },
          }),
        )
        const harness = domTabsHarness(list, userEvent, {
          panels: () => panels,
          activations,
          setDisabled: (index, disabled) => {
            if (disabled) tabs[index]!.setAttribute('aria-disabled', 'true')
            else tabs[index]!.removeAttribute('aria-disabled')
          },
        })
        await testCase.run(harness)
      })
    }
  })
}

describe('tabs', () => {
  it('sets role="tablist" if the element has none, and removes its listeners', () => {
    const { list, tabs } = tabsList('button')
    list.removeAttribute('role')
    const seen: string[] = []
    const detach = attachTabs(adapter, list, { onActivate: (d) => seen.push(d.value) })
    expect(list.getAttribute('role')).toBe('tablist')
    tabs[1]!.click()
    expect(seen).toEqual(['two'])
    detach()
    tabs[2]!.click()
    expect(seen).toEqual(['two'])
  })

  it('names a tab by its id, then its position, when it has no data-value', () => {
    const { list, tabs } = tabsList('button')
    const seen: string[] = []
    cleanups.push(attachTabs(adapter, list, { onActivate: (d) => seen.push(d.value) }))
    delete tabs[0]!.dataset.value
    tabs[0]!.click()
    tabs[1]!.removeAttribute('data-value')
    tabs[1]!.removeAttribute('id')
    tabs[1]!.click()
    expect(seen).toEqual(['tab-one', '1'])
  })
})
