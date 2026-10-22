import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildTokens } from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import {
  applyBaseline,
  applyFixes,
  applySeverity,
  countViolations,
  createBaseline,
  globToRegExp,
  pruneBaseline,
  resolveSeverity,
} from '../src/accountability'
import { compile } from '../src/compile'
import { resolveConfig, validateConfig, type TesseraConfig } from '../src/config'
import type { CompilerDiagnostic } from '../src/diagnostics'
import { StyleTokens } from '../src/style/tokens'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const tokens = StyleTokens.fromManifest(buildTokens(loadTokenDir(`${root}system/tokens`)).manifest!)
const legacy = (name: string) =>
  readFileSync(`${root}packages/compiler/test/fixtures/legacy/${name}`, 'utf8')

const TODAY = '2026-10-22'
const check = (source: string, file: string, config?: TesseraConfig, today = TODAY) =>
  compile(source, { file, kind: 'page', tokens, config, today })

const codes = (diagnostics: CompilerDiagnostic[]) => diagnostics.map((d) => d.code)

describe('adopting Tessera in a legacy codebase with a baseline', () => {
  const files = {
    'app/legacy/OldModal.tess': legacy('OldModal.tess'),
    'app/legacy/OldList.tess': legacy('OldList.tess'),
  }
  const run = (sources: Record<string, string> = files) =>
    Object.entries(sources).map(([file, source]) => ({
      file,
      diagnostics: check(source, file).diagnostics,
    }))

  it('the legacy fixture starts out failing', () => {
    const results = run()
    expect(codes(results[0]!.diagnostics.filter((d) => d.severity === 'error')).sort()).toEqual([
      'T2101',
      'T2102',
      'T2102',
      'T2102',
      'T2102',
      'T2104',
    ])
    expect(codes(results[1]!.diagnostics)).toEqual(['T2102', 'T2101'])
  })

  it('records per-file, per-rule counts', () => {
    expect(createBaseline(run())).toEqual({
      version: 1,
      files: {
        'app/legacy/OldModal.tess': { T2101: 1, T2102: 4, T2104: 1 },
        'app/legacy/OldList.tess': { T2101: 1, T2102: 1 },
      },
    })
  })

  it('passes with zero errors once the baseline is generated', () => {
    const baseline = createBaseline(run())
    for (const { file, diagnostics } of run()) {
      const result = applyBaseline(file, diagnostics, baseline)
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      expect(result.suppressed).toBeGreaterThan(0)
    }
  })

  it('fails on exactly one new violation', () => {
    const baseline = createBaseline(run())
    const worse = {
      ...files,
      'app/legacy/OldList.tess': files['app/legacy/OldList.tess'].replace(
        'gap: 11px;',
        'gap: 11px;\n  padding: 9px;',
      ),
    }
    const errors = run(worse).flatMap(({ file, diagnostics }) =>
      applyBaseline(file, diagnostics, baseline).diagnostics.filter((d) => d.severity === 'error'),
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'T2102', file: 'app/legacy/OldList.tess' })
    expect(errors[0]!.message).toContain('"9px" in "padding"')
  })

  it('fails on a new violation of a rule the file never had', () => {
    const baseline = createBaseline(run())
    const worse = {
      ...files,
      'app/legacy/OldList.tess': files['app/legacy/OldList.tess'].replace(
        'gap: 11px;',
        'gap: 11px;\n  fill: $color.typo.here;',
      ),
    }
    const errors = run(worse).flatMap(({ file, diagnostics }) =>
      applyBaseline(file, diagnostics, baseline).diagnostics.filter((d) => d.severity === 'error'),
    )
    expect(codes(errors)).toEqual(['T2104'])
  })

  it('does not let a fix in one place hide a new violation in another', () => {
    const baseline = createBaseline(run())
    // One old violation fixed, one new one added in the same file: the count is unchanged, so it passes
    // (the baseline tracks counts, not identities). Adding a second new one fails.
    const swapped = files['app/legacy/OldList.tess'].replace(
      'gap: 11px;',
      'gap: $space.4;\n  padding: 9px;',
    )
    const result = applyBaseline(
      'app/legacy/OldList.tess',
      check(swapped, 'app/legacy/OldList.tess').diagnostics,
      baseline,
    )
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const twice = swapped.replace('padding: 9px;', 'padding: 9px;\n  margin: 3px;')
    const worse = applyBaseline(
      'app/legacy/OldList.tess',
      check(twice, 'app/legacy/OldList.tess').diagnostics,
      baseline,
    )
    expect(worse.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(1)
  })

  it('reports improvements, and pruning lowers the counts so they can only go down', () => {
    const baseline = createBaseline(run())
    const better = {
      ...files,
      'app/legacy/OldModal.tess': files['app/legacy/OldModal.tess'].replace(
        'padding: 13px;',
        'padding: $space.4;',
      ),
    }
    const results = run(better)
    const modal = applyBaseline('app/legacy/OldModal.tess', results[0]!.diagnostics, baseline)
    expect(modal.improved).toEqual([{ code: 'T2102', recorded: 4, current: 3 }])

    const pruned = pruneBaseline(baseline, results)
    expect(pruned.files['app/legacy/OldModal.tess']).toEqual({ T2101: 1, T2102: 3, T2104: 1 })
    // Pruning never raises a count, even if there are more violations than recorded.
    const worse = {
      ...files,
      'app/legacy/OldList.tess': files['app/legacy/OldList.tess'].replace(
        'gap: 11px;',
        'gap: 11px; padding: 9px;',
      ),
    }
    expect(pruneBaseline(baseline, run(worse)).files['app/legacy/OldList.tess']).toEqual({
      T2101: 1,
      T2102: 1,
    })
    // A file with no violations left drops out entirely.
    const clean = {
      ...files,
      'app/legacy/OldList.tess': '<template><div class="a"></div></template>',
    }
    expect(pruneBaseline(baseline, run(clean)).files).not.toHaveProperty([
      'app/legacy/OldList.tess',
    ])
  })

  it('never absorbs anything that is not a style violation', () => {
    const baseline = { version: 1 as const, files: { 'a.tess': { T3005: 5, T4006: 5, T2110: 5 } } }
    const diagnostics = (['T3005', 'T4006', 'T2110'] as const).map((code): CompilerDiagnostic => ({
      code,
      severity: 'error',
      message: 'x',
      file: 'a.tess',
      line: 1,
      column: 1,
    }))
    expect(applyBaseline('a.tess', diagnostics, baseline).diagnostics).toHaveLength(3)
    expect(countViolations(diagnostics)).toEqual({})
  })

  it('treats windows and posix paths alike', () => {
    const baseline = createBaseline(run())
    const { file, diagnostics } = run()[1]!
    expect(applyBaseline('app\\legacy\\OldList.tess', diagnostics, baseline).suppressed).toBe(2)
    expect(file).toBe('app/legacy/OldList.tess')
  })
})

