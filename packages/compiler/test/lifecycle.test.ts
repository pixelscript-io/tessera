import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Project } from '../src/project-entry'

const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

const dim = (value: number, extra: object = {}) => ({
  $type: 'dimension',
  $value: { value, unit: 'px' },
  ...extra,
})

/** A project on disk with these files and these tokens. */
function project(files: Record<string, string>, tokens: object = { space: { '1': dim(4) } }) {
  const root = mkdtempSync(join(tmpdir(), 'tessera-lifecycle-'))
  made.push(root)
  const put = (file: string, content: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  put('tokens/base.tokens.json', JSON.stringify(tokens))
  for (const [file, content] of Object.entries(files)) put(file, content)
  return new Project(root, { tokens: join(root, 'tokens'), today: '2026-10-22' })
}

const compile = (p: Project, file: string, source: string) =>
  p.compileFile(join(p.root, file), source, { baseline: null }).raw.map((d) => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
    hint: d.hint,
  }))

const card = (extra: string, variants = '["calm", "loud"]') => `<contract>
{ "name": "Card", "role": "group", "parts": ["root"], "variants": { "tone": ${variants} }${extra} }
</contract>
<template><div class="root"></div></template>
`
const page = (body: string) => `<template><main>${body}</main></template>\n`

describe('a deprecated component', () => {
  const p = project({
    'app/components/Card.tess': card(', "deprecated": "Use Panel instead."'),
  })

  it('warns where it is used, with the reason', () => {
    expect(compile(p, 'app/pages/about.tess', page('<Card />'))).toEqual([
      {
        code: 'W4103',
        severity: 'warning',
        message: '<Card> is deprecated: Use Panel instead.',
        hint: undefined,
      },
    ])
  })

  it('still works: nothing is an error', () => {
    expect(
      compile(p, 'app/pages/about.tess', page('<Card />')).filter((d) => d.severity === 'error'),
    ).toEqual([])
  })
})

describe('a component that was renamed', () => {
  const p = project({
    'app/components/Panel.tess': card(', "renamedFrom": "Card"').replace('"Card"', '"Panel"'),
  })

  it('says what the old name became, and how to update', () => {
    // The contract's own name is Panel; the use below still says Card.
    expect(compile(p, 'app/pages/about.tess', page('<Card />'))).toEqual([
      {
        code: 'T4007',
        severity: 'error',
        message: 'Unknown component <Card>.',
        hint: '<Card> was renamed to <Panel>. Run `tessera codemod` to update every use.',
      },
    ])
  })
})

describe('variant values', () => {
  const p = project({
    'app/components/Card.tess': card(
      ', "deprecatedValues": { "tone": { "loud": "Use calm." } }, "renamedValues": { "tone": { "shouty": "loud" } }',
    ),
  })

  it('warns about a deprecated value, with the reason', () => {
    expect(compile(p, 'app/pages/about.tess', page('<Card tone="loud" />'))).toEqual([
      {
        code: 'W4104',
        severity: 'warning',
        message: 'Card.tone "loud" is deprecated: Use calm.',
        hint: undefined,
      },
    ])
  })

  it('says a removed value was renamed, and to what', () => {
    expect(compile(p, 'app/pages/about.tess', page('<Card tone="shouty" />'))).toEqual([
      {
        code: 'T4008',
        severity: 'error',
        message: 'Card.tone has no value "shouty".',
        hint: '"shouty" was renamed to "loud". Run `tessera codemod` to update every use.',
      },
    ])
  })

  it('leaves a current value alone', () => {
    expect(compile(p, 'app/pages/about.tess', page('<Card tone="calm" />'))).toEqual([])
  })
})

describe('deprecated and renamed tokens', () => {
  const tokens = {
    space: {
      $type: 'dimension',
      '1': dim(4),
      '2': dim(8, { $extensions: { tessera: { deprecated: 'Use $space.3.' } } }),
      '3': dim(12, { $extensions: { tessera: { renamedFrom: 'space.medium' } } }),
    },
  }
  const p = project(
    { 'app/components/Box.tess': card('').replace('Card', 'Box').replace('  \n', '') },
    tokens,
  )
  const box = (css: string) =>
    `<contract>\n{ "name": "Box", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root"></div></template>\n<style>\n.root { padding: ${css}; }\n</style>\n`

  it('warns about a deprecated token, with the reason', () => {
    expect(
      compile(p, 'app/components/Box.tess', box('$space.2')).filter((d) => d.code === 'T2113'),
    ).toEqual([
      {
        code: 'T2113',
        severity: 'warning',
        message: '"$space.2" is deprecated: Use $space.3.',
        hint: undefined,
      },
    ])
  })

  it('says a removed token was renamed, and does not autofix it', () => {
    const [issue] = p.compileFile(join(p.root, 'app/components/Box.tess'), box('$space.medium'), {
      baseline: null,
    }).raw
    expect(issue).toMatchObject({
      code: 'T2104',
      message: 'Unknown token "$space.medium"',
      hint: '"$space.medium" was renamed to "$space.3".',
    })
    expect(issue!.fix).toBeUndefined()
  })
})

describe('the contract', () => {
  const parse = (extra: string) =>
    compile(project({}), 'app/components/Card.tess', card(extra)).filter((d) => d.code === 'T3014')

  it('rejects a deprecated value the component does not have', () => {
    expect(parse(', "deprecatedValues": { "tone": { "gone": "x" } }')[0]!.message).toBe(
      '"gone" is deprecated but is not a value of tone. A deprecated value is still allowed; to remove one, use "renamedValues".',
    )
  })

  it('rejects a rename whose old value is still allowed, or whose new value does not exist', () => {
    expect(parse(', "renamedValues": { "tone": { "calm": "loud" } }')[0]!.message).toBe(
      '"calm" is listed as renamed but is still a value of tone. Remove it from "variants" once it is renamed.',
    )
    expect(parse(', "renamedValues": { "tone": { "old": "nope" } }')[0]!.message).toBe(
      '"old" was renamed to "nope", which is not a value of tone.',
    )
  })

  it('rejects a variant the component does not have', () => {
    expect(parse(', "renamedValues": { "size": { "a": "b" } }')[0]!.message).toBe(
      '"renamedValues" names the variant "size", which this component does not have.',
    )
  })
})
