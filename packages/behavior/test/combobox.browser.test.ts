import { userEvent } from '@vitest/browser/context'
import { afterEach, describe, expect, it } from 'vitest'
import { createDomAdapter } from '@tessera/core'
import { attachCombobox, type ComboboxCommand } from '../src'

const adapter = createDomAdapter(document)
let cleanups: Array<() => void> = []

afterEach(() => {
  for (const c of cleanups) c()
  cleanups = []
  document.body.innerHTML = ''
})

/** A bare input with the behavior; the test plays the component, setting the attributes the way it would. */
function field() {
  const input = document.createElement('input')
  document.body.append(input)
  const commands: string[] = []
  cleanups.push(
    attachCombobox(adapter, input, {
      onCommand: (c: ComboboxCommand) => commands.push(c.command),
    }),
  )
  input.focus()
  return { input, commands }
}

describe('combobox keys, as commands for the component', () => {
  it('Arrow Down opens when closed and moves on when open', async () => {
    const { input, commands } = field()
    await userEvent.keyboard('{ArrowDown}')
    input.setAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{ArrowDown}')
    expect(commands).toEqual(['open', 'next'])
  })

  it('Arrow Up opens on the last option when closed and moves back when open', async () => {
    const { input, commands } = field()
    await userEvent.keyboard('{ArrowUp}')
    input.setAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{ArrowUp}')
    expect(commands).toEqual(['open-last', 'prev'])
  })

  it('Enter chooses only while the list is open and an option is active', async () => {
    const { input, commands } = field()
    await userEvent.keyboard('{Enter}')
    input.setAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Enter}')
    input.setAttribute('aria-activedescendant', 'option-1')
    await userEvent.keyboard('{Enter}')
    expect(commands).toEqual(['select'])
  })

  it('Escape and Tab close an open list, and do nothing to a closed one', async () => {
    const { input, commands } = field()
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Tab}')
    expect(commands).toEqual([])
    input.setAttribute('aria-expanded', 'true')
    input.focus()
    await userEvent.keyboard('{Escape}')
    expect(commands).toEqual(['close'])
    input.setAttribute('aria-expanded', 'true')
    input.focus()
    await userEvent.keyboard('{Tab}')
    expect(commands).toEqual(['close', 'close'])
  })

  it('does not stop Enter from submitting a form when nothing is chosen', async () => {
    const { input } = field()
    const form = document.createElement('form')
    document.body.append(form)
    form.append(input)
    let submitted = false
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      submitted = true
    })
    input.focus()
    await userEvent.keyboard('{Enter}')
    expect(submitted).toBe(true)
  })

  it('gives no commands while disabled', async () => {
    const { input, commands } = field()
    input.setAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{ArrowDown}')
    expect(commands).toEqual([])
  })

  it('ignores keys during text composition', () => {
    const { input, commands } = field()
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true, bubbles: true }),
    )
    expect(commands).toEqual([])
  })
})

describe('what combobox adds to the input', () => {
  it('sets the pattern, without overwriting what is there', () => {
    const fresh = document.createElement('input')
    const custom = document.createElement('input')
    custom.setAttribute('aria-expanded', 'true')
    custom.setAttribute('autocomplete', 'on')
    cleanups.push(attachCombobox(adapter, fresh, { onCommand() {} }))
    cleanups.push(attachCombobox(adapter, custom, { onCommand() {} }))
    expect(
      ['role', 'aria-autocomplete', 'aria-expanded', 'autocomplete'].map((a) =>
        fresh.getAttribute(a),
      ),
    ).toEqual(['combobox', 'list', 'false', 'off'])
    expect(custom.getAttribute('aria-expanded')).toBe('true')
    expect(custom.getAttribute('autocomplete')).toBe('on')
  })

  it('removes its listener', async () => {
    const input = document.createElement('input')
    document.body.append(input)
    const commands: string[] = []
    const detach = attachCombobox(adapter, input, { onCommand: (c) => commands.push(c.command) })
    detach()
    input.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(commands).toEqual([])
  })
})
