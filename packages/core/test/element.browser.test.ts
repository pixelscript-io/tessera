/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { componentProps } from '@tessera/compiler'
import { defineElement, flush } from '../src'
import Button from '../../../packages/ui/components/Button.tess'
import Checkbox from '../../../packages/ui/components/Checkbox.tess'
import Combobox from '../../../packages/ui/components/Combobox.tess'
import Dialog from '../../../packages/ui/components/Dialog.tess'
import TextField from '../../../packages/ui/components/TextField.tess'
import buttonSource from '../../../packages/ui/components/Button.tess?raw'
import checkboxSource from '../../../packages/ui/components/Checkbox.tess?raw'
import comboboxSource from '../../../packages/ui/components/Combobox.tess?raw'
import dialogSource from '../../../packages/ui/components/Dialog.tess?raw'
import textFieldSource from '../../../packages/ui/components/TextField.tess?raw'

// A design system component as a custom element, as the `tessera elements` command registers it: the spec is the
// contract's variants, events and slots, and the props the script names.
const tone = { name: 'tone', values: ['primary', 'neutral', 'danger'], default: 'primary' }
const size = { name: 'size', values: ['sm', 'md', 'lg'], default: 'sm' }

defineElement('x-button', Button, {
  variants: [
    tone,
    size,
    { name: 'emphasis', values: ['solid', 'outline', 'ghost'], default: 'solid' },
  ],
  props: componentProps(buttonSource),
  events: ['press'],
  slots: ['default', 'icon'],
})
defineElement('x-checkbox', Checkbox, {
  variants: [{ name: 'size', values: ['md', 'sm'], default: 'md' }],
  props: componentProps(checkboxSource),
  events: ['toggle'],
  slots: ['default'],
})
defineElement('x-text-field', TextField, {
  variants: [{ name: 'size', values: ['md', 'sm'], default: 'md' }],
  props: componentProps(textFieldSource),
  events: ['input', 'change'],
  slots: ['label', 'hint'],
})
defineElement('x-combobox', Combobox, {
  variants: [{ name: 'size', values: ['md', 'sm'], default: 'md' }],
  props: componentProps(comboboxSource),
  events: ['select', 'input'],
  slots: ['label'],
})
defineElement('x-dialog', Dialog, {
  variants: [{ name: 'size', values: ['md', 'sm', 'lg'], default: 'md' }],
  props: componentProps(dialogSource),
  events: ['dismiss'],
  slots: ['title', 'default', 'actions'],
})

