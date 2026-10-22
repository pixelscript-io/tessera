import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { buildTokens } from '../src'
import { loadTokenDir } from '../src/node'

const dir = fileURLToPath(new URL('../../../system/tokens', import.meta.url))

describe('the system token set', () => {
  const result = buildTokens(loadTokenDir(dir))

  it('builds with no diagnostics', () => {
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('emits a layered stylesheet with base, dark, auto and compact blocks', () => {
    expect(result.css).toContain('@layer tessera.tokens {')
    expect(result.css).toContain(':where(:root) {')
    expect(result.css).toContain('--t-color-action-primary-bg: var(--t-color-blue-600);')
    expect(result.css).toContain('[data-theme="dark"] {')
    expect(result.css).toContain('@media (prefers-color-scheme: dark) {')
    expect(result.css).toContain('[data-density="compact"] {')
  })

  it('reports tiers for the three layers', () => {
    const tier = (p: string) => result.manifest!.tokens.find((t) => t.path === p)!.tier
    expect(tier('color.blue.600')).toBe('primitive')
    expect(tier('color.action.primary.bg')).toBe('semantic')
  })
})
