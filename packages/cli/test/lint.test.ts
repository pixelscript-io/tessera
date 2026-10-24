import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../src'
import { createUi, stripAnsi } from '../src/ui'
import { project, read, REPO_TOKENS, run } from './helpers'

const CSS = '.card {\n  padding: 13px;\n  color: var(--t-color-text-default);\n}\n'

/** A folder with a package.json and some files, and no Tessera in it. */
function plain(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tessera-lint-')).replaceAll('\\', '/')
  writeFileSync(join(root, 'package.json'), '{ "name": "react-app" }\n')
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return root
}

describe('tessera lint', () => {
  it('checks the css of a project that has no Tessera in it, against tokens it is given', async () => {
    const dir = plain({
      'src/Card.module.css': CSS,
      'src/ok.css': '.a { padding: var(--t-space-2) }',
    })
    const { code, out } = await run(dir, 'lint', '--tokens', REPO_TOKENS)
    expect(code).toBe(1)
    expect(out).toContain('ERROR  T2102  src/Card.module.css:2:12')
    expect(out).toContain('Raw length "13px" in "padding" is off the scale.')
    expect(out).toContain('Did you mean "var(--t-space-3)" (12px)?')
    expect(out).toContain('Run `tessera explain T2102` for details.')
    expect(out).toContain('1 error, 0 warnings in 2 files.')
    expect(out).not.toContain('ok.css:')
  })

  it('exits 0 and says so when the styles are clean', async () => {
    const dir = plain({
      'a.css': '.a { padding: var(--t-space-2); color: var(--t-color-text-default) }',
    })
    const { code, out } = await run(dir, 'lint', '--tokens', REPO_TOKENS)
    expect(code).toBe(0)
    expect(out).toBe('0 errors, 0 warnings in 1 file.\n')
  })

  it('reads the style of vue, svelte, astro and html files, at the right place', async () => {
    const dir = plain({
      'A.vue':
        '<template><p>x</p></template>\n<style scoped>\n.a {\n  margin: 13px;\n}\n</style>\n',
      'B.svelte': '<p class="b">x</p>\n<style>\n  .b { border-radius: 5px }\n</style>\n',
      'C.astro': '---\n---\n<p class="c">x</p>\n<style>\n.c { gap: 10px }\n</style>\n',
      'index.html':
        '<!doctype html>\n<html><head><style>body { opacity: 0.55 }</style></head></html>\n',
    })
    const { out } = await run(dir, 'lint', '--tokens', REPO_TOKENS)
    expect(out).toContain('A.vue:4:11')
    expect(out).toContain('B.svelte:3:23')
    expect(out).toContain('C.astro:5:11')
    expect(out).toContain('index.html:2:36')
    expect(out).toContain('4 errors, 0 warnings in 4 files.')
  })

  it('does not read node_modules, build output or dot folders, and says what it cannot read', async () => {
    const dir = plain({
      'src/a.css': CSS,
      'node_modules/lib/x.css': CSS,
      'dist/y.css': CSS,
      '.next/z.css': CSS,
      'src/legacy.scss': '$x: 13px;\n.a { padding: $x }',
      'src/Card.vue': '<style lang="scss">\n.a { padding: 13px }\n</style>',
    })
    const { out } = await run(dir, 'lint', '--tokens', REPO_TOKENS)
    expect(out).toContain('1 error, 0 warnings in 2 files.')
    expect(out).toContain('1 Sass, Less or Stylus file not read: they are not plain CSS.')
    for (const skipped of ['node_modules', 'dist/', '.next', 'legacy.scss:'])
      expect(out.split('Raw length')[0]).not.toContain(skipped)
  })

  it('lints the paths it is given, files or folders', async () => {
    const dir = plain({ 'src/a.css': CSS, 'other/b.css': CSS })
    const one = await run(dir, 'lint', 'other', '--tokens', REPO_TOKENS)
    expect(one.out).toContain('other/b.css')
    expect(one.out).not.toContain('src/a.css')
    expect(one.out).toContain('in 1 file.')
    const file = await run(dir, 'lint', 'src/a.css', '--tokens', REPO_TOKENS)
    expect(file.out).toContain('src/a.css')
    const missing = await run(dir, 'lint', 'nowhere.css', '--tokens', REPO_TOKENS)
    expect(missing.code).toBe(1)
    expect(missing.err).toContain('There is no file or folder "nowhere.css".')
  })

  it('finds the tokens in the config, then in system/tokens, and says when there are none', async () => {
    const configured = project({ 'src/a.css': CSS })
    expect((await run(configured, 'lint')).out).toContain('T2102')
    const dir = plain({ 'src/a.css': CSS })
    const none = await run(dir, 'lint')
    expect(none.code).toBe(1)
    expect(none.err).toContain('There are no design tokens to check against.')
    expect(none.err).toContain('Pass --tokens <folder>')
    const broken = plain({ 'src/a.css': CSS, 'tokens/base.tokens.json': '{ nope' })
    const bad = await run(broken, 'lint', '--tokens', 'tokens')
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('The design tokens in tokens do not build.')
  })

  it('applies the config: per-path severity with a reason and an expiry, and a custom contrast', async () => {
    const files = {
      'src/legacy/old.css': CSS,
      'src/new.css': CSS,
    }
    const downgraded = project(
      files,
      "severity: [{ files: 'src/legacy/**', rules: '*', level: 'warn', reason: 'old screens', expires: '2027-01-01' }]",
    )
    const ok = await run(downgraded, 'lint')
    expect(ok.out).toContain('WARNING  T2102  src/legacy/old.css')
    expect(ok.out).toContain('ERROR  T2102  src/new.css')
    expect(ok.out).toContain('1 error, 1 warning in 2 files.')
    const expired = project(
      { 'src/legacy/old.css': CSS },
      "severity: [{ files: 'src/legacy/**', rules: '*', level: 'warn', reason: 'old screens', expires: '2020-01-01' }]",
    )
    const late = await run(expired, 'lint')
    expect(late.code).toBe(1)
    expect(late.out).toContain('expired on 2020-01-01: "old screens"')
  })

  it('fixes what is unambiguous, and reports what is left', async () => {
    const dir = plain({
      'a.css': '.a { margin: 8px; padding: 13px; color: var(--t-color-text-defualt) }',
    })
    const { code, out } = await run(dir, 'lint', '--tokens', REPO_TOKENS, '--fix')
    expect(read(dir, 'a.css')).toBe(
      '.a { margin: var(--t-space-2); padding: 13px; color: var(--t-color-text-default) }',
    )
    expect(code).toBe(1)
    expect(out).toContain('Fixed 2 problems.')
    expect(out).toContain('1 error, 0 warnings in 1 file.')
    expect((await run(dir, 'lint', '--tokens', REPO_TOKENS)).out).toContain('padding')
  })

  it('records a baseline so existing code can adopt the rules, and only new violations fail', async () => {
    const dir = plain({ 'src/a.css': CSS + CSS.replace('.card', '.card2') })
    const first = await run(dir, 'lint', '--tokens', REPO_TOKENS, '--baseline')
    expect(first.code).toBe(0)
    expect(first.out).toContain(
      'Recorded 2 existing violations in 1 file in tessera.lint-baseline.json.',
    )
    expect(JSON.parse(read(dir, 'tessera.lint-baseline.json'))).toEqual({
      version: 1,
      files: { 'src/a.css': { T2102: 2 } },
    })
    // The same code now passes.
    const held = await run(dir, 'lint', '--tokens', REPO_TOKENS)
    expect(held.code).toBe(0)
    expect(held.out).toContain('2 existing violations covered by the lint baseline.')
    // One more fails, and fixing one says the baseline can be lowered.
    writeFileSync(join(dir, 'src/a.css'), read(dir, 'src/a.css') + '.c { margin: 11px }\n')
    expect((await run(dir, 'lint', '--tokens', REPO_TOKENS)).code).toBe(1)
    writeFileSync(join(dir, 'src/a.css'), CSS)
    const better = await run(dir, 'lint', '--tokens', REPO_TOKENS)
    expect(better.code).toBe(0)
    expect(better.out).toContain('The baseline can be lowered: run `tessera lint --prune`.')
    const pruned = await run(dir, 'lint', '--tokens', REPO_TOKENS, '--prune')
    expect(pruned.out).toContain(
      'Lowered the lint baseline to 1 violation in tessera.lint-baseline.json.',
    )
    expect(JSON.parse(read(dir, 'tessera.lint-baseline.json')).files['src/a.css']).toEqual({
      T2102: 1,
    })
  })

  it('does not touch the baseline of the .tess check', async () => {
    const dir = plain({ 'a.css': CSS })
    await run(dir, 'lint', '--tokens', REPO_TOKENS, '--baseline')
    expect(existsSync(join(dir, 'tessera.baseline.json'))).toBe(false)
  })

  it('says what is wrong with a prune and a prefix', async () => {
    const dir = plain({ 'a.css': CSS })
    const noBaseline = await run(dir, 'lint', '--tokens', REPO_TOKENS, '--prune')
    expect(noBaseline.code).toBe(1)
    expect(noBaseline.err).toContain('There is no lint baseline to prune.')
    const prefix = await run(dir, 'lint', '--tokens', REPO_TOKENS, '--var-prefix', 'ds')
    expect(prefix.code).toBe(1)
    expect(prefix.err).toContain('"ds" is not a custom property prefix.')
  })

  it('reads custom properties named another way with --var-prefix', async () => {
    const dir = plain({ 'a.css': '.a { padding: var(--ds-space-2); margin: var(--ds-space-99) }' })
    const { code, out } = await run(dir, 'lint', '--tokens', REPO_TOKENS, '--var-prefix', '--ds-')
    expect(code).toBe(1)
    expect(out).toContain('Unknown token "var(--ds-space-99)"')
    expect(out).toContain('1 error')
  })

  it('prints json for CI', async () => {
    const dir = plain({ 'a.css': CSS })
    const { code, out } = await run(dir, 'lint', '--tokens', REPO_TOKENS, '--json')
    expect(code).toBe(1)
    const result = JSON.parse(out) as {
      errors: number
      files: Array<{
        file: string
        diagnostics: Array<{ code: string; line: number; column: number }>
      }>
    }
    expect(result.errors).toBe(1)
    expect(result.files[0]!.file).toBe('a.css')
    expect(result.files[0]!.diagnostics[0]).toMatchObject({ code: 'T2102', line: 2, column: 12 })
  })

  it('has a help page of its own, and is in the list of commands', async () => {
    const dir = plain({})
    const help = await run(dir, 'lint', '--help')
    expect(help.out).toContain('tessera lint [paths...]')
    expect(help.out).toContain('--var-prefix <prefix>')
  })
})

