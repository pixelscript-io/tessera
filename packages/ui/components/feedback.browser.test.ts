/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { afterEach, describe, expect, it } from 'vitest'
import { constant, flush, getRenderer, state } from '@tessera/core'
import Alert from './Alert.tess'
import Avatar from './Avatar.tess'
import Progress from './Progress.tess'
import Separator from './Separator.tess'
import Spinner from './Spinner.tess'

const r = getRenderer()
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

/** Mount a component with constant props and text for its slots. */
function show(
  component: (args: any) => unknown,
  props: Record<string, unknown>,
  slots: Record<string, string> = {},
): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = r.mount(
    host,
    () =>
      component({
        props: Object.fromEntries(
          Object.entries(props).map(([k, v]) => [
            k,
            v && typeof v === 'object' && 'value' in v ? v : constant(v),
          ]),
        ),
        events: {},
        slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, () => [v]])),
      }) as never,
  )
  return host.firstElementChild as HTMLElement
}

describe('Avatar', () => {
  it('shows up to two initials from the name when there is no picture', () => {
    const root = show(Avatar, { src: '', name: 'Ada Lovelace King', size: 'md' })
    expect(root.textContent!.trim()).toBe('AL')
    expect(root.getAttribute('aria-label')).toBe('Ada Lovelace King')
    expect(root.querySelector('img')).toBeNull()
  })

  it('shows the picture, and falls back to the initials when it does not load', () => {
    const root = show(Avatar, {
      src: 'data:image/png;base64,broken',
      name: 'Grace Hopper',
      size: 'md',
    })
    const image = root.querySelector('img')!
    expect(image).not.toBeNull()
    expect(image.getAttribute('alt')).toBe('')
    image.dispatchEvent(new Event('error'))
    flush()
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent!.trim()).toBe('GH')
  })

  it('has a name for assistive technology even with no name given', () => {
    expect(show(Avatar, { src: '', name: '', size: 'md' }).getAttribute('aria-label')).toBe(
      'Avatar',
    )
  })
})

describe('Progress', () => {
  it('reports its value, clamped to the range, and sizes the bar', () => {
    const value = state(40)
    const root = show(Progress, { value, max: 100, label: 'Upload', size: 'md', tone: 'primary' })
    expect(root.getAttribute('aria-valuenow')).toBe('40')
    expect(root.getAttribute('aria-valuemax')).toBe('100')
    expect(root.getAttribute('aria-label')).toBe('Upload')
    expect((root.firstElementChild as HTMLElement).style.width).toBe('40%')
    value.value = 250
    flush()
    expect((root.firstElementChild as HTMLElement).style.width).toBe('100%')
  })

  it('is indeterminate with no value: no aria-valuenow', () => {
    const root = show(Progress, {
      value: null,
      max: 100,
      label: 'Progress',
      size: 'md',
      tone: 'primary',
    })
    expect(root.hasAttribute('aria-valuenow')).toBe(false)
    expect(root.getAttribute('data-indeterminate')).toBe('true')
  })
})

describe('Spinner', () => {
  it('says Loading to a screen reader unless it has a label', () => {
    expect(show(Spinner, { size: 'md' }).textContent).toContain('Loading')
    dispose?.()
    expect(show(Spinner, { size: 'md' }, { default: 'Saving' }).textContent).toContain('Saving')
  })
})

describe('Separator', () => {
  it('says which way it runs', () => {
    expect(show(Separator, { orientation: 'vertical' }).getAttribute('aria-orientation')).toBe(
      'vertical',
    )
  })
})

describe('Alert', () => {
  it('is an alert with a title and a message', () => {
    const root = show(Alert, { tone: 'danger' }, { title: 'Could not save', default: 'Try again.' })
    expect(root.getAttribute('role')).toBe('alert')
    expect(root.querySelector('.t-Alert__title')!.textContent).toBe('Could not save')
    expect(root.querySelector('.t-Alert__body')!.textContent).toBe('Try again.')
  })
})
