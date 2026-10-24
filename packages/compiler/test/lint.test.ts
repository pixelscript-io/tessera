import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildTokens } from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import { applyFixes, lintKind, lintSource, styleBlocks } from '../src'
import { StyleTokens } from '../src/style/tokens'

const tokenDir = fileURLToPath(new URL('../../../system/tokens', import.meta.url))
const tokens = StyleTokens.fromManifest(buildTokens(loadTokenDir(tokenDir)).manifest!)

const lint = (file: string, source: string, options: { varPrefix?: string } = {}) =>
  lintSource(file, source, { tokens, today: '2026-10-24', ...options })
const summary = (file: string, source: string) =>
  lint(file, source).diagnostics.map(
    (d) =>
      `${d.code} ${d.line}:${d.column} ${d.severity === 'warning' ? 'warn ' : ''}${d.message}${d.hint ? ` | ${d.hint}` : ''}`,
  )

describe('which files have styles to check', () => {
  it('reads css, and markup that holds a style element, and says what it cannot read', () => {
    expect(lintKind('a/b.css')).toBe('css')
    expect(lintKind('a/Card.vue')).toBe('markup')
    expect(lintKind('a/Card.svelte')).toBe('markup')
    expect(lintKind('index.html')).toBe('markup')
    expect(lintKind('a.astro')).toBe('markup')
    expect(lintKind('a.scss')).toBe('unsupported')
    expect(lintKind('a.less')).toBe('unsupported')
    expect(lintKind('a.ts')).toBeUndefined()
  })

  it('finds each style element, where its content starts, and skips another language', () => {
    const source =
      '<template><p>x</p></template>\n<style scoped>\n.a { color: red }\n</style>\n<style lang="scss">\n$x: 1;\n</style>\n<style lang="postcss">\n.b {}\n</style>\n'
    const { blocks, skipped } = styleBlocks('Card.vue', source)
    expect(skipped).toBe(1)
    expect(blocks.map((b) => b.content.trim())).toEqual(['.a { color: red }', '.b {}'])
    for (const b of blocks)
      expect(source.slice(b.start, b.start + b.content.length)).toBe(b.content)
  })
})

describe('raw values in plain css', () => {
  it('names the token as the css writes it, with the nearest on the scale', () => {
    expect(summary('a.css', '.a {\n  padding: 13px;\n}\n')).toEqual([
      'T2102 2:12 Raw length "13px" in "padding" is off the scale. | Did you mean "var(--t-space-3)" (12px)?',
    ])
  })

  it('says which token an exact value is, and offers it as a fix', () => {
    const { diagnostics } = lint('a.css', '.a { margin: 8px; }')
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Raw length "8px" in "margin" is not a token.',
    ])
    expect(diagnostics[0]!.hint).toBe('Use "var(--t-space-2)".')
    expect(diagnostics[0]!.fix).toEqual({ start: 13, end: 16, text: 'var(--t-space-2)' })
    expect(applyFixes('.a { margin: 8px; }', diagnostics).source).toBe(
      '.a { margin: var(--t-space-2); }',
    )
  })

  it('has no way out inside the file: no raw(), only the config', () => {
    for (const text of summary('a.css', '.a { padding: 13px; color: #123456; font-size: 40px }'))
      expect(text).not.toContain('raw(')
  })

  it('accepts tokens, zero, and what is not governed', () => {
    expect(
      summary(
        'a.css',
        `.a {
  padding: 0 var(--t-space-2);
  margin: 0 auto;
  color: var(--t-color-text-default);
  border-radius: var(--t-radius-md);
  transition-duration: var(--t-motion-duration-fast);
  z-index: 10;
  width: 320px;
  display: flex;
}`,
      ),
    ).toEqual([])
  })

  it('checks colors: a raw one is named, an exact match is fixed, a named color is caught', () => {
    const diagnostics = lint(
      'a.css',
      '.a { color: #ffffff; background: red; border: 1px solid #fff }',
    ).diagnostics
    expect(diagnostics.map((d) => d.code)).toEqual(['T2101', 'T2101', 'T2101'])
    expect(diagnostics[0]!.message).toBe('Raw color "#ffffff" in "color" is not a token.')
    expect(diagnostics[0]!.hint).toMatch(/^Use "var\(--t-color-surface-default\)"|^Use one of: /)
    expect(diagnostics[0]!.hint).not.toContain('raw(')
  })

  it('goes into calc and a custom property’s fallback, and leaves other custom properties alone', () => {
    expect(
      summary('a.css', '.a { width: calc(100% - 20px); padding: var(--local, 13px) }'),
    ).toEqual([expect.stringContaining('Raw length "13px" in "padding"')])
    expect(summary('a.css', ':root { --gap: 13px } .a { padding: var(--gap) }')).toEqual([])
  })
})

