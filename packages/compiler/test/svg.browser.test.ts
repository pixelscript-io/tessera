import { afterEach, describe, expect, it } from 'vitest'
import { flush, getRenderer } from '@tessera/core'
import Chart from './fixtures/Chart.tess'

const r = getRenderer()
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

describe('svg in a template', () => {
  it('creates an svg and everything in it in the svg namespace, and leaves its siblings alone', () => {
    const container = document.createElement('div')
    document.body.append(container)
    dispose = r.mount(container, () => Chart())
    const svg = container.querySelector('svg')!
    const ns = 'http://www.w3.org/2000/svg'
    expect(svg.namespaceURI).toBe(ns)
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 40')
    for (const tag of ['path', 'circle', 'animate'])
      expect(container.querySelector(tag)!.namespaceURI).toBe(ns)
    expect(container.querySelector('path')!.getAttribute('stroke-width')).toBe('2')
    expect(container.querySelector('animate')!.getAttribute('attributeName')).toBe('opacity')
    expect(container.querySelector('span')!.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
    // A bound attribute on an svg element is reactive.
    expect(svg.getAttribute('width')).toBe('100')
  })

  it('has a real size: an svg path is drawn, not an unknown element', () => {
    const container = document.createElement('div')
    document.body.append(container)
    dispose = r.mount(container, () => Chart())
    flush()
    const box = container.querySelector('svg')!.getBoundingClientRect()
    expect(box.width).toBe(100)
    expect(box.height).toBe(40)
  })
})
