import { parseCssColor } from './color-math'
import { aliasTarget } from './values'

/**
 * Turns the value forms other tools write into the strict DTCG 2025.10 forms Tessera reads: a color is an object
 * (`{ colorSpace, components }`), a dimension is `{ value, unit }`. Earlier drafts and most exporters wrote strings
 * (`"#ff0000"`, `"16px"`), so an importer that only took the strict form would reject nearly every real file.
 * An alias (`{color.primary}`) is always kept as it is.
 */

export interface ConvertContext {
  /** A value was changed or assumed. The importer reports it. */
  note(message: string): void
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/

/** A named font weight, written the way design tools write them ("Semi Bold", "semibold", "SemiBold"). */
const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
  extrablack: 950,
  ultrablack: 950,
}

export function colorFromCss(text: string): Record<string, unknown> | undefined {
  const c = parseCssColor(text)
  if (!c) return undefined
  return {
    colorSpace: c.space,
    components: c.components,
    ...(c.alpha !== 1 ? { alpha: c.alpha } : {}),
  }
}

function unitValue(
  value: unknown,
  units: readonly string[],
  assumed: string,
  ctx: ConvertContext,
  what: string,
): { value: number; unit: string } | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    ctx.note(`A unitless ${what} (${value}) was taken as ${value}${assumed}.`)
    return { value, unit: assumed }
  }
  if (typeof value !== 'string') return undefined
  const m = /^(-?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)$/i.exec(value.trim())
  if (!m) return undefined
  const unit = m[2]!.toLowerCase()
  if (unit === '') {
    ctx.note(`A unitless ${what} ("${value}") was taken as ${m[1]}${assumed}.`)
    return { value: Number(m[1]), unit: assumed }
  }
  return units.includes(unit) ? { value: Number(m[1]), unit } : undefined
}

/**
 * The strict value for `value` of a DTCG `type`, or undefined when it cannot be expressed (the importer then
 * skips the token and says so).
 */
export function toStrict(type: string, value: unknown, ctx: ConvertContext): unknown {
  if (aliasTarget(value) !== undefined) return value
  switch (type) {
    case 'color':
      if (isObject(value)) return value
      return typeof value === 'string' ? colorFromCss(value) : undefined
    case 'dimension': {
      if (isObject(value)) return value
      return unitValue(value, ['px', 'rem'], 'px', ctx, 'dimension')
    }
    case 'duration': {
      if (isObject(value)) return value
      return unitValue(value, ['ms', 's'], 'ms', ctx, 'duration')
    }
    case 'number': {
      if (typeof value === 'number') return value
      return typeof value === 'string' && NUMBER.test(value.trim()) ? Number(value) : undefined
    }
    case 'fontWeight': {
      if (typeof value === 'number') return value
      if (typeof value !== 'string') return undefined
      if (NUMBER.test(value.trim())) return Number(value)
      return WEIGHTS[value.toLowerCase().replace(/[\s_-]+/g, '')]
    }
    case 'fontFamily': {
      if (Array.isArray(value)) return value
      if (typeof value !== 'string') return undefined
      const names = value
        .split(',')
        .map((n) => n.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
      return names.length > 1 ? names : (names[0] ?? undefined)
    }
    case 'cubicBezier': {
      if (Array.isArray(value)) return value
      const m = typeof value === 'string' ? /^cubic-bezier\((.*)\)$/.exec(value.trim()) : null
      return m ? m[1]!.split(',').map((n) => Number(n.trim())) : undefined
    }
    case 'strokeStyle':
      return typeof value === 'string' ? value : undefined
    case 'shadow': {
      const layers = Array.isArray(value) ? value : [value]
      const out: unknown[] = []
      for (const layer of layers) {
        if (aliasTarget(layer) !== undefined) {
          out.push(layer)
          continue
        }
        if (!isObject(layer)) return undefined
        const pick = (...keys: string[]) => keys.map((k) => layer[k]).find((v) => v !== undefined)
        const dims = [
          pick('offsetX', 'x'),
          pick('offsetY', 'y'),
          pick('blur'),
          pick('spread') ?? 0,
        ].map((d) => toStrict('dimension', d, ctx))
        const color = toStrict('color', layer.color, ctx)
        if (dims.some((d) => d === undefined) || color === undefined) return undefined
        const inset = layer.inset === true || layer.type === 'innerShadow'
        out.push({
          offsetX: dims[0],
          offsetY: dims[1],
          blur: dims[2],
          spread: dims[3],
          color,
          ...(inset ? { inset: true } : {}),
        })
      }
      return Array.isArray(value) ? out : out[0]
    }
    case 'border': {
      if (!isObject(value)) return undefined
      const color = toStrict('color', value.color, ctx)
      const width = toStrict('dimension', value.width, ctx)
      const style = typeof value.style === 'string' ? value.style.toLowerCase() : value.style
      if (color === undefined || width === undefined || style === undefined) return undefined
      return { color, width, style }
    }
    case 'transition':
      return isObject(value) ? value : undefined
    default:
      return undefined
  }
}

/**
 * The reverse, for tools that read strings: a strict color becomes a CSS color string, `{ value, unit }`
 * becomes `"16px"`, applied through composite values too.
 */
export function toLoose(value: unknown, colorToCss: (v: unknown) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => toLoose(v, colorToCss))
  if (!isObject(value)) return value
  if (typeof value.colorSpace === 'string') {
    try {
      return colorToCss(value)
    } catch {
      return value
    }
  }
  if (
    typeof value.value === 'number' &&
    typeof value.unit === 'string' &&
    Object.keys(value).length === 2
  ) {
    return `${value.value}${value.unit}`
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toLoose(v, colorToCss)]))
}
