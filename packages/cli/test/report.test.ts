import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { component, page, project, read, run, write } from './helpers'

const sample = () =>
  project(
    {
      'app/components/Card.tess': component(
        'Card',
        '.root {\n  padding: $space.3;\n  margin: raw(13px, "legacy modal spacing", "2027-03-01");\n  gap: raw(5px, "old grid", "2020-01-01");\n}',
      ),
      'app/components/Old.tess': component('Old', '.root { padding: 7px; }').replace(
        '"parts": ["root"]',
        '"parts": ["root"], "deprecated": "Use Card instead"',
      ),
      'app/components/Optional.tess': '<template><div class="root"></div></template>',
      'app/pages/index.tess': page('<Old />'),
      'app/pages/about.tess': page('<Old /><Old />'),
    },
    `contracts: 'optional', severity: [{ files: 'app/legacy/**', rules: 'T2102', level: 'warn', reason: 'old screens', expires: '2027-03-01' }]`,
  )

describe('tessera report --json', () => {
  it('measures tokenized versus hand-written declarations, in total and per directory', async () => {
    const root = sample()
    const { code, out } = await run(root, 'report', '--json')
    const report = JSON.parse(out)
    expect(code).toBe(0)
    // Card: padding is a token; the two raw() values are by hand. Old: padding 7px by hand.
    expect(report.styles.declarations).toBe(4)
    expect(report.styles.tokenized).toBe(1)
    expect(report.styles.raw).toBe(3)
    expect(report.styles.ratio).toBeCloseTo(0.25)
    expect(report.styles.byDirectory['app/components']).toMatchObject({
      declarations: 4,
      tokenized: 1,
    })
  })

  it('lists every raw() use with file, line, reason and expiry, flagging the expired', async () => {
    const root = project(
      {
        'app/components/Card.tess': component(
          'Card',
          '.root {\n  margin: raw(13px, "legacy modal spacing", "2099-03-01");\n  gap: raw(5px, "old grid", "2020-01-01");\n}',
        ),
      },
      '',
    )
    const report = JSON.parse((await run(root, 'report', '--json')).out)
    expect(report.rawEscapes).toEqual([
      expect.objectContaining({
        file: 'app/components/Card.tess',
        reason: 'legacy modal spacing',
        expires: '2099-03-01',
        expired: false,
      }),
      expect.objectContaining({ reason: 'old grid', expires: '2020-01-01', expired: true }),
    ])
    expect(report.rawEscapes[0].line).toBeGreaterThan(5)
  })

  it('lists severity exemptions with their expiry', async () => {
    const report = JSON.parse((await run(sample(), 'report', '--json')).out)
    expect(report.exemptions).toEqual([
      {
        files: ['app/legacy/**'],
        rules: ['T2102'],
        level: 'warn',
        reason: 'old screens',
        expires: '2027-03-01',
        expired: false,
      },
    ])
  })

  it('shows remaining baseline debt', async () => {
    const root = project({
      'app/components/Old.tess': component('Old', '.root { padding: 7px; margin: 5px; }'),
    })
    await run(root, 'baseline')
    const report = JSON.parse((await run(root, 'report', '--json')).out)
    expect(report.baseline).toEqual({ violations: 2, files: 1, byRule: { T2102: 2 } })
  })

  it('counts contract coverage, naming components without one', async () => {
    const report = JSON.parse((await run(sample(), 'report', '--json')).out)
    expect(report.contracts.components).toBe(3)
    expect(report.contracts.withContract).toBe(2)
    expect(report.contracts.withoutContract).toEqual(['app/components/Optional.tess'])
    expect(report.contracts.coverage).toBeCloseTo(2 / 3)
  })

  it('reports where generated accessibility suites exist, and where they do not', async () => {
    const root = sample()
    write(
      root,
      'app/components/a11y.browser.test.ts',
      "import { defineA11ySuites } from '@tessera/a11y'\ndefineA11ySuites({} as never)\n",
    )
    const report = JSON.parse((await run(root, 'report', '--json')).out)
    expect(report.a11y.generated.sort()).toEqual(['Card', 'Old'])
    expect(report.a11y.notGenerated).toEqual([])

    const without = JSON.parse((await run(sample(), 'report', '--json')).out)
    expect(without.a11y.generated).toEqual([])
    expect(without.a11y.notGenerated.sort()).toEqual(['Card', 'Old'])
  })

  it('lists who still uses a deprecated component', async () => {
    const report = JSON.parse((await run(sample(), 'report', '--json')).out)
    expect(report.deprecated).toEqual([
      {
        component: 'Old',
        message: 'Use Card instead',
        usages: [
          { file: 'app/pages/about.tess', count: 2 },
          { file: 'app/pages/index.tess', count: 1 },
        ],
      },
    ])
  })
})

describe('tessera report (text)', () => {
  it('prints a summary a person can read', async () => {
    const { code, out } = await run(sample(), 'report')
    expect(code).toBe(0)
    expect(out).toContain('Tessera report')
    expect(out).toContain('4 declarations: 1 use a token (25%), 3 write a value by hand')
    expect(out).toContain('raw() escapes: 2')
    expect(out).toContain('(EXPIRED)')
    expect(out).toContain('Contract coverage: 2/3 components (67%)')
    expect(out).toContain('Deprecated components in use: 1')
  })
})

describe('tessera tokens build', () => {
  it('writes the CSS, the types and the manifest', async () => {
    const root = project({ 'app/pages/index.tess': page() })
    const { code, out } = await run(root, 'tokens', 'build')
    expect(code).toBe(0)
    expect(out).toMatch(/Built \d+ tokens into \.tessera\/tokens/)
    const dir = join(root, '.tessera', 'tokens')
    expect(existsSync(join(dir, 'tokens.css'))).toBe(true)
    expect(read(root, '.tessera/tokens/tokens.css')).toContain('--t-space-4')
    expect(read(root, '.tessera/tokens/tokens.d.ts')).toContain('space')
    const manifest = JSON.parse(read(root, '.tessera/tokens/manifest.json'))
    expect(manifest.tokens.some((t: { path: string }) => t.path === 'space.4')).toBe(true)
  })

  it('writes where --out says', async () => {
    const root = project({ 'app/pages/index.tess': page() })
    await run(root, 'tokens', 'build', '--out', 'dist-tokens')
    expect(existsSync(join(root, 'dist-tokens', 'tokens.css'))).toBe(true)
  })

  it('exits 1 and prints the diagnostics when the tokens do not build', async () => {
    const root = project({ 'app/pages/index.tess': page() })
    write(
      root,
      'system/tokens/base.tokens.json',
      '{ "color": { "a": { "$type": "color", "$value": "{nope}" } } }',
    )
    write(root, 'tessera.config.ts', 'export default { tokens: "system/tokens" }\n')
    const { code, err } = await run(root, 'tokens', 'build')
    expect(code).toBe(1)
    expect(err).toMatch(/ERROR/)
  })

  it('says what to do for an unknown subcommand', async () => {
    const root = project({ 'app/pages/index.tess': page() })
    const { code, err } = await run(root, 'tokens', 'frob')
    expect(code).toBe(1)
    expect(err).toContain('Unknown tokens command "frob".')
  })
})
