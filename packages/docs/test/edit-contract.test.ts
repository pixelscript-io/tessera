import { describe, expect, it } from 'vitest'
import { parseContract } from '@tessera/contract'
import { editContract, OpError, type ContractOp } from '../src/edit/contract-ops'

// A contract the way people write them: JSONC, comments, a mix of inline and multi-line.
const CONTRACT = `
{
  "name": "Button",
  "role": "button",
  "description": "Triggers an action.", // what it is for
  "since": "0.1.0",
  "parts": ["root", "label"],
  "variants": {
    "tone": ["primary", "neutral", "danger"], // first value is the default
    "size": ["sm", "md"]
  },
  "states": ["hover", "disabled"],
  "slots": {
    "default": "label content"
  },
  "events": { "press": "fired on click" }
}
`

const edit = (op: ContractOp, text = CONTRACT) => editContract(text, op)
const valid = (text: string) => {
  const parsed = parseContract(text, { file: 'Button.tess' })
  expect(parsed.diagnostics.map((d) => d.message)).toEqual([])
  return parsed.contract!
}

describe('editing a contract with the smallest change', () => {
  it('changes a description and leaves every other character alone', () => {
    const out = edit({ kind: 'description', value: 'Starts something.' })
    expect(out).toBe(CONTRACT.replace('"Triggers an action."', '"Starts something."'))
    expect(valid(out).description).toBe('Starts something.')
  })

  it('adds a missing field after the last one, matching the layout, and removes one cleanly', () => {
    const added = edit({ kind: 'deprecated', value: 'Use Action instead.' })
    expect(added).toContain(
      '  "events": { "press": "fired on click" },\n  "deprecated": "Use Action instead."\n}',
    )
    expect(valid(added).deprecated).toBe('Use Action instead.')
    const removed = edit({ kind: 'deprecated', value: null }, added)
    expect(removed).toBe(CONTRACT)
    // A field in the middle comes out with its line.
    const noSince = edit({ kind: 'since', value: '' })
    expect(noSince).not.toContain('since')
    expect(noSince).toContain('"description": "Triggers an action.", // what it is for\n  "parts"')
    valid(noSince)
  })

  it('keeps a comment that sits beside the last field when a field is added', () => {
    const text =
      '{\n  "name": "A", // the name\n  "role": "group",\n  "parts": ["root"] // anatomy\n}\n'
    const out = editContract(text, { kind: 'description', value: 'x' })
    expect(out).toBe(
      '{\n  "name": "A", // the name\n  "role": "group",\n  "parts": ["root"], // anatomy\n  "description": "x"\n}\n',
    )
  })

  it('adds a value to an inline array, and a variant with its values', () => {
    const out = edit({ kind: 'addValue', variant: 'size', value: 'lg' })
    expect(out).toContain('"size": ["sm", "md", "lg"]')
    const withVariant = edit({
      kind: 'addVariant',
      variant: 'emphasis',
      values: ['solid', 'ghost'],
    })
    expect(withVariant).toContain('"size": ["sm", "md"],\n    "emphasis": ["solid", "ghost"]\n  },')
    expect(valid(withVariant).variants['emphasis']).toEqual(['solid', 'ghost'])
  })

  it('adds a value to a multi-line array', () => {
    const text =
      '{\n  "name": "A",\n  "role": "group",\n  "parts": ["root"],\n  "variants": {\n    "tone": [\n      "a", // default\n      "b"\n    ]\n  }\n}\n'
    const out = editContract(text, { kind: 'addValue', variant: 'tone', value: 'c' })
    expect(out).toContain('"b",\n      "c"\n    ]')
    expect(out).toContain('"a", // default')
  })

  it('makes another value the default, moving no comment', () => {
    const out = edit({ kind: 'setDefault', variant: 'tone', value: 'danger' })
    expect(out).toContain('"tone": ["danger", "primary", "neutral"], // first value is the default')
    expect(valid(out).variants['tone']).toEqual(['danger', 'primary', 'neutral'])
  })

  it('renames a value in place and records it for the codemod', () => {
    const out = edit({ kind: 'renameValue', variant: 'tone', from: 'danger', to: 'destructive' })
    expect(out).toContain(
      '"tone": ["primary", "neutral", "destructive"], // first value is the default',
    )
    expect(out).toContain('"renamedValues": { "tone": { "danger": "destructive" } }')
    const contract = valid(out)
    expect(contract.renamedValues).toEqual({ tone: { danger: 'destructive' } })
    expect(contract.variants['tone']).not.toContain('danger')
  })

  it('points an earlier rename at the newest name, and carries a deprecation to it', () => {
    const first = edit({ kind: 'renameValue', variant: 'tone', from: 'danger', to: 'destructive' })
    const withWhy = edit(
      { kind: 'deprecateValue', variant: 'tone', value: 'destructive', message: 'Use primary.' },
      first,
    )
    expect(valid(withWhy).deprecatedValues).toEqual({ tone: { destructive: 'Use primary.' } })
    const second = edit(
      { kind: 'renameValue', variant: 'tone', from: 'destructive', to: 'critical' },
      withWhy,
    )
    const contract = valid(second)
    expect(contract.renamedValues).toEqual({
      tone: { danger: 'critical', destructive: 'critical' },
    })
    expect(contract.deprecatedValues).toEqual({ tone: { critical: 'Use primary.' } })
  })

  it('deprecates a value, and removes the deprecation and the empty objects it leaves', () => {
    const out = edit({ kind: 'deprecateValue', variant: 'size', value: 'md', message: 'Use sm.' })
    expect(valid(out).deprecatedValues).toEqual({ size: { md: 'Use sm.' } })
    const back = edit({ kind: 'deprecateValue', variant: 'size', value: 'md', message: null }, out)
    expect(back).toBe(CONTRACT)
  })

  it('removes a value, and its deprecation', () => {
    const out = edit({ kind: 'removeValue', variant: 'tone', value: 'neutral' })
    expect(out).toContain('"tone": ["primary", "danger"], // first value is the default')
    valid(out)
    expect(edit({ kind: 'removeValue', variant: 'tone', value: 'danger' })).toContain(
      '"tone": ["primary", "neutral"], // first value',
    )
  })

  it('adds and edits slots and events', () => {
    const slot = edit({ kind: 'slot', name: 'icon', description: 'a leading icon' })
    expect(slot).toContain('"default": "label content",\n    "icon": "a leading icon"\n  },')
    expect(valid(slot).slots).toEqual({ default: 'label content', icon: 'a leading icon' })
    const event = edit({ kind: 'event', name: 'press', description: 'pressed' })
    expect(event).toContain('"events": { "press": "pressed" }')
  })

  it('says why a change cannot be made, in a sentence', () => {
    const message = (op: ContractOp) => {
      try {
        edit(op)
      } catch (e) {
        expect(e).toBeInstanceOf(OpError)
        return (e as Error).message
      }
      return 'no error'
    }
    expect(message({ kind: 'addValue', variant: 'nope', value: 'x' })).toBe(
      'nope is not a variant of this component. Its variants: tone, size.',
    )
    expect(message({ kind: 'addValue', variant: 'size', value: 'sm' })).toBe(
      'size already has the value "sm".',
    )
    expect(message({ kind: 'renameValue', variant: 'size', from: 'xx', to: 'y' })).toBe(
      'size has no value "xx".',
    )
    expect(message({ kind: 'renameValue', variant: 'size', from: 'sm', to: 'md' })).toBe(
      'size already has the value "md".',
    )
    expect(message({ kind: 'setDefault', variant: 'tone', value: 'primary' })).toBe(
      '"primary" is already the default of tone.',
    )
    expect(message({ kind: 'addVariant', variant: 'size', values: ['a'] })).toBe(
      'size is already a variant of this component.',
    )
    expect(message({ kind: 'addVariant', variant: 'x', values: [] })).toBe(
      'A variant needs at least one value. The first is the default.',
    )
  })

  it('creates the objects it needs in a contract that has none of them', () => {
    const text =
      '{ "name": "A", "role": "group", "parts": ["root"], "variants": { "tone": ["a", "b"] } }'
    const out = editContract(text, { kind: 'renameValue', variant: 'tone', from: 'a', to: 'c' })
    expect(out).toBe(
      '{ "name": "A", "role": "group", "parts": ["root"], "variants": { "tone": ["c", "b"] }, "renamedValues": { "tone": { "a": "c" } } }',
    )
  })
})
