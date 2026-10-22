import { TokenFailure } from './errors'

/** Resolves a `{group.token}` reference found inside a value. */
export type AliasRenderer = (path: string, expectedType: string) => string

const ALIAS = /^\{([^{}]+)\}$/

export function aliasTarget(value: unknown): string | undefined {
  return typeof value === 'string' ? ALIAS.exec(value)?.[1] : undefined
}

/** Every `{alias}` string anywhere inside a value. */
export function collectAliases(value: unknown, out: string[] = []): string[] {
  const target = aliasTarget(value)
  if (target !== undefined) out.push(target)
  else if (Array.isArray(value)) for (const v of value) collectAliases(v, out)
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) collectAliases(v, out)
  return out
}

export const SUPPORTED_TYPES = [
  'color',
  'dimension',
  'duration',
  'number',
  'fontFamily',
  'fontWeight',
  'cubicBezier',
  'strokeStyle',
  'shadow',
  'border',
  'transition',
] as const

const fail = (message: string): never => {
  throw new TokenFailure('T1005', message)
}

const fmt = (n: number): string => String(parseFloat(n.toFixed(6)))

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const COLOR_SPACES: Record<string, { fn: string; ranges: Array<[number, number] | null> }> = {
  srgb: {
    fn: 'srgb',
    ranges: [
      [0, 1],
      [0, 1],
      [0, 1],
    ],
  },
  'srgb-linear': {
    fn: 'color',
    ranges: [
      [0, 1],
      [0, 1],
      [0, 1],
    ],
  },
  hsl: {
    fn: 'hsl',
    ranges: [
      [0, 360],
      [0, 100],
      [0, 100],
    ],
  },
  hwb: {
    fn: 'hwb',
    ranges: [
      [0, 360],
      [0, 100],
      [0, 100],
    ],
  },
  lab: { fn: 'lab', ranges: [[0, 100], null, null] },
  lch: {
    fn: 'lch',
    ranges: [
      [0, 100],
      [0, Infinity],
      [0, 360],
    ],
  },
  oklab: { fn: 'oklab', ranges: [[0, 1], null, null] },
  oklch: {
    fn: 'oklch',
    ranges: [
      [0, 1],
      [0, Infinity],
      [0, 360],
    ],
  },
  'display-p3': {
    fn: 'color',
    ranges: [
      [0, 1],
      [0, 1],
      [0, 1],
    ],
  },
  'a98-rgb': {
    fn: 'color',
    ranges: [
      [0, 1],
      [0, 1],
      [0, 1],
    ],
  },
  'prophoto-rgb': {
    fn: 'color',
    ranges: [
      [0, 1],
      [0, 1],
      [0, 1],
    ],
  },
  rec2020: {
    fn: 'color',
    ranges: [
      [0, 1],
      [0, 1],
      [0, 1],
    ],
  },
  'xyz-d65': {
    fn: 'color',
    ranges: [
      [0, 1],
      [0, 1],
      [0, 1],
    ],
  },
  'xyz-d50': {
    fn: 'color',
    ranges: [
      [0, 1],
      [0, 1],
      [0, 1],
    ],
  },
}

