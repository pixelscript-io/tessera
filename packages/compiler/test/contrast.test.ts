import { describe, expect, it } from 'vitest'
import { buildTokens } from '@tessera/tokens'
import { resolveConfig } from '../src/config'
import { processStyle } from '../src/style/enforce'
import { checkContrast } from '../src/style/contrast'
import { StyleTokens } from '../src/style/tokens'

const srgb = (hex: string, alpha = 1) => {
  const n = parseInt(hex.slice(1), 16)
  return {
    colorSpace: 'srgb',
    components: [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255],
    ...(alpha === 1 ? {} : { alpha }),
  }
}

// Light by default; the dark theme swaps ink and paper, and moves "dim" onto a surface it cannot be read on.
const built = buildTokens({
  base: [
    {
      file: 'base.tokens.json',
      content: {
        color: {
          $type: 'color',
          $extensions: { tessera: { tier: 'semantic' } },
          ink: { $value: srgb('#111827') },
          paper: { $value: srgb('#ffffff') },
          mist: { $value: srgb('#cccccc') },
          dim: { $value: srgb('#6b7280') },
          accent: { $value: srgb('#2563eb') },
          clear: { $value: srgb('#ffffff', 0.5) },
        },
      },
    },
  ],
  themes: [
    {
      file: 'dark.tokens.json',
      content: {
        $extends: 'base',
        color: {
          ink: { $value: srgb('#f9fafb') },
          paper: { $value: srgb('#1f2937') },
          mist: { $value: srgb('#e5e7eb') },
          accent: { $value: srgb('#60a5fa') },
        },
      },
    },
    // A theme that changes no color adds no new results.
    {
      file: 'compact.tokens.json',
      content: {
        $extends: 'base',
        $attribute: 'density',
        color: { accent: { $value: srgb('#2563eb') } },
      },
    },
  ],
})
const tokens = StyleTokens.fromManifest(built.manifest!)
const config = resolveConfig()

function contrast(
  css: string,
  contract?: Parameters<typeof checkContrast>[0]['contract'],
  minimum = config.contrast.minimum,
) {
  const { nodes } = processStyle({
    css,
    base: 0,
    tokens,
    config,
    prefix: 't-X__',
    today: '2026-10-22',
  })
  return checkContrast({ nodes, tokens, contract, minimum, styleStart: 0 }).map(
    (i) =>
      `${i.code} ${i.severity === 'warning' ? 'warn ' : ''}${i.message}${i.hint ? ` | ${i.hint}` : ''}`,
  )
}

describe("contrast between a part's color and background", () => {
  it('passes when every theme is readable', () => {
    expect(contrast('.root { color: $color.ink; background: $color.paper }')).toEqual([])
  })

  it('fails with the ratio, naming the theme where it is too low', () => {
    expect(contrast('.root { color: $color.mist; background: $color.paper }')).toEqual([
      'T2107 Contrast between "$color.mist" and "$color.paper" is too low: 1.6:1 in the default theme (needs 4.5:1). | Set in ".root". Pick tokens that are at least 4.5:1 apart in every theme.',
    ])
  })

  it('fails only in the theme where the colors collide', () => {
    const r = contrast('.root { color: $color.dim; background: $color.paper }')
    expect(r).toHaveLength(1)
    expect(r[0]).toContain('in theme "dark"')
    expect(r[0]).not.toContain('default theme')
  })

  it('honours a different threshold (AAA)', () => {
    const css = '.root { color: $color.accent; background: $color.paper }'
    expect(contrast(css)).toEqual([])
    const strict = contrast(css, undefined, 7)
    expect(strict).toEqual([expect.stringContaining('(needs 7:1)')])
    expect(strict[0]).toContain('in the default theme')
    expect(strict[0]).toContain('in theme "dark"')
    // The density theme changes no color, so it adds no line.
    expect(strict[0]).not.toContain('density')
  })

  it('checks state and variant rules, using the base rule for whatever they do not set', () => {
    const css = `.root { color: $color.ink; background: $color.paper;
      &:hover { color: $color.mist }
      &[data-tone="soft"] { background: $color.ink }
    }`
    const r = contrast(css)
    // The two rules also combine: hover on the soft variant pairs mist with ink, which fails in dark.
    expect(r).toHaveLength(3)
    expect(r[0]).toContain('"$color.mist" and "$color.paper"')
    expect(r[0]).toContain('Set in ".root:hover"')
    expect(r[1]).toContain('"$color.ink" and "$color.ink"')
    expect(r[1]).toContain('1.0:1')
    expect(r[2]).toContain('"$color.mist" and "$color.ink"')
    expect(r[2]).toContain('Set in ".root[data-tone="soft"]:hover"')
    expect(r[2]).toContain('in theme "dark"')
  })

  it('reports a part once even when its color and background are in separate rules', () => {
    const css =
      '.label { color: $color.mist } .root { background: $color.paper } .label { background: $color.paper }'
    expect(contrast(css)).toHaveLength(1)
  })

  it('does not pair a descendant with its ancestor, since it cannot know what is behind it', () => {
    expect(contrast('.root { background: $color.paper; .icon { color: $color.mist } }')).toEqual([])
  })

  it('draws a translucent foreground over the background, and skips a translucent background', () => {
    expect(contrast('.root { color: $color.clear; background: $color.paper }')).toEqual([
      expect.stringContaining('1.0:1'),
    ])
    expect(contrast('.root { color: $color.ink; background: $color.clear }')).toEqual([])
  })

  it('skips pairs it cannot see: raw values, keywords, or only one side set', () => {
    expect(contrast('.root { color: raw(#ccc, "brand"); background: $color.paper }')).toEqual([])
    expect(contrast('.root { color: currentColor; background: $color.paper }')).toEqual([])
    expect(contrast('.root { color: $color.mist }')).toEqual([])
    expect(contrast('.root { background: url(x.png) }')).toEqual([])
  })
})

describe('contrast pairings declared in the contract', () => {
  const contract = {
    name: 'X',
    role: 'group',
    parts: ['root', 'label'],
    variants: {},
    states: [],
    slots: {},
    events: {},
    contrast: [{ foreground: 'label', background: 'root' }],
  }

  it('checks text in one part against the background of another', () => {
    const r = contrast('.root { background: $color.paper } .label { color: $color.mist }', contract)
    expect(r).toEqual([
      'T2107 Contrast between "$color.mist" and "$color.paper" is too low: 1.6:1 in the default theme (needs 4.5:1). | The contract pairs "label" with "root". Set in ".label on .root". Pick tokens that are at least 4.5:1 apart in every theme.',
    ])
    expect(
      contrast('.root { background: $color.paper } .label { color: $color.ink }', contract),
    ).toEqual([])
  })

  it('warns when the pairing cannot be verified because a side has no token', () => {
    expect(contrast('.root { background: $color.paper }', contract)).toEqual([
      'T2109 warn The contract pairs "label" text with a "root" background, but .label sets no color token, so the pairing cannot be checked. | Set the missing token in <style>, or remove the pairing from the contract.',
    ])
    expect(contrast('.label { color: $color.ink }', contract)).toEqual([
      expect.stringContaining('.root sets no background token'),
    ])
  })
})