const html = (markup: string): HTMLElement => {
  const host = document.createElement('div')
  host.innerHTML = markup
  document.body.append(host)
  return host.firstElementChild as HTMLElement
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a component as a custom element', () => {
  it('renders the component, with the element itself out of the layout', () => {
    const el = html('<x-button>Save</x-button>')
    const button = el.querySelector('button')!
    expect(button).toBeTruthy()
    expect(button.textContent).toContain('Save')
    expect(getComputedStyle(el).display).toBe('contents')
    // The component's own styles apply: it is a real, styled Button.
    expect(getComputedStyle(button).display).toBe('inline-flex')
  })

  it('takes variants and props as attributes, starting from the defaults', () => {
    const plain = html('<x-button>A</x-button>')
    expect(plain.querySelector('button')!.getAttribute('data-tone')).toBe('primary')
    const styled = html('<x-button tone="danger" size="lg" disabled>B</x-button>')
    const button = styled.querySelector('button')!
    expect(button.getAttribute('data-tone')).toBe('danger')
    expect(button.getAttribute('data-size')).toBe('lg')
    expect(button.disabled).toBe(true)
  })

  it('follows an attribute that changes, and a property that is set', () => {
    const el = html('<x-button tone="danger">A</x-button>') as HTMLElement & Record<string, any>
    const button = el.querySelector('button')!
    el.setAttribute('tone', 'neutral')
    flush()
    expect(button.getAttribute('data-tone')).toBe('neutral')
    el.tone = 'primary'
    flush()
    expect(button.getAttribute('data-tone')).toBe('primary')
    expect(el.tone).toBe('primary')
    el.disabled = true
    flush()
    expect(button.disabled).toBe(true)
    el.removeAttribute('disabled')
    el.disabled = false
    flush()
    expect(button.disabled).toBe(false)
  })

  it('reads a boolean attribute as present, and "false" as off', () => {
    expect(html('<x-button disabled="false">A</x-button>').querySelector('button')!.disabled).toBe(
      false,
    )
    expect(html('<x-button disabled="">A</x-button>').querySelector('button')!.disabled).toBe(true)
  })

  it('dispatches what the component emits as an event of the same name, with the detail', async () => {
    const el = html('<x-button>Go</x-button>')
    const seen: Array<{ type: string; source: string; bubbles: boolean; target: unknown }> = []
    document.body.addEventListener('press', (e) =>
      seen.push({
        type: e.type,
        source: (e as CustomEvent).detail.source,
        bubbles: e.bubbles,
        target: e.target,
      }),
    )
    await userEvent.click(el.querySelector('button')!)
    expect(seen).toEqual([{ type: 'press', source: 'pointer', bubbles: true, target: el }])
  })

  it('reaches a listener written as an attribute handler or with addEventListener', async () => {
    const el = html('<x-checkbox>Agree</x-checkbox>')
    const events: boolean[] = []
    el.addEventListener('toggle', (e) => events.push((e as unknown as CustomEvent).detail.checked))
    await userEvent.click(el.querySelector('[role=checkbox]')!)
    await userEvent.click(el.querySelector('[role=checkbox]')!)
    expect(events).toEqual([true, false])
  })

  it('starts a checkbox checked from its attribute', () => {
    const el = html('<x-checkbox checked>Agree</x-checkbox>')
    expect(el.querySelector('[role=checkbox]')!.getAttribute('aria-checked')).toBe('true')
  })

  it('fills named slots from children with a slot attribute, and the default slot from the rest', () => {
    const el = html(
      '<x-text-field><span slot="label">Email</span><span slot="hint">We never share it.</span></x-text-field>',
    )
    expect(el.querySelector('label')!.textContent).toContain('Email')
    expect(el.textContent).toContain('We never share it.')
    // The input is labelled by the label slot.
    const input = el.querySelector('input')!
    const label = el.querySelector('label')!
    expect(label.getAttribute('for')).toBe(input.id || null)
  })

  it('gives a component text in its default slot, and keeps elements in it', () => {
    const el = html('<x-button><b>Bold</b> label</x-button>')
    expect(el.querySelector('button b')!.textContent).toBe('Bold')
  })

  it('shows the events of the component once, not also the native event of what is inside', async () => {
    const el = html('<x-text-field><span slot="label">Name</span></x-text-field>')
    const seen: Array<{ custom: boolean; detail: unknown }> = []
    el.addEventListener('input', (e) =>
      seen.push({ custom: e instanceof CustomEvent, detail: (e as CustomEvent).detail }),
    )
    const input = el.querySelector('input')!
    input.focus()
    await userEvent.keyboard('ab')
    expect(seen.every((s) => s.custom)).toBe(true)
    expect(seen.map((s) => s.detail)).toEqual(['a', 'ab'])
    // The component's own handler still saw the native event: the value it reports is what was typed.
  })

  it('takes a list as a property, before or after it is in the page', async () => {
    const el = document.createElement('x-combobox') as HTMLElement & Record<string, any>
    el.options = [
      { value: 'a', label: 'Apple' },
      { value: 'b', label: 'Banana' },
    ]
    const label = document.createElement('span')
    label.slot = 'label'
    label.textContent = 'Fruit'
    el.append(label)
    document.body.append(el)
    const input = el.querySelector('input')!
    input.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(el.querySelectorAll('[role=option]').length).toBe(2)
    el.options = [{ value: 'c', label: 'Cherry' }]
    flush()
    expect(el.querySelectorAll('[role=option]').length).toBe(1)
    expect(el.querySelector('[role=option]')!.textContent).toContain('Cherry')
  })

  it('takes a list as JSON in an attribute', () => {
    const el = html(
      `<x-combobox options='[{"value":"a","label":"Apple"}]'><span slot="label">Fruit</span></x-combobox>`,
    )
    el.querySelector('input')!.focus()
    expect((el as any).options).toEqual([{ value: 'a', label: 'Apple' }])
  })

  it('reports a choice from a combobox as its own event', async () => {
    const el = document.createElement('x-combobox') as HTMLElement & Record<string, any>
    el.options = [
      { value: 'a', label: 'Apple' },
      { value: 'b', label: 'Banana' },
    ]
    el.innerHTML = '<span slot="label">Fruit</span>'
    document.body.append(el)
    const chosen: unknown[] = []
    el.addEventListener('select', (e) => chosen.push((e as CustomEvent).detail))
    el.querySelector('input')!.focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(chosen).toEqual([{ value: 'b', label: 'Banana' }])
  })

  it('opens a dialog from a property, and reports a dismissal', async () => {
    const el = html(
      '<x-dialog><span slot="title">Delete?</span>Are you sure?<button slot="actions">Cancel</button></x-dialog>',
    ) as HTMLElement & Record<string, any>
    const dialog = el.querySelector('dialog')!
    expect(dialog.open).toBe(false)
    const reasons: string[] = []
    el.addEventListener('dismiss', (e) => reasons.push((e as CustomEvent).detail.reason))
    el.open = true
    flush()
    await settle()
    expect(dialog.open).toBe(true)
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(reasons).toEqual(['escape'])
    expect(dialog.open).toBe(false)
  })

  it('keeps its slot content when it is moved in the page', () => {
    const el = html('<x-button>Keep me</x-button>')
    const parent = el.parentElement!
    el.remove()
    expect(el.querySelector('button')).toBeNull()
    parent.append(el)
    expect(el.querySelector('button')!.textContent).toContain('Keep me')
  })

  it('takes a property set before the element was defined', () => {
    const el = document.createElement('x-late') as HTMLElement & Record<string, any>
    el.tone = 'danger'
    el.textContent = 'Late'
    document.body.append(el)
    defineElement('x-late', Button, {
      variants: [tone],
      props: [],
      events: ['press'],
      slots: ['default'],
    })
    expect(el.querySelector('button')!.getAttribute('data-tone')).toBe('danger')
  })

  it('registers a tag once', () => {
    const first = customElements.get('x-button')
    expect(defineElement('x-button', Button, {})).toBe(first)
  })
})
