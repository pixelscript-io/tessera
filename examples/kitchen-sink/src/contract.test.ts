import { expect, it } from 'vitest'
import { formatDiagnostic, generateTypes, parseContract } from '../../../packages/contract/src'

const counter = `{
  "name": "Counter",
  "role": "group",
  "parts": ["root", "button", "list"],
  "variants": { "tone": ["neutral", "primary"] },
  "slots": { "default": "heading" },
  "events": { "change": "fired when the count changes" }
}`

it('a kitchen-sink contract parses, generates types, and reports a seeded unknown variant field', () => {
  const ok = parseContract(counter, { file: 'examples/kitchen-sink/app/components/Counter.tess' })
  expect(ok.diagnostics).toEqual([])
  expect(generateTypes(ok.contract!)).toContain('tone?: "neutral" | "primary"')

  const seeded = parseContract(counter.replace('"variants"', '"varients"'), {
    file: 'Counter.tess',
  })
  expect(formatDiagnostic(seeded.diagnostics[0]!)).toContain('Did you mean "variants"?')
})