export function colorToCss(value: unknown): string {
  if (!isObject(value))
    return fail('A color value must be an object with "colorSpace" and "components".')
  const { colorSpace, components, alpha, hex } = value
  const space = typeof colorSpace === 'string' ? COLOR_SPACES[colorSpace] : undefined
  if (!space) {
    return fail(
      `Unknown colorSpace ${JSON.stringify(colorSpace)}. Expected one of: ${Object.keys(COLOR_SPACES).join(', ')}.`,
    )
  }
  if (!Array.isArray(components) || components.length !== 3) {
    return fail('A color "components" value must be an array of exactly 3 numbers or "none".')
  }
  components.forEach((c, i) => {
    if (c === 'none') return
    const range = space.ranges[i]
    if (typeof c !== 'number' || !Number.isFinite(c)) {
      fail(`Color component ${i} must be a number or "none", got ${JSON.stringify(c)}.`)
    } else if (range && (c < range[0] || c > range[1] || (range[1] === 360 && c === 360))) {
      const max = range[1] === 360 ? '360 (exclusive)' : String(range[1])
      fail(`Color component ${i} (${c}) is outside the ${colorSpace} range ${range[0]} to ${max}.`)
    }
  })
  if (alpha !== undefined && (typeof alpha !== 'number' || alpha < 0 || alpha > 1)) {
    return fail(`Color "alpha" must be a number from 0 to 1, got ${JSON.stringify(alpha)}.`)
  }
  if (hex !== undefined && (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex))) {
    return fail(
      `Color "hex" must be a 6-digit hex string such as "#ff00ff", got ${JSON.stringify(hex)}.`,
    )
  }

  const a = typeof alpha === 'number' ? alpha : 1
  const slash = a === 1 ? '' : ` / ${fmt(a)}`
  const parts = components.map((c) => (c === 'none' ? 'none' : (c as number)))
  const join = (xs: Array<string | number>) =>
    xs.map((x) => (typeof x === 'number' ? fmt(x) : x)).join(' ')

  switch (colorSpace) {
    case 'srgb': {
      if (parts.includes('none')) return `color(srgb ${join(parts)}${slash})`
      const [r, g, b] = (parts as number[]).map((c) => c * 255) as [number, number, number]
      if (a === 1 && [r, g, b].every((c) => Math.abs(c - Math.round(c)) < 1e-6)) {
        return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
      }
      return `rgb(${join([r, g, b])}${slash})`
    }
    case 'hsl':
    case 'hwb': {
      const [h, s, l] = parts.map((p, i) => (i > 0 && p !== 'none' ? `${fmt(p as number)}%` : p))
      return `${colorSpace}(${join([h!, s!, l!])}${slash})`
    }
    case 'lab':
    case 'lch':
    case 'oklab':
    case 'oklch':
      return `${colorSpace}(${join(parts)}${slash})`
    default:
      return `color(${colorSpace} ${join(parts)}${slash})`
  }
}

const FONT_WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  'extra-light': 200,
  'ultra-light': 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  'semi-bold': 600,
  'demi-bold': 600,
  bold: 700,
  'extra-bold': 800,
  'ultra-bold': 800,
  black: 900,
  heavy: 900,
  'extra-black': 950,
  'ultra-black': 950,
}

const STROKE_STYLES = ['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'outset', 'inset']
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
])

/** Render a field of a composite value, which is either an alias of `type` or a literal of `type`. */
function field(type: string, value: unknown, alias: AliasRenderer): string {
  const target = aliasTarget(value)
  return target !== undefined ? alias(target, type) : serialize(type, value, alias)
}

/**
 * Turn a DTCG `$value` into a CSS value, validating it on the way. Aliases are rendered by `alias`,
 * which decides between `var(--t-…)` and an inlined literal. Throws TokenFailure on invalid values.
 */
