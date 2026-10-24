import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildTokens } from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import { resolveConfig, type TesseraConfig } from '../src/config'
import { processStyle } from '../src/style/enforce'
import { StyleTokens } from '../src/style/tokens'

const tokenDir = fileURLToPath(new URL('../../../system/tokens', import.meta.url))
const built = buildTokens(loadTokenDir(tokenDir))
const tokens = StyleTokens.fromManifest(built.manifest!)

interface Options {
  config?: TesseraConfig
  today?: string
  withTokens?: boolean
  prefix?: string
}

/** Run enforcement on one rule body and return `code line? message | hint` strings for the issues. */
function run(css: string, options: Options = {}) {
  const result = processStyle({
    css,
    base: 0,
    tokens: options.withTokens === false ? undefined : tokens,
    config: resolveConfig(options.config),
    prefix: options.prefix ?? 't-X__',
    today: options.today ?? '2026-10-22',
  })
  const issues = result.issues.map(
    (i) =>
      `${i.code} ${i.severity === 'warning' ? 'warn ' : ''}${i.message}${i.hint ? ` | ${i.hint}` : ''}`,
  )
  return { ...result, summary: issues }
}

const decl = (declarations: string) => `.a { ${declarations} }`

describe('table row: $token that exists', () => {
  it('is accepted and becomes a var() reference', () => {
    const r = run(
      decl('padding: $space.2 $space.4; color: $color.text.default; opacity: $opacity.disabled'),
    )
    expect(r.summary).toEqual([])
    expect(r.css).toBe(
      '@layer tessera.components {\n.t-X__a { padding: var(--t-space-2) var(--t-space-4); color: var(--t-color-text-default); opacity: var(--t-opacity-disabled) }\n}\n',
    )
  })

  it('works in any property, including ungoverned ones', () => {
    expect(run(decl('z-index: $space.4')).summary).toEqual([])
  })
})

describe('table row: $token that does not exist', () => {
  it('is an error with the nearest match, in the spec wording', () => {
    const r = run(decl('background: $color.action.primry.bg'))
    expect(r.summary).toEqual([
      'T2104 Unknown token "$color.action.primry.bg" | Did you mean "$color.action.primary.bg"?',
    ])
  })

  it('offers an autofix only when exactly one token is a plausible typo', () => {
    const typo = run(decl('background: $color.action.primry.bg')).issues[0]!
    expect(typo.fix).toEqual({ start: 17, end: 40, text: '$color.action.primary.bg' })
    // Two tokens are one edit away from "space.7" (space.6 and space.8): ambiguous.
    const ambiguous = run(decl('padding: $space.7')).issues[0]!
    expect(ambiguous.code).toBe('T2104')
    expect(ambiguous.fix).toBeUndefined()
    expect(run(decl('padding: $nothing.like.this')).issues[0]!.fix).toBeUndefined()
  })
})

