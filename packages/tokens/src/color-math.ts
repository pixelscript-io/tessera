/**
 * Color parsing and math for the style checks: which design token is nearest to a raw color, and what
 * the WCAG contrast ratio of two colors is. It reads the CSS color strings that the token build emits
 * (hex, rgb, hsl, hwb, lab, lch, oklab, oklch, color()) and the literals authors write, including names.
 * No dependencies and no DOM, so it runs in a browser.
 */

export type ColorSpace =
  | 'srgb'
  | 'srgb-linear'
  | 'display-p3'
  | 'a98-rgb'
  | 'prophoto-rgb'
  | 'rec2020'
  | 'xyz-d50'
  | 'xyz-d65'
  | 'lab'
  | 'lch'
  | 'oklab'
  | 'oklch'
  | 'hsl'
  | 'hwb'

export interface Color {
  space: ColorSpace
  /** Components in the space's own units (srgb 0 to 1, hue in degrees, percentages as 0 to 100 for hsl/hwb). */
  components: [number, number, number]
  alpha: number
}

type Vec = [number, number, number]
type Matrix = [Vec, Vec, Vec]

const mul = (m: Matrix, v: Vec): Vec => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
]

const XYZ_TO_SRGB: Matrix = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
]
const P3_TO_XYZ: Matrix = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0.0, 0.04511338185890264, 1.043944368900976],
]
const A98_TO_XYZ: Matrix = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.0752914584939978],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
]
const REC2020_TO_XYZ: Matrix = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0.0, 0.028072693049087428, 1.060985057710791],
]
const PROPHOTO_TO_XYZ_D50: Matrix = [
  [0.7977604896723027, 0.13518583717574031, 0.0313493495815248],
  [0.2880711282292934, 0.7118432178101014, 0.0000856539606052],
  [0.0, 0.0, 0.8251046025104601],
]
const D50_TO_D65: Matrix = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
]
const D50_WHITE: Vec = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585]

const decode = (c: number) => {
  const a = Math.abs(c)
  return Math.sign(c) * (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4)
}
const encode = (c: number) => {
  const a = Math.abs(c)
  return Math.sign(c) * (a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055)
}
const decodeA98 = (c: number) => Math.sign(c) * Math.abs(c) ** (563 / 256)
const decodeProphoto = (c: number) => {
  const a = Math.abs(c)
  return Math.sign(c) * (a <= 16 / 512 ? a / 16 : a ** 1.8)
}
const decodeRec2020 = (c: number) => {
  const a = Math.abs(c)
  const alpha = 1.09929682680944
  const beta = 0.018053968510807
  return Math.sign(c) * (a < beta * 4.5 ? a / 4.5 : ((a + alpha - 1) / alpha) ** (1 / 0.45))
}

