/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { Rocket } from 'lucide'
import { afterEach, describe, expect, it } from 'vitest'
import { constant, getRenderer } from '@tessera/core'
import Icon from './Icon.tess'
import { ICONS } from './icons'

const r = getRenderer()
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

function show(props: Record<string, unknown>): SVGSVGElement {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = r.mount(
    host,
    () =>
      (Icon as (args: unknown) => unknown)({
        props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, constant(v)])),
        events: {},
        slots: {},
      }) as never,
  )
  return host.querySelector('svg')!
}

describe('Icon', () => {
  it('draws an icon by name, in the svg namespace', () => {
    const svg = show({ name: 'check', icon: null, label: '', size: 'md' })
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M20 6 9 17l-5-5')
    expect(svg.getBoundingClientRect().width).toBeGreaterThan(0)
  })

  it('is decoration without a label, and an image with one', () => {
    const plain = show({ name: 'check', icon: null, label: '', size: 'md' })
    expect(plain.getAttribute('aria-hidden')).toBe('true')
    expect(plain.hasAttribute('aria-label')).toBe(false)
    dispose?.()
    const named = show({ name: 'check', icon: null, label: 'Done', size: 'md' })
    expect(named.getAttribute('aria-label')).toBe('Done')
    expect(named.hasAttribute('aria-hidden')).toBe(false)
  })

  it('draws any Lucide icon given as `icon`, so one outside the set costs only what the project imports', () => {
    const svg = show({ name: '', icon: Rocket, label: 'Launch', size: 'md' })
    expect(svg.children.length).toBe(Rocket.length)
  })

  it('draws every shape kind an icon uses: lines, circles, rectangles and polylines', () => {
    for (const name of [
      'house',
      'circle-alert',
      'log-out',
      'sliders-horizontal',
      'image',
      'users',
      'calendar',
    ]) {
      dispose?.()
      const svg = show({ name, icon: null, label: '', size: 'md' })
      expect(svg.children.length, name).toBe(ICONS[name]!.length)
    }
  })

  it('draws nothing for a name it does not know', () => {
    expect(show({ name: 'nope', icon: null, label: '', size: 'md' }).children.length).toBe(0)
  })
})
