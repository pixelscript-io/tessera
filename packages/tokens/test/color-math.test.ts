import { describe, expect, it } from 'vitest'
import {
  NAMED_COLORS,
  colorDistance,
  contrastRatio,
  isColorFunction,
  parseCssColor,
  toHex,
  toOklab,
  toSrgb,
  type Color,
} from '../src/color-math'

const c = (text: string): Color => {
  const color = parseCssColor(text)
  if (!color) throw new Error(`could not parse ${text}`)
  return color
}

describe('parseCssColor', () => {
  it('reads hex in all lengths, with alpha', () => {
    expect(c('#fff').components).toEqual([1, 1, 1])
    expect(c('#ff0000').components).toEqual([1, 0, 0])
    expect(c('#f008').alpha).toBeCloseTo(0x88 / 255)
    expect(c('#00ff0080').alpha).toBeCloseTo(128 / 255)
    expect(parseCssColor('#ff')).toBeUndefined()
    expect(parseCssColor('#ggg')).toBeUndefined()
  })

  it('reads rgb in both syntaxes and with percentages', () => {
    expect(toHex(c('rgb(255, 0, 128)'))).toBe('#ff0080')
    expect(toHex(c('rgb(255 0 128 / 50%)'))).toBe('#ff0080')
    expect(c('rgb(255 0 128 / 50%)').alpha).toBe(0.5)
    expect(toHex(c('rgb(100% 0% 0%)'))).toBe('#ff0000')
    expect(c('rgba(0, 0, 0, 0.2)').alpha).toBe(0.2)
  })

  it('reads hsl, hwb, lab, lch, oklab, oklch and color()', () => {
    expect(toHex(c('hsl(0 100% 50%)'))).toBe('#ff0000')
    expect(toHex(c('hsl(120, 100%, 25%)'))).toBe('#008000')
    expect(toHex(c('hsl(0.5turn 100% 50%)'))).toBe('#00ffff')
    expect(toHex(c('hwb(0 0% 0%)'))).toBe('#ff0000')
    expect(toHex(c('hwb(0 50% 50%)'))).toBe('#808080')
    expect(toHex(c('oklab(1 0 0)'))).toBe('#ffffff')
    expect(toHex(c('oklch(0 0 0)'))).toBe('#000000')
    expect(toHex(c('lab(100 0 0)'))).toBe('#ffffff')
    expect(toHex(c('lch(0 0 0)'))).toBe('#000000')
    expect(toHex(c('color(srgb 1 0 0)'))).toBe('#ff0000')
    expect(toHex(c('color(srgb-linear 1 1 1)'))).toBe('#ffffff')
    expect(toHex(c('color(display-p3 1 1 1)'))).toBe('#ffffff')
    expect(toHex(c('color(xyz-d65 0.9505 1 1.089)'))).toBe('#ffffff')
    expect(toHex(c('color(rec2020 1 1 1)'))).toBe('#ffffff')
    expect(toHex(c('color(a98-rgb 1 1 1)'))).toBe('#ffffff')
    expect(toHex(c('color(prophoto-rgb 1 1 1)'))).toBe('#ffffff')
  })

  it('treats "none" as zero and rejects things that are not colors', () => {
    expect(c('oklch(0.7 0.1 none)').components[2]).toBe(0)
    expect(parseCssColor('rgb(1, 2)')).toBeUndefined()
    expect(parseCssColor('notacolor')).toBeUndefined()
    expect(parseCssColor('12px')).toBeUndefined()
    expect(parseCssColor('color(unknown 1 1 1)')).toBeUndefined()
  })

  it('knows the CSS named colors', () => {
    expect(Object.keys(NAMED_COLORS)).toHaveLength(148)
    expect(toHex(c('rebeccapurple'))).toBe('#663399')
    expect(toHex(c('RED'))).toBe('#ff0000')
    for (const [name, hex] of Object.entries(NAMED_COLORS)) {
      expect(hex, name).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(NAMED_COLORS.transparent).toBeUndefined()
  })

  it('recognises color function names', () => {
    for (const name of ['rgb', 'RGBA', 'hsl', 'oklch', 'color'])
      expect(isColorFunction(name)).toBe(true)
    for (const name of ['calc', 'var', 'linear-gradient', 'color-mix'])
      expect(isColorFunction(name)).toBe(false)
  })
})

describe('conversions', () => {
  it('round-trips sRGB through the pipeline', () => {
    for (const hex of ['#2563eb', '#ef4444', '#111827', '#f5f6f8']) {
      expect(toHex(c(hex))).toBe(hex)
    }
  })

  it('matches known OKLab values', () => {
    const [l, a, b] = toOklab(c('#ff0000'))
    expect(l).toBeCloseTo(0.628, 3)
    expect(a).toBeCloseTo(0.2249, 3)
    expect(b).toBeCloseTo(0.1258, 3)
    expect(toOklab(c('#ffffff'))[0]).toBeCloseTo(1, 4)
  })

  it('clamps out-of-gamut colors for display', () => {
    const [r, g, b] = toSrgb(c('color(display-p3 0 1 0)'))
    expect(r).toBe(0)
    expect(g).toBeCloseTo(1, 3)
    expect(b).toBeLessThan(0.1)
  })
})

describe('colorDistance', () => {
  it('is zero for equal colors and small for near ones', () => {
    expect(colorDistance(c('#2563eb'), c('rgb(37 99 235)'))).toBeCloseTo(0, 5)
    expect(colorDistance(c('#2563eb'), c('#2564eb'))).toBeLessThan(0.005)
    expect(colorDistance(c('#2563eb'), c('#ef4444'))).toBeGreaterThan(0.2)
  })

  it('ranks nearer colors first', () => {
    const target = c('#2f6fe8')
    expect(colorDistance(target, c('#2563eb'))).toBeLessThan(colorDistance(target, c('#1d4ed8')))
  })
})

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 5)
    expect(contrastRatio(c('#fff'), c('#fff'))).toBeCloseTo(1, 5)
    expect(contrastRatio(c('#767676'), c('#fff'))).toBeCloseTo(4.54, 2)
    expect(contrastRatio(c('#777777'), c('#fff'))).toBeCloseTo(4.48, 2)
  })

  it('is symmetric', () => {
    expect(contrastRatio(c('#2563eb'), c('#fff'))).toBeCloseTo(
      contrastRatio(c('#fff'), c('#2563eb')),
      8,
    )
  })

  it('draws a translucent foreground over the background', () => {
    const half = contrastRatio(c('rgb(0 0 0 / 50%)'), c('#fff'))
    expect(half).toBeLessThan(21)
    expect(half).toBeCloseTo(contrastRatio(c('#808080'), c('#fff')), 1)
  })
})