describe('table row: raw color literal', () => {
  it('rejects hex, rgb(), hsl() and named colors', () => {
    for (const color of [
      '#fff',
      '#ffffff',
      'rgb(10, 20, 30)',
      'hsl(210 50% 40%)',
      'oklch(0.7 0.1 200)',
    ]) {
      const r = run(decl(`color: ${color}`))
      expect(
        r.issues.map((i) => i.code),
        color,
      ).toEqual(['T2101'])
    }
    expect(run(decl('background-color: red')).issues.map((i) => i.code)).toEqual(['T2101'])
    expect(run(decl('border: 1px solid red')).issues.map((i) => i.code)).toEqual(['T2101'])
  })

  it('catches a color anywhere, even in a property that is not governed', () => {
    expect(run(decl('filter: drop-shadow(0 0 2px #000)')).issues.map((i) => i.code)).toEqual([
      'T2101',
    ])
  })

  it('suggests the closest semantic token by perceptual distance', () => {
    const r = run(decl('background: #2f6fe8'))
    expect(r.summary).toEqual([
      'T2101 Raw color "#2f6fe8" in "background" is not a token. | The closest token is "$color.action.primary.bg" (#2563eb). Or write raw(#2f6fe8, "reason") to keep it.',
    ])
  })

  it('fixes an exact match to a single token', () => {
    const r = run(decl('background: #1d4ed8'))
    expect(r.summary).toEqual([
      'T2101 Raw color "#1d4ed8" in "background" is not a token. | Use "$color.action.primary.bg-hover".',
    ])
    expect(r.issues[0]!.fix).toEqual({ start: 17, end: 24, text: '$color.action.primary.bg-hover' })
    // rgb() with the same value is the same color.
    expect(run(decl('background: rgb(29 78 216)')).issues[0]!.fix?.text).toBe(
      '$color.action.primary.bg-hover',
    )
  })

  it('suggests without fixing when several tokens share the value', () => {
    const r = run(decl('color: #fff'))
    expect(r.issues[0]!.fix).toBeUndefined()
    expect(r.issues[0]!.hint).toMatch(/^Use one of: "\$color\./)
  })

  it('allows keywords: transparent, currentColor, inherit', () => {
    expect(
      run(decl('color: currentColor; background: transparent; border-color: inherit')).summary,
    ).toEqual([])
  })

  it('does not call a named color in a font or content a color', () => {
    expect(run(decl('font-family: red; content: "red"; animation-name: red')).summary).toEqual([])
  })

  it('without tokens, still rejects the literal', () => {
    const r = run(decl('color: #fff'), { withTokens: false })
    expect(r.summary).toEqual(['T2101 Raw color "#fff" in "color" is not a token.'])
  })
})

describe('table row: raw length in a governed property', () => {
  it('suggests the nearest scale step', () => {
    const r = run(decl('padding: 13px'))
    expect(r.summary).toEqual([
      'T2102 Raw length "13px" in "padding" is off the scale. | Did you mean "$space.3" (12px)? Or write raw(13px, "reason") to keep it.',
    ])
    expect(r.issues[0]!.fix).toBeUndefined()
  })

  it('fixes a value that is exactly one step, including in another unit', () => {
    const r = run(decl('padding: 16px 1rem'))
    expect(r.issues.map((i) => i.fix?.text)).toEqual(['$space.4', '$space.4'])
    expect(r.summary[0]).toBe(
      'T2102 Raw length "16px" in "padding" is not a token. | Use "$space.4".',
    )
  })

  it('checks every component of a shorthand and calc()', () => {
    expect(run(decl('padding: 8px 13px 0 24px')).issues.map((i) => i.message)).toEqual([
      'Raw length "8px" in "padding" is not a token.',
      'Raw length "13px" in "padding" is off the scale.',
      'Raw length "24px" in "padding" is not a token.',
    ])
    expect(run(decl('margin: calc($space.2 + 1px)')).issues.map((i) => i.message)).toEqual([
      'Raw length "1px" in "margin" is off the scale.',
    ])
  })

  it('checks radius, durations and numbers against their own groups', () => {
    expect(run(decl('border-radius: 7px')).summary[0]).toMatch(
      /Did you mean "\$radius\.md" \(8px\)/,
    )
    expect(run(decl('transition-duration: 100ms')).summary[0]).toMatch(
      /Did you mean "\$motion\.duration\.fast" \(120ms\)/,
    )
    expect(run(decl('opacity: 0.4')).issues[0]!.fix?.text).toBe('$opacity.disabled')
  })

  it('says so when no token could fit', () => {
    // A governed property whose token group has no tokens in this system.
    const r = run(decl('letter-spacing: 40px'), {
      config: { governed: { 'letter-spacing': { type: 'dimension', groups: ['tracking'] } } },
    })
    expect(r.summary).toEqual([
      'T2102 Raw length "40px" in "letter-spacing" is not a token. | No matching tokens exist. Add one, or write raw(40px, "reason").',
    ])
  })

  it('rejects a token of the wrong kind for the property', () => {
    expect(run(decl('padding: $color.text.default')).summary).toEqual([
      'T2103 "padding" takes dimension tokens from "space", but "$color.text.default" is a color token.',
    ])
    expect(run(decl('padding: $radius.md')).summary).toEqual([
      'T2103 "padding" takes dimension tokens from "space", but "$radius.md" is a dimension token.',
    ])
    expect(run(decl('color: $space.4')).summary[0]).toMatch(
      /^T2103 "color" takes color tokens from "color"/,
    )
  })

  it('applies a custom governed map and lets a project un-govern a property', () => {
    const config: TesseraConfig = {
      governed: { width: { type: 'dimension', groups: ['space'] }, margin: false },
    }
    expect(run(decl('width: 13px'), { config }).issues.map((i) => i.code)).toEqual(['T2102'])
    expect(run(decl('margin: 13px'), { config }).summary).toEqual([])
  })
})

describe('table row: raw value in a property that is not governed', () => {
  it('is fine', () => {
    const r = run(
      decl(
        'display: flex; position: absolute; z-index: 10; width: 13px; height: 7em; transform: translateY(8px); line-height: 1.5; font-weight: 700',
      ),
    )
    expect(r.summary).toEqual([])
  })
})

describe('table row: keywords and zero', () => {
  it('allows 0, auto, 100%, inherit and friends in governed properties', () => {
    const r = run(
      decl(
        'padding: 0 auto; margin: 0px 0 100% inherit; gap: initial; border-radius: unset; opacity: 0',
      ),
    )
    expect(r.summary).toEqual([])
  })
})

describe('table row: raw(value, reason[, expiry])', () => {
  it('is allowed with a reason, warns, is counted, and is unwrapped in the output', () => {
    const r = run(decl('padding: raw(13px, "legacy modal spacing")'))
    expect(r.summary).toEqual([
      'T2111 warn raw(13px) leaves the design system: "legacy modal spacing". | Add an expiry date as a third argument so it does not last forever.',
    ])
    expect(r.css).toContain('.t-X__a { padding: 13px }')
    expect(r.stats.escapes).toEqual([{ offset: 14, value: '13px', reason: 'legacy modal spacing' }])
    expect(r.stats.rawValues).toBe(1)
  })

  it('takes an expiry and records it', () => {
    const r = run(decl('padding: raw(13px, "legacy modal spacing", "2027-03-01")'))
    expect(r.summary).toEqual([
      'T2111 warn raw(13px) leaves the design system: "legacy modal spacing". | Expires 2027-03-01.',
    ])
    expect(r.stats.escapes[0]).toMatchObject({ expires: '2027-03-01' })
  })

  it('works for colors and with commas inside the value', () => {
    expect(run(decl('color: raw(rgb(1, 2, 3), "brand asset")')).css).toContain(
      'color: rgb(1, 2, 3)',
    )
    expect(run(decl('color: raw(#123456, "brand asset")')).issues.map((i) => i.code)).toEqual([
      'T2111',
    ])
  })

  it('is an error without a reason', () => {
    expect(run(decl('padding: raw(13px)')).summary).toEqual([
      'T2108 raw(13px) needs a reason, like raw(13px, "why it is needed").',
    ])
    expect(run(decl('padding: raw(13px, "")')).summary).toEqual([
      'T2108 raw(13px) needs a reason, like raw(13px, "why it is needed").',
    ])
    expect(run(decl('padding: raw(13px, why)')).issues.map((i) => i.code)).toEqual(['T2108'])
    expect(run(decl('padding: raw()')).summary[0]).toMatch(/^T2108 raw\(\) needs a value, a reason/)
  })

  it('is an error with a malformed expiry or too many arguments', () => {
    expect(run(decl('padding: raw(13px, "x", "soon")')).summary).toEqual([
      'T2108 The expiry in raw() must be a quoted date like "2027-03-01", got "soon".',
    ])
    expect(run(decl('padding: raw(13px, "x", "2027-03-01", 4)')).summary).toEqual([
      'T2108 raw() takes a value, a reason and an optional expiry date, but got 4 arguments.',
    ])
  })

  it('becomes an error after its expiry date, but not on the day', () => {
    const css = decl('padding: raw(13px, "legacy modal spacing", "2027-03-01")')
    expect(run(css, { today: '2027-03-01' }).issues.map((i) => i.severity)).toEqual(['warning'])
    const expired = run(css, { today: '2027-03-02' })
    expect(expired.summary).toEqual([
      'T2110 This raw(13px) expired on 2027-03-01: "legacy modal spacing". | Replace 13px with a token, or extend the date with a new reason.',
    ])
    expect(expired.issues[0]!.severity).toBe('error')
  })
})

describe('primitive tokens', () => {
  it('warn by default, can be errors, and can be switched off', () => {
    const css = decl('color: $color.neutral.900')
    expect(run(css).summary).toEqual([
      'T2105 warn "$color.neutral.900" is a primitive token. Components should use semantic or component tokens. | Reference a semantic token instead, or add one that aliases this primitive.',
    ])
    expect(run(css, { config: { primitives: 'error' } }).issues[0]!.severity).toBe('error')
    expect(run(css, { config: { primitives: 'off' } }).summary).toEqual([])
  })

  it('treat the semantic scales (space, radius, motion) as fine', () => {
    expect(
      run(
        decl(
          'padding: $space.4; border-radius: $radius.md; transition-duration: $motion.duration.fast',
        ),
      ).summary,
    ).toEqual([])
  })
})

describe('scoping and structure', () => {
  it('prefixes every class, in selector lists, nesting and :not()', () => {
    const r = run(
      '.root, .other:not(.skip) { color: $color.text.default; &:hover { color: $color.text.muted } .icon { padding: 0 } }',
      { prefix: 't-Button__' },
    )
    expect(r.css).toContain('.t-Button__root, .t-Button__other:not(.t-Button__skip) {')
    expect(r.css).toContain('.t-Button__icon {')
    expect(r.css).toContain('&:hover {')
  })

  it('leaves attribute values, element selectors and keyframes alone', () => {
    const r = run(
      'a[href$=".pdf"] { color: $color.text.default } @keyframes spin { from { opacity: 0 } to { opacity: $opacity.disabled } }',
    )
    expect(r.css).toContain('a[href$=".pdf"] {')
    expect(r.css).toContain('@keyframes spin')
  })

  it('wraps the output in the components layer, and outputs nothing for an empty block', () => {
    expect(run(decl('display: flex')).css.startsWith('@layer tessera.components {\n')).toBe(true)
    expect(run('  \n ').css).toBe('')
  })

  it('does not check declarations inside @font-face', () => {
    expect(
      run('@font-face { font-family: "X"; src: url(x.woff2); padding: 13px }').summary,
    ).toEqual([])
  })

  it('reports syntax problems', () => {
    expect(run('.a { display: flex').summary).toEqual([
      'T2106 Invalid style: A "{" is never closed.',
    ])
  })

  it('counts declarations, tokenized declarations and hand-written values', () => {
    const r = run(
      decl(
        'padding: $space.4; display: flex; margin: raw(13px, "x"); color: $color.text.default; width: 5px',
      ),
    )
    expect(r.stats).toMatchObject({ declarations: 5, tokenized: 2, rawValues: 2 })
  })
})

describe('variant selectors against the contract', () => {
  const contract = {
    name: 'Button',
    role: 'button',
    parts: ['root'],
    variants: { tone: ['primary', 'neutral', 'danger'] },
    states: [],
    slots: {},
    events: {},
    contrast: [],
  }
  const run2 = (css: string) =>
    processStyle({
      css,
      base: 0,
      tokens,
      config: resolveConfig(),
      contract,
      prefix: 't-Button__',
      today: '2026-10-22',
    }).issues.map((i) => `${i.code} ${i.message}${i.hint ? ` | ${i.hint}` : ''}`)

  it('accepts declared values and rejects others with a suggestion', () => {
    expect(run2('.root { &[data-tone="danger"] { color: $color.text.default } }')).toEqual([])
    expect(run2('.root { &[data-tone="dangr"] { color: $color.text.default } }')).toEqual([
      'T2114 Button.tone has no value "dangr". | Did you mean "danger"?',
    ])
    expect(run2('.root[data-tone=neutral], .root[data-tone=oops] { display: flex }')).toEqual([
      expect.stringContaining('Button.tone has no value "oops"'),
    ])
  })

  it('ignores data attributes that are not variants', () => {
    expect(run2('.root[data-state="open"] { display: flex }')).toEqual([])
  })
})
