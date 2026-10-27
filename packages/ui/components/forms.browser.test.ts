/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { constant, flush, getRenderer, state } from '@tessera/core'
import Button from './Button.tess'
import Form from './Form.tess'
import FormField from './FormField.tess'
import RadioGroup from './RadioGroup.tess'
import Textarea from './Textarea.tess'
import TextField from './TextField.tess'

const r = getRenderer()
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

type Slots = Record<string, () => unknown[]>

/** Mount a component with props (a signal is passed as it is, anything else becomes a constant), events and slots. */
function show(
  component: unknown,
  props: Record<string, unknown>,
  options: { events?: Record<string, (detail: any) => void>; slots?: Slots } = {},
): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = r.mount(
    host,
    () =>
      (component as (args: unknown) => unknown)({
        props: Object.fromEntries(
          Object.entries(props).map(([k, v]) => [
            k,
            v && typeof v === 'object' && 'value' in v ? v : constant(v),
          ]),
        ),
        events: options.events ?? {},
        slots: options.slots ?? {},
      }) as never,
  )
  return host.firstElementChild as HTMLElement
}

const text = (s: string) => () => [s]
const described = (element: Element) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')

describe('Textarea and TextField errors', () => {
  for (const [name, component, selector] of [
    ['Textarea', Textarea, 'textarea'],
    ['TextField', TextField, 'input'],
  ] as const) {
    it(`${name}: an error marks the field invalid and is read with it`, () => {
      const error = state('')
      const root = show(
        component,
        {
          error,
          value: '',
          placeholder: '',
          rows: 3,
          disabled: false,
          invalid: false,
          type: 'text',
          size: 'md',
        },
        { slots: { label: text('Message'), hint: text('Up to 500.') } },
      )
      const field = root.querySelector(selector)!
      expect(field.hasAttribute('aria-invalid')).toBe(false)
      error.value = 'Write a little more.'
      flush()
      expect(field.getAttribute('aria-invalid')).toBe('true')
      expect(described(field)).toEqual(['Up to 500.', 'Write a little more.'])
      expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe('Write a little more.')
    })
  }

  it('Textarea: starts at the rows it is given, and reports what is typed', async () => {
    const seen: string[] = []
    const root = show(
      Textarea,
      {
        rows: 5,
        value: '',
        placeholder: '',
        disabled: false,
        invalid: false,
        error: '',
        size: 'md',
      },
      { events: { input: (v) => seen.push(v) }, slots: { label: text('Message') } },
    )
    const box = root.querySelector('textarea')!
    expect(box.rows).toBe(5)
    await userEvent.click(box)
    await userEvent.keyboard('hello')
    expect(seen.at(-1)).toBe('hello')
  })
})

describe('RadioGroup', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta', disabled: true },
    { value: 'c', label: 'Gamma' },
  ]
  const group = (props: Record<string, unknown>, events: Record<string, (d: any) => void> = {}) =>
    show(
      RadioGroup,
      { options, value: '', disabled: false, error: '', orientation: 'vertical', ...props },
      { events, slots: { label: text('Letter') } },
    )
  const radios = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[role="radio"]')]

  it('checks the option its value names, and puts only that one in the tab order', () => {
    const root = group({ value: 'c' })
    expect(radios(root).map((x) => x.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ])
    expect(radios(root).map((x) => x.tabIndex)).toEqual([-1, -1, 0])
    expect(root.getAttribute('aria-labelledby')).toBe(
      root.querySelector('.t-RadioGroup__label')!.id,
    )
  })

  it('with nothing chosen, Tab stops on the first option that can be chosen', () => {
    const root = group({ value: '' })
    expect(radios(root).map((x) => x.tabIndex)).toEqual([0, -1, -1])
    const second = group({
      value: '',
      options: [{ value: 'x', label: 'X', disabled: true }, ...options],
    })
    expect(radios(second).map((x) => x.tabIndex)).toEqual([-1, 0, -1, -1])
  })

  it('chooses with the pointer and the keys, skips a disabled option, and says where the choice came from', async () => {
    const choices: Array<{ value: string; source: string }> = []
    const root = group({ value: 'a' }, { choose: (d) => choices.push(d) })
    await userEvent.click(radios(root)[2]!)
    expect(choices.at(-1)).toEqual({ value: 'c', source: 'pointer' })
    expect(radios(root)[2]!.getAttribute('aria-checked')).toBe('true')
    await userEvent.keyboard('{ArrowRight}')
    expect(choices.at(-1)).toEqual({ value: 'a', source: 'keyboard' })
    expect(document.activeElement).toBe(radios(root)[0])
    await userEvent.keyboard('{ArrowRight}')
    expect(choices.at(-1)!.value).toBe('c')
  })

  it('a disabled group has no option that can be chosen', async () => {
    const choices: unknown[] = []
    const root = group({ value: 'a', disabled: true }, { choose: (d) => choices.push(d) })
    expect(root.getAttribute('aria-disabled')).toBe('true')
    expect(radios(root).every((x) => (x as HTMLButtonElement).disabled)).toBe(true)
    radios(root)[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(choices).toEqual([])
  })

  it('an error is announced and marks the group invalid', () => {
    const root = group({ error: 'Choose a letter.' })
    expect(root.getAttribute('aria-invalid')).toBe('true')
    expect(described(root)).toContain('Choose a letter.')
  })
})