const hslToSrgb = (h: number, s: number, l: number): Vec => {
  const sat = s / 100
  const light = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

const hwbToSrgb = (h: number, w: number, b: number): Vec => {
  const white = w / 100
  const black = b / 100
  if (white + black >= 1) {
    const gray = white / (white + black)
    return [gray, gray, gray]
  }
  const rgb = hslToSrgb(h, 100, 50)
  return rgb.map((c) => c * (1 - white - black) + white) as Vec
}

const labToXyzD50 = (l: number, a: number, b: number): Vec => {
  const e = 216 / 24389
  const k = 24389 / 27
  const fy = (l + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200
  const x = fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k
  const y = l > k * e ? ((l + 16) / 116) ** 3 : l / k
  const z = fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k
  return [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]]
}

const oklabToLinearSrgb = (l: number, a: number, b: number): Vec => {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const polar = (c: number, h: number): [number, number] => {
  const rad = (h * Math.PI) / 180
  return [c * Math.cos(rad), c * Math.sin(rad)]
}

/** Linear-light sRGB, not clamped (wide-gamut colors may fall outside 0 to 1). */
export function toLinearSrgb(color: Color): Vec {
  const [x, y, z] = color.components
  switch (color.space) {
    case 'srgb':
      return [decode(x), decode(y), decode(z)]
    case 'srgb-linear':
      return [x, y, z]
    case 'hsl':
      return hslToSrgb(x, y, z).map(decode) as Vec
    case 'hwb':
      return hwbToSrgb(x, y, z).map(decode) as Vec
    case 'display-p3':
      return mul(XYZ_TO_SRGB, mul(P3_TO_XYZ, [decode(x), decode(y), decode(z)]))
    case 'a98-rgb':
      return mul(XYZ_TO_SRGB, mul(A98_TO_XYZ, [decodeA98(x), decodeA98(y), decodeA98(z)]))
    case 'rec2020':
      return mul(
        XYZ_TO_SRGB,
        mul(REC2020_TO_XYZ, [decodeRec2020(x), decodeRec2020(y), decodeRec2020(z)]),
      )
    case 'prophoto-rgb':
      return mul(
        XYZ_TO_SRGB,
        mul(
          D50_TO_D65,
          mul(PROPHOTO_TO_XYZ_D50, [decodeProphoto(x), decodeProphoto(y), decodeProphoto(z)]),
        ),
      )
    case 'xyz-d65':
      return mul(XYZ_TO_SRGB, [x, y, z])
    case 'xyz-d50':
      return mul(XYZ_TO_SRGB, mul(D50_TO_D65, [x, y, z]))
    case 'lab':
      return mul(XYZ_TO_SRGB, mul(D50_TO_D65, labToXyzD50(x, y, z)))
    case 'lch': {
      const [a, b] = polar(y, z)
      return mul(XYZ_TO_SRGB, mul(D50_TO_D65, labToXyzD50(x, a, b)))
    }
    case 'oklab':
      return oklabToLinearSrgb(x, y, z)
    case 'oklch': {
      const [a, b] = polar(y, z)
      return oklabToLinearSrgb(x, a, b)
    }
  }
}

/** Gamma-encoded sRGB clamped to the displayable range. */
export function toSrgb(color: Color): Vec {
  return toLinearSrgb(color).map((c) => Math.min(1, Math.max(0, encode(c)))) as Vec
}

export function toOklab(color: Color): Vec {
  const [r, g, b] = toLinearSrgb(color).map((c) => Math.min(1, Math.max(0, c))) as Vec
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Perceptual distance: Euclidean distance in OKLab. About 0.02 is just noticeable. */
export function colorDistance(a: Color, b: Color): number {
  const [l1, a1, b1] = toOklab(a)
  const [l2, a2, b2] = toOklab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

function relativeLuminance(color: Color): number {
  const [r, g, b] = toLinearSrgb(color).map((c) => Math.min(1, Math.max(0, c))) as Vec
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** `color` drawn over an opaque `backdrop`. */
export function composite(color: Color, backdrop: Color): Color {
  if (color.alpha >= 1) return color
  const [fr, fg, fb] = toSrgb(color)
  const [br, bg, bb] = toSrgb(backdrop)
  const a = color.alpha
  return {
    space: 'srgb',
    components: [fr * a + br * (1 - a), fg * a + bg * (1 - a), fb * a + bb * (1 - a)],
    alpha: 1,
  }
}

/** WCAG 2 contrast ratio between two colors, from 1 to 21. A translucent foreground is drawn over the background. */
export function contrastRatio(foreground: Color, background: Color): number {
  const fg = composite(foreground, background)
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(background)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

export function toHex(color: Color): string {
  const [r, g, b] = toSrgb(color)
  return (
    '#' +
    [r, g, b]
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

// --- parsing ---------------------------------------------------------------------------------------

export const NAMED_COLORS: Readonly<Record<string, string>> = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
}

const COLOR_FUNCTIONS = [
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
]

/** Names of the CSS functions that write a color literal. */
export function isColorFunction(name: string): boolean {
  return COLOR_FUNCTIONS.includes(name.toLowerCase())
}

function splitArgs(inner: string): string[] | undefined {
  // Legacy comma syntax, or modern space syntax with an optional `/ alpha`.
  const text = inner.trim()
  if (text.includes(',')) return text.split(',').map((s) => s.trim())
  const [main, alpha] = text.split('/').map((s) => s.trim())
  const parts = main!.split(/\s+/)
  return alpha === undefined ? parts : [...parts, alpha]
}

function num(token: string, percentScale: number): number | undefined {
  if (token === 'none') return 0
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/i.exec(token)
  if (!m) return undefined
  let value = parseFloat(m[1]!)
  if (m[2] === '%') value = (value / 100) * percentScale
  else if (m[2] === 'turn') value *= 360
  else if (m[2] === 'rad') value = (value * 180) / Math.PI
  else if (m[2] === 'grad') value *= 0.9
  return value
}

/** Parse a CSS color value. Returns undefined for anything that is not a recognised color literal. */
export function parseCssColor(input: string): Color | undefined {
  const text = input.trim().toLowerCase()
  const named = NAMED_COLORS[text]
  if (named) return parseCssColor(named)

  const hex = /^#([0-9a-f]{3,8})$/.exec(text)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return undefined
    const c = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255
    return { space: 'srgb', components: [c(0), c(2), c(4)], alpha: h.length === 8 ? c(6) : 1 }
  }

  const fn = /^([a-z]+)\((.*)\)$/.exec(text)
  if (!fn) return undefined
  const name = fn[1]!
  const args = splitArgs(fn[2]!)
  if (!args) return undefined

  let space: ColorSpace
  let rest = args
  if (name === 'color') {
    const id = args[0]
    const map: Record<string, ColorSpace> = {
      srgb: 'srgb',
      'srgb-linear': 'srgb-linear',
      'display-p3': 'display-p3',
      'a98-rgb': 'a98-rgb',
      'prophoto-rgb': 'prophoto-rgb',
      rec2020: 'rec2020',
      xyz: 'xyz-d65',
      'xyz-d65': 'xyz-d65',
      'xyz-d50': 'xyz-d50',
    }
    if (!id || !map[id]) return undefined
    space = map[id]!
    rest = args.slice(1)
  } else {
    const map: Record<string, ColorSpace> = {
      rgb: 'srgb',
      rgba: 'srgb',
      hsl: 'hsl',
      hsla: 'hsl',
      hwb: 'hwb',
      lab: 'lab',
      lch: 'lch',
      oklab: 'oklab',
      oklch: 'oklch',
    }
    if (!map[name]) return undefined
    space = map[name]!
  }

  const scale: Record<string, [number, number, number]> = {
    srgb: name === 'color' ? [1, 1, 1] : [255, 255, 255],
    hsl: [360, 100, 100],
    hwb: [360, 100, 100],
    lab: [100, 125, 125],
    lch: [100, 150, 360],
    oklab: [1, 0.4, 0.4],
    oklch: [1, 0.4, 360],
  }
  const s = scale[space] ?? [1, 1, 1]
  const parsed = [0, 1, 2].map((i) => (rest[i] === undefined ? undefined : num(rest[i]!, s[i]!)))
  if (parsed.some((v) => v === undefined)) return undefined
  let [a, b, c] = parsed as [number, number, number]
  if (space === 'srgb' && name !== 'color') {
    a /= 255
    b /= 255
    c /= 255
  }
  const alphaToken = rest[3]
  const alpha = alphaToken === undefined ? 1 : num(alphaToken, 1)
  if (alpha === undefined) return undefined
  return { space, components: [a, b, c], alpha: Math.min(1, Math.max(0, alpha)) }
}