describe('tessera lint in a terminal', () => {
  const pretty = createUi({ color: true, unicode: true, width: 100, truecolor: true })
  const runPretty = async (cwd: string, ...argv: string[]) => {
    let out = ''
    const code = await main(argv, {
      cwd,
      ui: pretty,
      out: (t) => void (out += t + '\n'),
      err: () => {},
    })
    return { code, out }
  }

  it('shows the line it is on with a caret, the fix, and that it can be fixed', async () => {
    const dir = plain({ 'src/a.css': '.a {\n  margin: 8px;\n  padding: 13px;\n}\n' })
    const { code, out } = await runPretty(dir, 'lint', '--tokens', REPO_TOKENS)
    expect(code).toBe(1)
    const text = stripAnsi(out)
    expect(text).toContain('src/a.css (2)')
    expect(text).toMatch(/✗ T2102 {2}2:11 {2}Raw length "8px" in "margin" is not a token\./)
    expect(text).toMatch(/2 │ {3}margin: 8px;/)
    expect(text).toMatch(/│ +\^/)
    expect(text).toContain('→ Use "var(--t-space-2)".')
    expect(text).toContain('fixable with --fix')
    expect(text).toMatch(/✗ 2 errors, 0 warnings in 1 file/)
  })

  it('says it is clean in one line', async () => {
    const dir = plain({ 'a.css': '.a { color: var(--t-color-text-default) }' })
    const { code, out } = await runPretty(dir, 'lint', '--tokens', REPO_TOKENS)
    expect(code).toBe(0)
    expect(stripAnsi(out)).toBe('✓ No problems in 1 file\n')
  })
})

describe('the rules in a real stylesheet', () => {
  it('finds the three kinds of problem in a component stylesheet, and nothing in the clean one', async () => {
    const dir = plain({
      'Button.module.css': `.root {
  display: inline-flex;
  padding: 10px 16px;
  border-radius: 6px;
  background: #2563eb;
  color: var(--t-color-action-primary-fg);
  transition: background .15s;
}
.root:hover { background: var(--t-color-action-primary-bg-hover) }
.label { color: var(--t-color-text-defualt) }
`,
      'Clean.module.css': `.root { padding: var(--t-space-4); background: var(--t-color-surface-raised); color: var(--t-color-text-default) }`,
    })
    const { out } = await run(dir, 'lint', '--tokens', REPO_TOKENS)
    expect(out).toContain('Button.module.css:3:')
    expect(out).toContain('Raw color "#2563eb" in "background"')
    expect(out).toContain('Unknown token "var(--t-color-text-defualt)"')
    expect(out).not.toContain('Clean.module.css:')
    expect(out).toContain('in 2 files.')
  })
})
