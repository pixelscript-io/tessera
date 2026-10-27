/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { constant, flush, getRenderer, state } from '@tessera/core'
import Button from './Button.tess'
import Popover from './Popover.tess'
import Tooltip from './Tooltip.tess'

const r = getRenderer()
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

type Slots = Record<string, () => unknown[]>

function show(
  component: unknown,
  props: Record<string, unknown>,
  options: {
    events?: Record<string, (detail: any) => void>
    slots?: Slots
    align?: 'start' | 'end'
  } = {},
): HTMLElement {
  const host = document.createElement('div')
  // Room around it, so there is somewhere for a panel to go.
  host.style.cssText = `padding: 160px 24px; display: flex; justify-content: flex-${options.align ?? 'start'};`
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

describe('Popover', () => {
  const popover = (
    props: Record<string, unknown> = {},
    events: Record<string, (d: any) => void> = {},
    align: 'start' | 'end' = 'start',
  ) =>
    show(
      Popover,
      { open: false, label: '', placement: 'bottom', ...props },
      {
        events,
        align,
        slots: { trigger: text('Share'), default: text('Anyone with the link') },
      },
    )
  const parts = (root: HTMLElement) => ({
    trigger: root.querySelector('button')!,
    panel: root.querySelector<HTMLElement>('[popover]')!,
  })

  it('is closed at first, and the button says so and names what it opens', () => {
    const { trigger, panel } = parts(popover())
    expect(panel.matches(':popover-open')).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-labelledby')).toBe(trigger.id)
  })

  it('opens from the button, reports it, and closes on Escape with focus back on the button', async () => {
    const changes: boolean[] = []
    const { trigger, panel } = parts(popover({}, { change: (d) => changes.push(d.open) }))
    await userEvent.click(trigger)
    await settle()
    expect(panel.matches(':popover-open')).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(panel.textContent).toContain('Anyone with the link')
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(panel.matches(':popover-open')).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    expect(changes).toEqual([true, false])
  })

  it('closes on a click outside, and the page behind it stays usable', async () => {
    const outside = document.createElement('button')
    outside.textContent = 'Elsewhere'
    document.body.append(outside)
    const { trigger, panel } = parts(popover())
    await userEvent.click(trigger)
    await settle()
    expect(panel.matches(':popover-open')).toBe(true)
    await userEvent.click(outside)
    await settle()
    expect(panel.matches(':popover-open')).toBe(false)
  })

  it('follows the open prop, in both directions', async () => {
    const open = state(false)
    const { trigger, panel } = parts(popover({ open }))
    open.value = true
    flush()
    await settle()
    expect(panel.matches(':popover-open')).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    open.value = false
    flush()
    await settle()
    expect(panel.matches(':popover-open')).toBe(false)
  })

  it('takes its name from the label when it has one', () => {
    const { trigger, panel } = parts(popover({ label: 'Sharing options' }))
    expect(panel.getAttribute('aria-label')).toBe('Sharing options')
    expect(panel.hasAttribute('aria-labelledby')).toBe(false)
    expect(trigger.id).not.toBe('')
  })

  it('opens next to its button, on the side it prefers, and inside the window', async () => {
    for (const [placement, side] of [
      ['bottom', 'below'],
      ['top', 'above'],
      ['right', 'right of'],
      ['left', 'left of'],
    ] as const) {
      dispose?.()
      document.body.innerHTML = ''
      // A panel to the left needs room on the left: the button goes to the right edge for that one.
      const { trigger, panel } = parts(
        popover({ placement }, {}, placement === 'left' ? 'end' : 'start'),
      )
      await userEvent.click(trigger)
      await settle()
      const t = trigger.getBoundingClientRect()
      const p = panel.getBoundingClientRect()
      if (side === 'below') expect(p.top, placement).toBeGreaterThanOrEqual(t.bottom - 1)
      if (side === 'above') expect(p.bottom, placement).toBeLessThanOrEqual(t.top + 1)
      if (side === 'right of') expect(p.left, placement).toBeGreaterThanOrEqual(t.right - 1)
      if (side === 'left of') expect(p.right, placement).toBeLessThanOrEqual(t.left + 1)
      expect(p.left).toBeGreaterThanOrEqual(0)
      expect(p.right).toBeLessThanOrEqual(window.innerWidth)
      expect(p.width).toBeGreaterThan(0)
    }
  })
})

describe('Tooltip', () => {
  const tooltip = (props: Record<string, unknown> = {}, withButton = true) =>
    show(
      Tooltip,
      { placement: 'top', delay: 0, ...props },
      {
        slots: {
          default: withButton
            ? () => [
                (Button as (args: unknown) => unknown)({
                  props: {},
                  events: {},
                  slots: { default: text('Save') },
                }),
              ]
            : text('Terms'),
          content: text('Saves a draft'),
        },
      },
    )
  const tipOf = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="tooltip"]')!

  it('describes the control in its slot, and is hidden until it is wanted', () => {
    const root = tooltip()
    flush()
    const tip = tipOf(root)
    expect(tip.matches(':popover-open')).toBe(false)
    expect(root.querySelector('button')!.getAttribute('aria-describedby')).toBe(tip.id)
    expect(tip.textContent).toBe('Saves a draft')
  })

  it('shows at once on keyboard focus, and Escape hides it', async () => {
    const root = tooltip({ delay: 5000 })
    const tip = tipOf(root)
    await userEvent.tab()
    await settle()
    expect(document.activeElement).toBe(root.querySelector('button'))
    expect(tip.matches(':popover-open')).toBe(true)
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(tip.matches(':popover-open')).toBe(false)
  })

  it('shows when the pointer rests on it, above the control, and hides when the pointer leaves', async () => {
    const root = tooltip()
    const tip = tipOf(root)
    await userEvent.hover(root.querySelector('button')!)
    await settle()
    await settle()
    expect(tip.matches(':popover-open')).toBe(true)
    const t = root.querySelector('button')!.getBoundingClientRect()
    expect(tip.getBoundingClientRect().bottom).toBeLessThanOrEqual(t.top + 1)
    await userEvent.unhover(root.querySelector('button')!)
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(tip.matches(':popover-open')).toBe(false)
  })

  it('waits for the pointer to rest: a pass over the control shows nothing', async () => {
    const root = tooltip({ delay: 400 })
    const tip = tipOf(root)
    await userEvent.hover(root.querySelector('button')!)
    await userEvent.unhover(root.querySelector('button')!)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(tip.matches(':popover-open')).toBe(false)
  })

  it('gives a slot with nothing to focus a stop of its own, so the hint is not for the pointer alone', () => {
    const root = tooltip({}, false)
    flush()
    expect(root.getAttribute('tabindex')).toBe('0')
    expect(root.getAttribute('aria-describedby')).toBe(tipOf(root).id)
  })
})
