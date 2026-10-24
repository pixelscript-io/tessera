import { afterEach, describe, expect, it } from 'vitest'
import { flush, getRenderer } from '@tessera/core'
import Measured from './fixtures/Measured.tess'
import { compile } from '../src'

const r = getRenderer()
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

describe('ref', () => {
  it('holds the element in a signal while it is on the page, and null after', () => {
    const container = document.createElement('div')
    document.body.append(container)
    dispose = r.mount(container, () => Measured())
    const seen = container.querySelector('.t-Measured__seen')!
    expect(seen.textContent).toBe('none')
    ;(container.querySelector('button') as HTMLButtonElement).click()
    flush()
    expect(seen.textContent).toBe('DIV')
    ;(container.querySelector('button') as HTMLButtonElement).click()
    flush()
    expect(seen.textContent).toBe('none')
  })
})

describe('ref in the compiler', () => {
  const source = (script: string) =>
    `<contract>\n{ "name": "A", "role": "generic", "parts": ["root"] }\n</contract>\n<script>\n${script}\n</script>\n<template><div class="root" ref="box"></div></template>`
  it('needs a signal made with state()', () => {
    const bad = compile(source('const box = 1'), { file: 'A.tess' })
    expect(bad.diagnostics.map((d) => d.code)).toContain('T4011')
    expect(bad.diagnostics[0]!.message).toContain('ref needs a signal made with state()')
    const missing = compile(source('const boxs = state(null)'), { file: 'A.tess' })
    expect(missing.diagnostics[0]!.message).toContain('"box" is not declared in <script>')
    expect(missing.diagnostics[0]!.hint).toBe('Did you mean "boxs"?')
  })
})
