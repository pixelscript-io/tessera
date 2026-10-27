import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { createDomAdapter } from '@tessera/core'
import { attachToggle } from '../src'
import { domHarness, toggleConformance } from '../src/conformance'

const adapter = createDomAdapter(document)
let cleanups: Array<() => void> = []

afterEach(() => {
  for (const c of cleanups) c()
  cleanups = []
  document.body.innerHTML = ''
})

/** The behavior as a component uses it: on a native `<button>` or a `<div>`, as each of the three roles. */
const subjects = [
  { label: 'native <button> as a checkbox', tag: 'button', role: 'checkbox' },
  { label: 'native <button> as a switch', tag: 'button', role: 'switch' },
  { label: 'native <button> as a toggle button', tag: 'button', role: 'button' },
  { label: 'non-native <div> as a checkbox', tag: 'div', role: 'checkbox' },
  { label: 'non-native <div> as a switch', tag: 'div', role: 'switch' },
]

for (const { label, tag, role } of subjects) {
  describe(`toggle conformance: ${label}`, () => {
    for (const testCase of toggleConformance) {
      it(testCase.name, async () => {
        const el = document.createElement(tag)
        el.textContent = 'Go'
        if (tag === 'button') el.setAttribute('role', role)
        document.body.append(el)
        const native = tag === 'button'
        const attribute = role === 'button' ? 'aria-pressed' : 'aria-checked'
        const events: Array<{ source: string; checked: boolean }> = []
        cleanups.push(
          attachToggle(adapter, el, {
            native,
            role,
            onToggle: (detail) => {
              events.push({ source: detail.source, checked: detail.checked })
              // What a component does: its state moves, and the attribute follows.
              el.setAttribute(attribute, String(detail.checked))
            },
          }),
        )
        const disable = (d: boolean) => {
          if (d) el.setAttribute(native ? 'disabled' : 'aria-disabled', native ? '' : 'true')
          else el.removeAttribute(native ? 'disabled' : 'aria-disabled')
        }
        await testCase.run(domHarness(el, userEvent, { presses: events, setDisabled: disable }))
      })
    }
  })
}

describe('what toggle adds to an element', () => {
  it('starts as off, without overwriting a state that is already there', () => {
    const fresh = document.createElement('button')
    const on = document.createElement('button')
    on.setAttribute('aria-checked', 'true')
    cleanups.push(attachToggle(adapter, fresh, { native: true, role: 'checkbox', onToggle() {} }))
    cleanups.push(attachToggle(adapter, on, { native: true, role: 'checkbox', onToggle() {} }))
    expect(fresh.getAttribute('aria-checked')).toBe('false')
    expect(on.getAttribute('aria-checked')).toBe('true')
  })

  it('uses aria-pressed for a toggle button, and aria-checked otherwise', () => {
    const button = document.createElement('button')
    const box = document.createElement('button')
    cleanups.push(attachToggle(adapter, button, { native: true, role: 'button', onToggle() {} }))
    cleanups.push(attachToggle(adapter, box, { native: true, role: 'switch', onToggle() {} }))
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.hasAttribute('aria-checked')).toBe(false)
    expect(box.getAttribute('aria-checked')).toBe('false')
  })

  it('removes what it added', () => {
    const el = document.createElement('div')
    const seen: boolean[] = []
    const detach = attachToggle(adapter, el, {
      role: 'checkbox',
      onToggle: (d) => seen.push(d.checked),
    })
    detach()
    el.click()
    expect(seen).toEqual([])
  })
})
