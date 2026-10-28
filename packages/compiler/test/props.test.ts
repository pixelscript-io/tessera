import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { componentProps } from '../src'

const source = (script: string) =>
  `<contract>\n{ "name": "X", "role": "generic", "parts": ["root"] }\n</contract>\n<script>\n${script}\n</script>\n<template><div class="root"></div></template>\n`

describe('the props a component names', () => {
  it('reads each key and the kind of its default', () => {
    const props = componentProps(
      source(
        "const { checked, disabled, count, label, options, extra } = props({ checked: false, disabled: false, count: 3, label: 'Hi', options: [], extra: { a: 1 } })",
      ),
    )
    expect(props).toEqual([
      { name: 'checked', type: 'boolean', default: false },
      { name: 'disabled', type: 'boolean', default: false },
      { name: 'count', type: 'number', default: 3 },
      { name: 'label', type: 'string', default: 'Hi' },
      { name: 'options', type: 'array', default: [] },
      { name: 'extra', type: 'object', default: { a: 1 } },
    ])
  })

  it('reads negative numbers, templates without a hole, and lists of plain objects', () => {
    expect(
      componentProps(
        source(
          "const p = props({ offset: -4, text: `x`, rows: [{ id: 1, name: 'a' }], 'with-dash': 1 })",
        ),
      ),
    ).toEqual([
      { name: 'offset', type: 'number', default: -4 },
      { name: 'text', type: 'string', default: 'x' },
      { name: 'rows', type: 'array', default: [{ id: 1, name: 'a' }] },
      { name: 'with-dash', type: 'number', default: 1 },
    ])
  })

  it('says unknown for a default that is not a plain value, and for a shorthand', () => {
    expect(componentProps(source('const p = props({ now: Date.now(), size, ok: true })'))).toEqual([
      { name: 'now', type: 'unknown' },
      { name: 'size', type: 'unknown' },
      { name: 'ok', type: 'boolean', default: true },
    ])
  })

  it('reads a call with type arguments, and every call in the script', () => {
    expect(
      componentProps(
        source("const a = props<{ x: number }>({ x: 1 })\nconst b = props({ y: 'two', x: 9 })"),
      ),
    ).toEqual([
      { name: 'x', type: 'number', default: 1 },
      { name: 'y', type: 'string', default: 'two' },
    ])
  })

  it('has none when the script does not ask, when there is no script, or when it will not parse', () => {
    expect(componentProps(source('const a = 1'))).toEqual([])
    expect(componentProps('<template><div></div></template>')).toEqual([])
    expect(componentProps(source('const a = props({ x: })'))).toEqual([])
    expect(componentProps(source('const a = props()'))).toEqual([])
  })

  it('reads the design system components', () => {
    const read = (name: string) =>
      readFileSync(new URL(`../../../packages/ui/components/${name}.tess`, import.meta.url), 'utf8')
    expect(componentProps(read('Checkbox')).map((p) => p.name)).toEqual(['checked', 'disabled'])
    expect(componentProps(read('Combobox')).map((p) => p.name)).toEqual([
      'options',
      'value',
      'placeholder',
      'disabled',
      'invalid',
      'error',
    ])
    expect(componentProps(read('Dialog')).map((p) => [p.name, p.type])).toEqual([
      ['open', 'boolean'],
      ['persistent', 'boolean'],
    ])
  })
})