describe('tokens named as custom properties', () => {
  it('finds a typo among the custom properties, and fixes it when one is clearly meant', () => {
    const { diagnostics } = lint(
      'a.css',
      '.a { padding: var(--t-space-9); color: var(--t-color-text-defualt) }',
    )
    expect(diagnostics.map((d) => [d.code, d.message])).toEqual([
      ['T2104', 'Unknown token "var(--t-space-9)"'],
      ['T2104', 'Unknown token "var(--t-color-text-defualt)"'],
    ])
    expect(diagnostics[1]!.hint).toBe('Did you mean "var(--t-color-text-default)"?')
    expect(diagnostics[1]!.fix?.text).toBe('var(--t-color-text-default)')
  })

  it('says when a token is the wrong kind for the property', () => {
    expect(summary('a.css', '.a { padding: var(--t-color-text-default) }')).toEqual([
      expect.stringContaining('T2103 1:'),
    ])
    expect(summary('a.css', '.a { padding: var(--t-color-text-default) }')[0]).toContain(
      '"padding" takes dimension tokens from "space", but "var(--t-color-text-default)" is a color token.',
    )
  })

  it('warns about a primitive used directly', () => {
    expect(summary('a.css', '.a { color: var(--t-color-neutral-900) }')).toEqual([
      expect.stringMatching(
        /^T2105 1:\d+ warn "var\(--t-color-neutral-900\)" is a primitive token\. Styles should use semantic tokens\./,
      ),
    ])
  })

  it('reads the custom properties of a project that names them its own way', () => {
    const own = tokens.withVarPrefix('--ds-')
    expect(own.get('space.2')!.cssVar).toBe('--ds-space-2')
    expect(
      lint('a.css', '.a { padding: var(--ds-space-2); margin: var(--ds-space-99) }', {
        varPrefix: '--ds-',
      }).diagnostics.map((d) => d.message),
    ).toEqual(['Unknown token "var(--ds-space-99)"'])
    // With the default prefix those are not tokens at all.
    expect(summary('a.css', '.a { padding: var(--ds-space-2) }')).toEqual([])
  })
})

describe('contrast in plain css', () => {
  it('checks a text and a background token on one class, in every theme', () => {
    const out = summary(
      'a.css',
      '.card {\n  color: var(--t-color-surface-default);\n  background: var(--t-color-surface-raised);\n}\n',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(
      /^T2107 3:\d+ Contrast between "var\(--t-color-surface-default\)" and "var\(--t-color-surface-raised\)" is too low: \d\.\d:1 in the default theme/,
    )
  })

  it('passes a pair that has enough, and merges a state’s rule with the base', () => {
    expect(
      summary(
        'a.css',
        '.a { color: var(--t-color-text-default); background: var(--t-color-surface-default) }\n.a:hover { background: var(--t-color-surface-hover) }',
      ),
    ).toEqual([])
  })
})

describe('where problems are reported', () => {
  it('has the line and column in the file, for css and for a style element in markup', () => {
    const vue =
      '<template><div class="a"></div></template>\n<style>\n.a {\n  padding: 13px;\n}\n</style>\n'
    const out = lint('Card.vue', vue).diagnostics
    expect(out).toHaveLength(1)
    expect([out[0]!.line, out[0]!.column]).toEqual([4, 12])
    expect(vue.split('\n')[3]!.slice(11, 15)).toBe('13px')
    // A fix reaches the right place in the whole file.
    const exact = vue.replace('13px', '8px')
    expect(applyFixes(exact, lint('Card.vue', exact).diagnostics).source).toContain(
      'padding: var(--t-space-2);',
    )
  })

  it('counts a style element in another language, and reads nothing in it', () => {
    const result = lint('Card.vue', '<style lang="scss">\n.a { padding: 13px }\n</style>')
    expect(result.diagnostics).toEqual([])
    expect(result.skipped).toBe(1)
  })
})

describe('css as it is written in the world', () => {
  it('reads a stylesheet with imports, fonts, keyframes, queries and vendor prefixes without a parse error', () => {
    const css = `@charset "utf-8";
@import url("https://fonts.example/css?family=Inter:400,700");
@font-face { font-family: "Inter"; src: url(inter.woff2) format("woff2"); font-display: swap }
:root { --brand: #3366ff; --gap: 16px; }
*, *::before, *::after { box-sizing: border-box }
html { -webkit-text-size-adjust: 100%; font: 16px/1.5 "Helvetica Neue", Arial, sans-serif }
a:not([href]):not([tabindex]):focus { outline: 0 }
input[type="checkbox" i]::after { content: "\\201C"; }
.grid { display: grid; grid-template-areas: "head head" "side main"; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)) }
.hero { background: url(a.png) no-repeat center / cover; min-height: calc(100vh - 56px) }
@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
@media (min-width: 768px) and (prefers-reduced-motion: no-preference) { .nav { display: flex } }
@supports (display: grid) { .grid { gap: var(--gap) } }
.btn { transition: all .2s ease-in-out; padding: 10px 14px; box-shadow: 0 1px 2px rgba(0,0,0,.2) !important }
`
    const out = lint('site.css', css).diagnostics
    expect(out.filter((d) => d.code === 'T2106')).toEqual([])
    // It does find the values that are off the scale, and nothing it should not.
    expect(out.some((d) => d.code === 'T2102')).toBe(true)
  })
})