describe('FormField', () => {
  const field = (props: Record<string, unknown>, control: Element) =>
    show(
      FormField,
      { error: '', required: false, ...props },
      {
        slots: {
          label: text('Start date'),
          default: () => [control],
          hint: text('The first day.'),
        },
      },
    )

  it('names the control with the label, and describes it with the hint and the error', () => {
    const input = document.createElement('input')
    const error = state('')
    const root = field({ error }, input)
    flush()
    expect(input.id).not.toBe('')
    expect(root.querySelector('label')!.getAttribute('for')).toBe(input.id)
    expect(described(input)[0]).toBe('The first day.')
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    error.value = 'Pick a date.'
    flush()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(described(input)).toEqual(['The first day.', 'Pick a date.'])
    error.value = ''
    flush()
    expect(input.hasAttribute('aria-invalid')).toBe(false)
  })

  it('keeps the id a control already has, and marks it required', () => {
    const input = document.createElement('input')
    input.id = 'mine'
    const root = field({ required: true }, input)
    flush()
    expect(input.id).toBe('mine')
    expect(root.querySelector('label')!.getAttribute('for')).toBe('mine')
    expect(input.getAttribute('aria-required')).toBe('true')
  })
})

describe('Form', () => {
  const rules = {
    email: (v: string) => (/^\S+@\S+$/.test(v) ? '' : 'Enter an email.'),
    name: (v: string) => (v ? undefined : 'Enter a name.'),
  }
  const form = (
    values: Record<string, string>,
    events: Record<string, (d: any) => void>,
    control?: Element,
  ) =>
    show(
      Form,
      { values, rules, busy: false },
      { events, slots: { default: () => (control ? [control] : []) } },
    )
  const submit = (el: HTMLElement) => {
    const event = new Event('submit', { cancelable: true, bubbles: true })
    el.dispatchEvent(event)
    return event
  }

  it('fires submit with the values when every rule passes, and does not let the browser send it', () => {
    const sent: unknown[] = []
    const invalid: unknown[] = []
    const el = form(
      { email: 'ada@example.com', name: 'Ada' },
      { submit: (d) => sent.push(d), invalid: (d) => invalid.push(d) },
    )
    const event = submit(el)
    expect(event.defaultPrevented).toBe(true)
    expect(sent).toEqual([{ values: { email: 'ada@example.com', name: 'Ada' } }])
    expect(invalid).toEqual([])
    expect(el.hasAttribute('novalidate')).toBe(true)
  })

  it('fires invalid with every message, and no submit, when a rule fails', () => {
    const sent: unknown[] = []
    const invalid: any[] = []
    const el = form(
      { email: 'nope', name: '' },
      { submit: (d) => sent.push(d), invalid: (d) => invalid.push(d) },
    )
    submit(el)
    expect(sent).toEqual([])
    expect(invalid).toEqual([{ errors: { email: 'Enter an email.', name: 'Enter a name.' } }])
  })

  it('moves focus to the first field marked invalid', async () => {
    const input = document.createElement('input')
    input.setAttribute('aria-invalid', 'true')
    const el = form({ email: '', name: '' }, { invalid: () => {} }, input)
    submit(el)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.activeElement).toBe(input)
  })

  it('is busy for assistive technology while it is sending', () => {
    const busy = state(false)
    const el = show(Form, { values: {}, rules: {}, busy }, {})
    expect(el.hasAttribute('aria-busy')).toBe(false)
    busy.value = true
    flush()
    expect(el.getAttribute('aria-busy')).toBe('true')
  })
})

describe('Button in a form', () => {
  it('is a plain button unless it says submit, and a submit button submits the form once', async () => {
    const native = document.createElement('form')
    document.body.append(native)
    let submitted = 0
    native.addEventListener('submit', (e) => {
      e.preventDefault()
      submitted++
    })
    const mount = (props: Record<string, unknown>) =>
      r.mount(
        native,
        () =>
          (Button as (args: unknown) => unknown)({
            props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, constant(v)])),
            events: {},
            slots: { default: text('Go') },
          }) as never,
      )
    const stop = mount({ type: 'button', disabled: false })
    await userEvent.click(native.querySelector('button')!)
    expect(submitted).toBe(0)
    stop()
    native.innerHTML = ''
    const stopSubmit = mount({ type: 'submit', disabled: false })
    await userEvent.click(native.querySelector('button')!)
    expect(submitted).toBe(1)
    stopSubmit()
    dispose = undefined
    native.remove()
  })
})
