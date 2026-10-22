import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ALL_CODES,
  CODE_GROUPS,
  EXPLANATIONS,
  explainText,
  runExample,
  type ExampleEnv,
} from '../src'
import { loadDesignTokens } from '../src/node'

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))

const loaded = loadDesignTokens(repo('system/tokens'))
if (!loaded.ok) throw new Error('the repository tokens do not build')
const env: ExampleEnv = {
  tokens: loaded.tokens,
  button: readFileSync(repo('system/components/Button.tess'), 'utf8'),
  link: readFileSync(repo('packages/router/components/Link.tess'), 'utf8'),
}

describe('the error registry', () => {
  it('explains every code, and only codes that exist', () => {
    expect(Object.keys(EXPLANATIONS).sort()).toEqual(Object.keys(ALL_CODES).sort())
  })

  it('puts every code in a group of the reference', () => {
    for (const code of Object.keys(ALL_CODES)) {
      expect(
        CODE_GROUPS.some((g) => g.test(code)),
        code,
      ).toBe(true)
    }
  })

  it.each(Object.keys(EXPLANATIONS).sort())('%s: its example produces the code', (code) => {
    const output = runExample(EXPLANATIONS[code]!.example, env)
    expect(output.codes, `${code} example produced ${JSON.stringify(output.codes)}`).toContain(code)
  })

  it.each(Object.keys(EXPLANATIONS).sort())('%s: has a cause and a fix to read', (code) => {
    const e = EXPLANATIONS[code]!
    expect(e.cause.length).toBeGreaterThan(20)
    expect(e.fix.length).toBeGreaterThan(10)
  })
})

describe('explainText', () => {
  it('prints the code, its title, cause, fix and example', () => {
    const text = explainText('t2102')!
    expect(text).toContain('T2102  Raw value off the token scale')
    expect(text).toContain('Cause')
    expect(text).toContain('Fix')
    expect(text).toContain('padding: 13px;')
    expect(text).toContain('Fixed')
  })

  it('knows nothing about a code that does not exist', () => {
    expect(explainText('T9999')).toBeUndefined()
  })
})
