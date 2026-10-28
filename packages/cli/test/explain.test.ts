import { describe, expect, it } from 'vitest'
import { run } from './helpers'

describe('tessera explain', () => {
  it('prints the cause, example and fix for a code', async () => {
    const { code, out } = await run('.', 'explain', 'T2102')
    expect(code).toBe(0)
    expect(out).toContain('T2102  Raw value off the token scale')
    expect(out).toContain('Cause')
    expect(out).toContain('Fix')
    expect(out).toContain('padding: 13px;')
  })

  it('accepts a lowercase code and works for tokens, contracts and warnings', async () => {
    for (const code of ['t1006', 'T3004', 'W4101', 'T6001']) {
      const { code: exit, out } = await run('.', 'explain', code)
      expect(exit).toBe(0)
      expect(out).toContain(code.toUpperCase())
    }
  })

  it('suggests the nearest code for a typo, and says what to do with no code', async () => {
    const typo = await run('.', 'explain', 'T2120')
    expect(typo.code).toBe(1)
    expect(typo.err).toContain('There is no error or warning code "T2120".')
    expect(typo.err).toContain('Did you mean')
    const none = await run('.', 'explain')
    expect(none.err).toContain('Say which code to explain.')
  })
})

describe('the command documentation', () => {
  it('has an entry for every command, so help and the CLI reference cannot lose one', async () => {
    const { COMMANDS_DOC } = await import('../src')
    const documented = new Set(COMMANDS_DOC.map((c) => c.name.split(' ')[0]))
    const { out } = await run('.', 'help')
    for (const name of [
      'init',
      'dev',
      'build',
      'preview',
      'check',
      'baseline',
      'report',
      'tokens',
      'new',
      'explain',
      'manifest',
      'mcp',
      'agent-files',
      'diff',
      'codemod',
      'format',
    ]) {
      expect(documented.has(name), name).toBe(true)
      expect(out).toContain(name)
    }
  })
})
