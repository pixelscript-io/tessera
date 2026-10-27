import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { createDomAdapter } from '@tessera/core'
import { attachDisclosure } from '../src'
import { disclosureConformance, domHarness } from '../src/conformance'

const adapter = createDomAdapter(document)
let cleanups: Array<() => void> = []

afterEach(() => {
  for (const c of cleanups) c()
  cleanups = []
  document.body.innerHTML = ''
})

/** A trigger and the region it shows, as an accordion item makes them. */
function item(tag: 'button' | 'div') {
  const root = document.createElement('div')
  const trigger = document.createElement(tag)
  trigger.textContent = 'Question'
  const content = document.createElement('div')
  content.textContent = 'Answer'
  content.hidden = true
  root.append(trigger, content)
  document.body.append(root)
  return { trigger, content }
}

for (const tag of ['button', 'div'] as const) {
  const label = tag === 'button' ? 'native <button>' : 'non-native <div>'
  describe(`disclosure conformance: ${label} trigger`, () => {
    for (const testCase of disclosureConformance) {
      it(testCase.name, async () => {
        const { trigger, content } = item(tag)
        const native = tag === 'button'
        const events: Array<{ source: string; expanded: boolean }> = []
        cleanups.push(
          attachDisclosure(adapter, trigger, {
            native,
            onExpand: (detail) => {
              events.push({ source: detail.source, expanded: detail.expanded })
              // What a component does: its state moves, and the attribute and the region follow.
              trigger.setAttribute('aria-expanded', String(detail.expanded))
              content.hidden = !detail.expanded
            },
          }),
        )
        const disable = (d: boolean) => {
          if (d) trigger.setAttribute(native ? 'disabled' : 'aria-disabled', native ? '' : 'true')
          else trigger.removeAttribute(native ? 'disabled' : 'aria-disabled')
        }
        await testCase.run(
          domHarness(trigger, userEvent, { presses: events, setDisabled: disable, content }),
        )
      })
    }
  })
}

describe('what disclosure adds to its trigger', () => {
  it('starts collapsed, without overwriting a state that is already there', () => {
    const fresh = item('button').trigger
    const open = item('button').trigger
    open.setAttribute('aria-expanded', 'true')
    cleanups.push(attachDisclosure(adapter, fresh, { native: true, onExpand() {} }))
    cleanups.push(attachDisclosure(adapter, open, { native: true, onExpand() {} }))
    expect(fresh.getAttribute('aria-expanded')).toBe('false')
    expect(open.getAttribute('aria-expanded')).toBe('true')
  })

  it('makes a non-native trigger focusable, as a button', () => {
    const { trigger } = item('div')
    cleanups.push(attachDisclosure(adapter, trigger, { onExpand() {} }))
    expect([trigger.getAttribute('role'), trigger.getAttribute('tabindex')]).toEqual([
      'button',
      '0',
    ])
  })
})