describe('severity per path, with reasons and expiry', () => {
  const diag = (code: string, severity: 'error' | 'warning' = 'error'): CompilerDiagnostic => ({
    code,
    severity,
    message: 'm',
    file: 'x',
    line: 1,
    column: 1,
  })
  const legacyRule = {
    files: 'app/legacy/**',
    rules: '*',
    level: 'warn' as const,
    reason: 'migrating to tokens',
    expires: '2027-03-01',
  }

  it('matches globs', () => {
    expect(globToRegExp('app/legacy/**').test('app/legacy/a/b/c.tess')).toBe(true)
    expect(globToRegExp('app/legacy/**').test('app/other/c.tess')).toBe(false)
    expect(globToRegExp('app/*.tess').test('app/a.tess')).toBe(true)
    expect(globToRegExp('app/*.tess').test('app/sub/a.tess')).toBe(false)
    expect(globToRegExp('**/legacy/*.tess').test('app/x/legacy/a.tess')).toBe(true)
    expect(globToRegExp('**/legacy/*.tess').test('legacy/a.tess')).toBe(true)
    expect(globToRegExp('a?.tess').test('ab.tess')).toBe(true)
    expect(globToRegExp('a.tess').test('aXtess')).toBe(false)
  })

  it('downgrades to a warning in the exempt path, and nowhere else', () => {
    const config: TesseraConfig = { severity: [legacyRule] }
    const out = applySeverity('app/legacy/Old.tess', [diag('T2102')], config, TODAY)
    expect(out[0]!.severity).toBe('warning')
    expect(applySeverity('app/new/Fresh.tess', [diag('T2102')], config, TODAY)[0]!.severity).toBe(
      'error',
    )
  })

  it('can switch a rule off, for one rule or all style violations', () => {
    const one: TesseraConfig = {
      severity: [{ files: '**', rules: 'T2102', level: 'off', reason: 'scale pending' }],
    }
    expect(
      applySeverity('a.tess', [diag('T2102'), diag('T2101')], one, TODAY).map((d) => d.code),
    ).toEqual(['T2101'])
    const all: TesseraConfig = {
      severity: [{ files: '**', rules: '*', level: 'off', reason: 'spike' }],
    }
    expect(applySeverity('a.tess', [diag('T2102'), diag('T2101')], all, TODAY)).toEqual([])
  })

  it('leaves contract, compiler and raw() errors alone, even under "*"', () => {
    const all: TesseraConfig = {
      severity: [{ files: '**', rules: '*', level: 'off', reason: 'spike' }],
    }
    const diagnostics = ['T3005', 'T4006', 'T2110', 'T2111'].map((c) => diag(c))
    expect(applySeverity('a.tess', diagnostics, all, TODAY)).toEqual(diagnostics)
  })

  it('the last matching setting wins', () => {
    const config: TesseraConfig = {
      severity: [legacyRule, { files: 'app/legacy/keep/**', rules: '*', level: 'error' }],
    }
    expect(
      applySeverity('app/legacy/keep/A.tess', [diag('T2102')], config, TODAY)[0]!.severity,
    ).toBe('error')
    expect(applySeverity('app/legacy/B.tess', [diag('T2102')], config, TODAY)[0]!.severity).toBe(
      'warning',
    )
  })

  it('reverts to error after the expiry date, and says why', () => {
    const config: TesseraConfig = { severity: [legacyRule] }
    expect(
      resolveSeverity('app/legacy/a.tess', 'T2102', resolveConfig(config), '2027-03-01'),
    ).toMatchObject({ level: 'warn', expired: false })
    const [d] = applySeverity(
      'app/legacy/a.tess',
      [{ ...diag('T2102'), hint: 'Use "$space.4".' }],
      config,
      '2027-03-02',
    )
    expect(d).toMatchObject({ severity: 'error' })
    expect(d!.hint).toBe(
      'Use "$space.4". The exemption for app/legacy/** expired on 2027-03-01: "migrating to tokens".',
    )
  })

  it('an expired exemption fails a real file', () => {
    const config: TesseraConfig = { severity: [legacyRule] }
    const source = legacy('OldList.tess')
    const during = applySeverity(
      'app/legacy/OldList.tess',
      check(source, 'app/legacy/OldList.tess', config).diagnostics,
      config,
      '2027-01-01',
    )
    expect(during.filter((d) => d.severity === 'error')).toEqual([])
    const after = applySeverity(
      'app/legacy/OldList.tess',
      check(source, 'app/legacy/OldList.tess', config, '2027-04-01').diagnostics,
      config,
      '2027-04-01',
    )
    expect(after.filter((d) => d.severity === 'error')).toHaveLength(2)
  })

  it('requires a reason to downgrade, and a real date', () => {
    expect(validateConfig({ severity: [{ files: 'a/**', rules: '*', level: 'warn' }] })).toEqual([
      {
        code: 'T2112',
        index: 0,
        message:
          'severity[0] (a/**) sets "warn" without a reason. Add a "reason" saying why this path is exempt.',
      },
    ])
    expect(
      validateConfig({ severity: [{ files: 'a/**', rules: '*', level: 'off', reason: ' ' }] }),
    ).toHaveLength(1)
    expect(validateConfig({ severity: [{ files: 'a/**', rules: '*', level: 'error' }] })).toEqual(
      [],
    )
    expect(
      validateConfig({
        severity: [
          { files: ['a/**', 'b/**'], rules: '*', level: 'warn', reason: 'r', expires: 'soon' },
        ],
      }),
    ).toEqual([
      {
        code: 'T2112',
        index: 0,
        message:
          'severity[0] (a/**, b/**) has expires "soon", which is not a date like "2027-03-01".',
      },
    ])
    expect(
      validateConfig({
        severity: [{ files: 'a', rules: '*', level: 'warn', reason: 'r', expires: '2027-02-30x' }],
      }),
    ).toHaveLength(1)
  })
})

