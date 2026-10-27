import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { createDomAdapter } from '@tessera/core'
import { attachRadioGroup } from '../src'
import { domRadioGroupHarness, radioGroupConformance } from '../src/conformance'

const adapter = createDomAdapter(document)
let cleanups: Array<() => void> = []

afterEach(() => {
  for (const c of cleanups) c()
  cleanups = []
  document.body.innerHTML = ''
})

/** Three radios, wired as a component wires them: the choice is a value the radios follow. */
function radioGroup(tag: 'button' | 'div') {
  const group = document.createElement('div')
  const values = ['one', 'two', 'three']
  const radios = values.map((value) => {
    const radio = document.createElement(tag)
    radio.id = `radio-${value}`
    radio.dataset.value = value
    radio.setAttribute('role', 'radio')
    radio.textContent = value
    return radio
  })
  group.append(...radios)
  document.body.append(group)
  const choose = (value: string) => {
    radios.forEach((radio, i) => {
      const on = values[i] === value
      radio.setAttribute('aria-checked', String(on))
      radio.tabIndex = on ? 0 : -1
    })
  }
  choose('one')
  group.setAttribute('role', 'radiogroup')
  return { group, radios, choose }
}

for (const tag of ['button', 'div'] as const) {
  describe(`radio-group conformance: <${tag}> radios`, () => {
    for (const testCase of radioGroupConformance) {
      it(testCase.name, async () => {
        const { group, radios, choose } = radioGroup(tag)
        const choices: Array<{ value: string; source: string }> = []
        cleanups.push(
          attachRadioGroup(adapter, group, {
            onChoose: (detail) => {
              choices.push({ value: detail.value, source: detail.source })
              choose(detail.value)
            },
          }),
        )
        const harness = domRadioGroupHarness(group, userEvent, {
          choices,
          setDisabled: (index, disabled) => {
            if (disabled) radios[index]!.setAttribute('aria-disabled', 'true')
            else radios[index]!.removeAttribute('aria-disabled')
          },
        })
        await testCase.run(harness)
      })
    }
  })
}

describe('radio group', () => {
  it('sets role="radiogroup" if the element has none, and removes its listeners', () => {
    const { group, radios } = radioGroup('button')
    group.removeAttribute('role')
    const seen: string[] = []
    const detach = attachRadioGroup(adapter, group, { onChoose: (d) => seen.push(d.value) })
    expect(group.getAttribute('role')).toBe('radiogroup')
    radios[1]!.click()
    expect(seen).toEqual(['two'])
    detach()
    radios[2]!.click()
    expect(seen).toEqual(['two'])
  })

  it('names a radio by its id, then its position, when it has no data-value', () => {
    const { group, radios } = radioGroup('button')
    const seen: string[] = []
    cleanups.push(attachRadioGroup(adapter, group, { onChoose: (d) => seen.push(d.value) }))
    delete radios[0]!.dataset.value
    radios[0]!.click()
    radios[1]!.removeAttribute('data-value')
    radios[1]!.removeAttribute('id')
    radios[1]!.click()
    expect(seen).toEqual(['radio-one', '1'])
  })
})