export function serialize(type: string, value: unknown, alias: AliasRenderer): string {
  switch (type) {
    case 'color':
      return colorToCss(value)
    case 'dimension': {
      if (!isObject(value) || typeof value.value !== 'number' || !Number.isFinite(value.value)) {
        return fail('A dimension value must be an object like { "value": 16, "unit": "px" }.')
      }
      if (value.unit !== 'px' && value.unit !== 'rem') {
        return fail(`Dimension unit must be "px" or "rem", got ${JSON.stringify(value.unit)}.`)
      }
      return `${fmt(value.value)}${value.unit}`
    }
    case 'duration': {
      if (!isObject(value) || typeof value.value !== 'number' || !Number.isFinite(value.value)) {
        return fail('A duration value must be an object like { "value": 200, "unit": "ms" }.')
      }
      if (value.unit !== 'ms' && value.unit !== 's') {
        return fail(`Duration unit must be "ms" or "s", got ${JSON.stringify(value.unit)}.`)
      }
      return `${fmt(value.value)}${value.unit}`
    }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail(`A number value must be a finite number, got ${JSON.stringify(value)}.`)
      }
      return fmt(value)
    case 'fontWeight': {
      if (typeof value === 'number') {
        if (value < 1 || value > 1000)
          return fail(`fontWeight must be from 1 to 1000, got ${value}.`)
        return fmt(value)
      }
      const named = typeof value === 'string' ? FONT_WEIGHTS[value] : undefined
      if (named === undefined) {
        return fail(
          `fontWeight must be a number from 1 to 1000 or one of: ${Object.keys(FONT_WEIGHTS).join(', ')}. Got ${JSON.stringify(value)}.`,
        )
      }
      return String(named)
    }
    case 'fontFamily': {
      const names = Array.isArray(value) ? value : [value]
      if (names.length === 0 || names.some((n) => typeof n !== 'string' || n === '')) {
        return fail('fontFamily must be a non-empty string or an array of non-empty strings.')
      }
      return (names as string[])
        .map((n) =>
          GENERIC_FAMILIES.has(n) || /^[A-Za-z][A-Za-z0-9-]*$/.test(n) ? n : JSON.stringify(n),
        )
        .join(', ')
    }
    case 'cubicBezier': {
      if (
        !Array.isArray(value) ||
        value.length !== 4 ||
        value.some((n) => typeof n !== 'number' || !Number.isFinite(n))
      ) {
        return fail('A cubicBezier value must be an array of 4 numbers.')
      }
      if (
        (value[0] as number) < 0 ||
        (value[0] as number) > 1 ||
        (value[2] as number) < 0 ||
        (value[2] as number) > 1
      ) {
        return fail('The x values (index 0 and 2) of a cubicBezier must be between 0 and 1.')
      }
      return `cubic-bezier(${(value as number[]).map(fmt).join(', ')})`
    }
    case 'strokeStyle':
      if (typeof value !== 'string' || !STROKE_STYLES.includes(value)) {
        return fail(
          `strokeStyle must be one of: ${STROKE_STYLES.join(', ')}. Got ${JSON.stringify(value)}. (Object strokeStyles are not supported yet.)`,
        )
      }
      return value
    case 'shadow': {
      const layers = Array.isArray(value) ? value : [value]
      if (layers.length === 0) return fail('A shadow value must not be an empty array.')
      return layers
        .map((layer) => {
          const target = aliasTarget(layer)
          if (target !== undefined) return alias(target, 'shadow')
          if (!isObject(layer))
            return fail('A shadow layer must be an object or a reference to a shadow token.')
          const parts = ['offsetX', 'offsetY', 'blur', 'spread'].map((k) => {
            if (!(k in layer)) return fail(`A shadow layer is missing "${k}".`)
            return field('dimension', layer[k], alias)
          })
          if (!('color' in layer)) return fail('A shadow layer is missing "color".')
          const inset = layer.inset === true ? 'inset ' : ''
          return `${inset}${parts.join(' ')} ${field('color', layer.color, alias)}`
        })
        .join(', ')
    }
    case 'border': {
      if (!isObject(value))
        return fail('A border value must be an object with "color", "width" and "style".')
      for (const k of ['color', 'width', 'style']) {
        if (!(k in value)) return fail(`A border value is missing "${k}".`)
      }
      return `${field('dimension', value.width, alias)} ${field('strokeStyle', value.style, alias)} ${field('color', value.color, alias)}`
    }
    case 'transition': {
      if (!isObject(value)) {
        return fail(
          'A transition value must be an object with "duration", "delay" and "timingFunction".',
        )
      }
      for (const k of ['duration', 'delay', 'timingFunction']) {
        if (!(k in value)) return fail(`A transition value is missing "${k}".`)
      }
      return `${field('duration', value.duration, alias)} ${field('cubicBezier', value.timingFunction, alias)} ${field('duration', value.delay, alias)}`
    }
    default:
      throw new TokenFailure(
        'T1004',
        `Unsupported $type "${type}". Supported types: ${SUPPORTED_TYPES.join(', ')}.`,
      )
  }
}