describe('raw() with receipts, in a whole file', () => {
  const page = (css: string) =>
    `<template><div class="a"></div></template>\n<style>\n${css}\n</style>`

  it('an expired raw() fails the compile', () => {
    const source = page('.a { padding: raw(13px, "legacy modal spacing", "2027-03-01") }')
    expect(check(source, 'a.tess', undefined, '2027-02-01')).toMatchObject({ ok: true })
    const expired = check(source, 'a.tess', undefined, '2027-03-02')
    expect(expired.ok).toBe(false)
    expect(expired.diagnostics.map((d) => d.code)).toEqual(['T2110'])
    expect(expired.code).toBe('')
    expect(expired.css).toBe('')
  })

  it('a valid raw() compiles, warns, is counted, and its CSS is plain', () => {
    const result = check(page('.a { padding: raw(13px, "legacy modal spacing") }'), 'a.tess')
    expect(result.ok).toBe(true)
    expect(result.diagnostics.map((d) => d.code)).toEqual(['T2111'])
    expect(result.style!.escapes).toHaveLength(1)
    expect(result.css).toContain('padding: 13px')
  })
})

describe('autofix', () => {
  const page = (css: string) =>
    `<template><div class="a"></div></template>\n<style>\n${css}\n</style>`

  it('applies only unambiguous fixes, and a recompile shows them gone', () => {
    const source = page(
      '.a {\n  padding: 16px;\n  background: #1d4ed8;\n  border-color: $color.text.defalt;\n  margin: 13px;\n  gap: 11px;\n}',
    )
    const first = check(source, 'a.tess')
    expect(first.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(5)
    const fixed = applyFixes(source, first.diagnostics)
    // 16px, #2563eb and the token typo have one clear answer; 13px and 11px are off the scale.
    expect(fixed.applied).toBe(3)
    expect(fixed.source).toContain('padding: $space.4;')
    expect(fixed.source).toContain('background: $color.action.primary.bg-hover;')
    expect(fixed.source).toContain('border-color: $color.text.default;')
    expect(fixed.source).toContain('margin: 13px;')
    const second = check(fixed.source, 'a.tess')
    expect(second.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code)).toEqual([
      'T2102',
      'T2102',
    ])
    // Fixing again changes nothing.
    expect(applyFixes(fixed.source, second.diagnostics)).toMatchObject({
      applied: 0,
      source: fixed.source,
    })
  })

  it('a fixed file resolves to the same value in the default theme', () => {
    const before = check(page('.a { padding: 16px }'), 'a.tess')
    const after = check(
      applyFixes(page('.a { padding: 16px }'), before.diagnostics).source,
      'a.tess',
    )
    expect(after.diagnostics).toEqual([])
    expect(tokens.get('space.4')!.resolved.base).toBe('16px')
  })

  it('skips fixes that overlap', () => {
    const fixed = applyFixes('0123456789', [
      {
        code: 'x',
        severity: 'error',
        message: '',
        file: '',
        line: 1,
        column: 1,
        fix: { start: 2, end: 6, text: 'A' },
      },
      {
        code: 'x',
        severity: 'error',
        message: '',
        file: '',
        line: 1,
        column: 1,
        fix: { start: 4, end: 8, text: 'B' },
      },
    ])
    expect(fixed).toEqual({ source: '0123B89', applied: 1, skipped: 1 })
  })

  it('fixes nothing when no diagnostic carries a fix', () => {
    expect(applyFixes('abc', [])).toEqual({ source: 'abc', applied: 0, skipped: 0 })
  })
})
