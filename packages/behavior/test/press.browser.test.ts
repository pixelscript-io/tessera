import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { createDomAdapter } from '@tessera/core'
import { attachPress } from '../src'
import { domHarness, pressConformance } from '../src/conformance'

const adapter = createDomAdapter(document)
let cleanups: Array<() => void> = []

afterEach(() => {
  for (const c of cleanups) c()
  cleanups = []
  document.body.innerHTML = ''
})

/** The behavior on a native `<button>`, and on a `<div>` that is not natively pressable. */
const subjects = {
  'native <button>': () => {
    const el = document.createElement('button')
    el.textContent = 'Go'
    return {
      el,
      native: true,
      disable: (d: boolean) =>
        d ? el.setAttribute('disabled', '') : el.removeAttribute('disabled'),
    }
  },
  'non-native <div>': () => {
    const el = document.createElement('div')
    el.textContent = 'Go'
    return {
      el,
      native: false,
      disable: (d: boolean) =>
        d ? el.setAttribute('aria-disabled', 'true') : el.removeAttribute('aria-disabled'),
    }
  },
}

for (const [label, make] of Object.entries(subjects)) {
  describe(`press conformance: ${label}`, () => {
    for (const testCase of pressConformance) {
      it(testCase.name, async () => {
        const { el, native, disable } = make()
        document.body.append(el)
        const presses: Array<{ source: string }> = []
        cleanups.push(
          attachPress(adapter, el, {
            native,
            role: 'button',
            onPress: (detail) => presses.push({ source: detail.source }),
          }),
        )
        const harness = domHarness(el, userEvent, { presses, setDisabled: disable })
        await testCase.run(harness)
      })
    }
  })
}

describe('what the behavior adds to an element that is not native', () => {
  it('makes it focusable and gives it a role, without overwriting what is there', () => {
    const plain = document.createElement('div')
    const custom = document.createElement('div')
    custom.setAttribute('role', 'link')
    custom.setAttribute('tabindex', '-1')
    cleanups.push(attachPress(adapter, plain, { role: 'button', onPress() {} }))
    cleanups.push(attachPress(adapter, custom, { role: 'button', onPress() {} }))
    expect([plain.getAttribute('role'), plain.getAttribute('tabindex')]).toEqual(['button', '0'])
    expect([custom.getAttribute('role'), custom.getAttribute('tabindex')]).toEqual(['link', '-1'])
  })

  it('leaves a native element alone', () => {
    const button = document.createElement('button')
    cleanups.push(attachPress(adapter, button, { native: true, role: 'button', onPress() {} }))
    expect(button.hasAttribute('role')).toBe(false)
    expect(button.hasAttribute('tabindex')).toBe(false)
  })

  it('ignores key repeat, so holding Enter presses once', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    let count = 0
    cleanups.push(attachPress(adapter, el, { onPress: () => count++ }))
    el.focus()
    for (const repeat of [false, true, true, true]) {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', repeat, bubbles: true, cancelable: true }),
      )
    }
    expect(count).toBe(1)
  })

  it('stops the page from scrolling on Space', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    cleanups.push(attachPress(adapter, el, { onPress() {} }))
    const down = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    el.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
  })

  it('removes its listeners and state when cleaned up', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    let count = 0
    const cleanup = attachPress(adapter, el, { onPress: () => count++ })
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(el.getAttribute('data-state')).toBe('pressed')
    cleanup()
    expect(el.hasAttribute('data-state')).toBe(false)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(count).toBe(0)
  })
})
