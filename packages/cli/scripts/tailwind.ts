/**
 * Tailwind's default theme, as Tessera design tokens. Pure: it takes the text of Tailwind's `theme.css` and
 * returns the files of the `tailwind` init preset. `generate-tailwind.ts` writes them into `templates/`, and a
 * test checks the committed files are what this produces, so they cannot drift from the source.
 *
 * Tailwind is MIT licensed; `tailwind/LICENSE` ships with the generated folder. Tailwind is data here, not a
 * dependency: the result is an ordinary Tessera design system whose primitives have Tailwind's names and values.
 */

type Json = Record<string, unknown>

const NOTICE = 'Derived from the default theme of Tailwind CSS (MIT).'

/** `--name: value;` declarations of the default theme block, in order. Nested at-rules (keyframes) are skipped. */
export function parseTheme(css: string): Map<string, string> {
  const start = css.indexOf('@theme default {')
  if (start === -1) throw new Error('theme.css has no "@theme default" block')
  const end = css.indexOf('\n}', start)
  const body = css.slice(start + '@theme default {'.length, end)
  const out = new Map<string, string>()
  let depth = 0
  let buffer = ''
  for (const ch of body) {
    if (ch === '{') depth++
    if (depth === 0) buffer += ch
    if (ch === '}') depth--
  }
  for (const m of buffer.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.replace(/\s+/g, ' ').trim())
  }
  return out
}

const num = (n: number) => parseFloat(n.toFixed(6))

/** `3.75rem` becomes a DTCG dimension. */
function dimension(text: string): { value: number; unit: 'px' | 'rem' } {
  const m = /^(-?[\d.]+)(px|rem)$/.exec(text.trim())
  if (!m) throw new Error(`Not a px or rem dimension: ${text}`)
  return { value: num(parseFloat(m[1]!)), unit: m[2] as 'px' | 'rem' }
}

function color(text: string): Json {
  const t = text.trim()
  if (t === '#000') return { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' }
  if (t === '#fff') return { colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' }
  const ok = /^oklch\(([\d.]+)% ([\d.]+|none) ([\d.]+|none)\)$/.exec(t)
  if (!ok) throw new Error(`Not a color Tessera can read: ${text}`)
  return {
    colorSpace: 'oklch',
    components: [
      num(parseFloat(ok[1]!) / 100),
      ok[2] === 'none' ? 'none' : num(parseFloat(ok[2]!)),
      ok[3] === 'none' ? 'none' : num(parseFloat(ok[3]!)),
    ],
  }
}

/** `calc(1.25 / 0.875)` or `1`, as a number. */
function ratio(text: string): number {
  const m = /^calc\(([\d.]+) \/ ([\d.]+)\)$/.exec(text.trim())
  return m ? num(parseFloat(m[1]!) / parseFloat(m[2]!)) : num(parseFloat(text))
}

/** Split on commas that are not inside parentheses. */
function splitTop(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

const px = (n: number) => ({ value: num(n), unit: 'px' as const })

/** `0 1px 3px 0 rgb(0 0 0 / 0.1), ...` as DTCG shadow layers. */
function shadow(text: string): Json[] {
  return splitTop(text).map((layer) => {
    const inset = /^inset\s+/.test(layer)
    const rest = layer.replace(/^inset\s+/, '')
    const m = /^(.*?)\s*rgb\(0 0 0 \/ ([\d.]+)\)$/.exec(rest)
    if (!m) throw new Error(`Not a shadow Tessera can read: ${layer}`)
    const lengths = m[1]!.split(/\s+/).map((v) => parseFloat(v))
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths
    return {
      color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: num(parseFloat(m[2]!)) },
      offsetX: px(x),
      offsetY: px(y),
      blur: px(blur),
      spread: px(spread),
      ...(inset ? { inset: true } : {}),
    }
  })
}

function fontFamily(text: string): string[] {
  return splitTop(text).map((f) => f.replace(/^'(.*)'$/, '$1'))
}

const tier = (t: 'primitive' | 'semantic') => ({ tessera: { tier: t } })

/** Tailwind's spacing scale: the numbers its `p-*` and `gap-*` utilities accept. */
const SPACING = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44,
  48, 52, 56, 60, 64, 72, 80, 96,
]
const OPACITY = Array.from({ length: 21 }, (_, i) => i * 5)
const DURATIONS = [75, 100, 150, 200, 300, 500, 700, 1000]

const token = ($value: unknown, extra: Json = {}): Json => ({ $value, ...extra })
const name = (n: number) => String(n).replace('.', '-')

export interface TailwindFiles {
  /** Path relative to `system/tokens`, to the token file's JSON. */
  [path: string]: Json
}

/** The token files of the preset: primitives, scales, effects, layout, semantic colors and the dark theme. */
export function buildTailwindTokens(css: string): TailwindFiles {
  const theme = parseTheme(css)
  const group = (prefix: string) =>
    [...theme].filter(
      ([k]) => k.startsWith(`--${prefix}-`) && !k.includes('--', 2 + prefix.length + 1),
    )
  const rest = (key: string, prefix: string) => key.slice(`--${prefix}-`.length)

  // --- colors: every palette and shade, plus black and white -------------------------------------------
  const palette: Json = {}
  for (const [key, value] of group('color')) {
    const [paletteName, shade] = rest(key, 'color').split(/-(?=\d)/) as [string, string | undefined]
    if (shade === undefined) palette[paletteName] = token(color(value))
    else {
      const entry = (palette[paletteName] ??= {}) as Json
      entry[shade] = token(color(value))
    }
  }
  const colors: Json = {
    $description: NOTICE,
    color: { $type: 'color', $extensions: tier('primitive'), ...palette },
  }

  // --- scales ----------------------------------------------------------------------------------------
  const unit = dimension(theme.get('--spacing')!)
  const space: Json = { $type: 'dimension', $extensions: tier('semantic') }
  for (const n of SPACING) space[name(n)] = token({ value: num(n * unit.value), unit: unit.unit })
  space['px'] = token({ value: 1, unit: 'px' })

  const radius: Json = { $type: 'dimension', $extensions: tier('semantic'), none: token(px(0)) }
  for (const [key, value] of group('radius')) radius[rest(key, 'radius')] = token(dimension(value))
  radius['full'] = token(px(9999))

  const size: Json = { $type: 'dimension' }
  const sizeLeading: Json = { $type: 'number' }
  for (const [key, value] of group('text')) {
    if (key.includes('--line-height') || key.startsWith('--text-shadow-')) continue
    const n = rest(key, 'text')
    size[n] = token(dimension(value))
    sizeLeading[n] = token(ratio(theme.get(`${key}--line-height`)!))
  }
  const weight: Json = { $type: 'fontWeight' }
  for (const [key, value] of group('font-weight')) {
    weight[rest(key, 'font-weight')] = token(parseInt(value, 10))
  }
  const tracking: Json = { $type: 'number' }
  for (const [key, value] of group('tracking'))
    tracking[rest(key, 'tracking')] = token(ratio(value.replace('em', '')))
  const leading: Json = { $type: 'number' }
  for (const [key, value] of group('leading')) leading[rest(key, 'leading')] = token(ratio(value))
  const family: Json = { $type: 'fontFamily' }
  for (const key of ['--font-sans', '--font-serif', '--font-mono']) {
    family[key.slice('--font-'.length)] = token(fontFamily(theme.get(key)!))
  }

  const scale: Json = {
    $description: NOTICE,
    space,
    radius,
    font: {
      $extensions: tier('semantic'),
      family,
      size,
      'size-leading': sizeLeading,
      weight,
      leading,
      tracking,
    },
  }

  // --- effects ---------------------------------------------------------------------------------------
  const shadows: Json = { $type: 'shadow', $extensions: tier('semantic') }
  for (const [key, value] of [...theme]) {
    if (/^--shadow-[a-z0-9]+$/.test(key)) shadows[rest(key, 'shadow')] = token(shadow(value))
    if (key.startsWith('--inset-shadow-'))
      shadows[`inset-${rest(key, 'inset-shadow')}`] = token(shadow(value))
  }
  const textShadow: Json = { $type: 'shadow', $extensions: tier('semantic') }
  for (const [key, value] of group('text-shadow'))
    textShadow[rest(key, 'text-shadow')] = token(shadow(value))
  const dropShadow: Json = { $type: 'shadow', $extensions: tier('semantic') }
  for (const [key, value] of group('drop-shadow'))
    dropShadow[rest(key, 'drop-shadow')] = token(shadow(value))
  const blur: Json = { $type: 'dimension', $extensions: tier('semantic') }
  for (const [key, value] of group('blur')) blur[rest(key, 'blur')] = token(dimension(value))

  const duration: Json = { $type: 'duration' }
  for (const ms of DURATIONS) duration[String(ms)] = token({ value: ms, unit: 'ms' })
  duration['fast'] = token('{motion.duration.150}')
  duration['base'] = token('{motion.duration.200}')
  duration['slow'] = token('{motion.duration.300}')
  const easing: Json = { $type: 'cubicBezier' }
  for (const [key, value] of group('ease')) {
    const m = /^cubic-bezier\(([^)]*)\)$/.exec(value)!
    easing[rest(key, 'ease')] = token(m[1]!.split(',').map((v) => num(parseFloat(v))))
  }
  const opacity: Json = { $type: 'number', $extensions: tier('semantic') }
  for (const n of OPACITY) opacity[String(n)] = token(num(n / 100))
  opacity['disabled'] = token('{opacity.50}')

  const effects: Json = {
    $description: NOTICE,
    shadow: shadows,
    'text-shadow': textShadow,
    'drop-shadow': dropShadow,
    blur,
    motion: { $extensions: tier('semantic'), duration, easing },
    opacity,
  }

  // --- layout ----------------------------------------------------------------------------------------
  const breakpoint: Json = { $type: 'dimension' }
  for (const [key, value] of group('breakpoint'))
    breakpoint[rest(key, 'breakpoint')] = token(dimension(value))
  const container: Json = { $type: 'dimension' }
  for (const [key, value] of group('container'))
    container[rest(key, 'container')] = token(dimension(value))
  const perspective: Json = { $type: 'dimension' }
  for (const [key, value] of group('perspective'))
    perspective[rest(key, 'perspective')] = token(dimension(value))
  const layout: Json = {
    $description: NOTICE,
    breakpoint: { ...breakpoint, $extensions: tier('semantic') },
    container: { ...container, $extensions: tier('semantic') },
    perspective: { ...perspective, $extensions: tier('semantic') },
    aspect: { $type: 'number', $extensions: tier('semantic'), video: token(num(16 / 9)) },
  }

  // --- semantic colors and the dark theme --------------------------------------------------------------
  const c = (path: string) => token(`{color.${path}}`)
  const semantic = (v: {
    surface: string
    raised: string
    hover: string
    inverse: string
    text: string
    muted: string
    onInverse: string
    border: string
    borderStrong: string
    primary: string
    primaryHover: string
    primaryText: string
    danger: string
    dangerHover: string
    dangerText: string
    focus: string
    success: string
    brandStart: string
    brandEnd: string
  }): Json => ({
    color: {
      surface: {
        default: c(v.surface),
        raised: c(v.raised),
        hover: c(v.hover),
        inverse: c(v.inverse),
      },
      text: { default: c(v.text), muted: c(v.muted), inverse: c(v.onInverse) },
      border: { default: c(v.border), strong: c(v.borderStrong) },
      action: {
        primary: {
          bg: c(v.primary),
          'bg-hover': c(v.primaryHover),
          fg: c('white'),
          text: c(v.primaryText),
        },
        danger: {
          bg: c(v.danger),
          'bg-hover': c(v.dangerHover),
          fg: c('white'),
          text: c(v.dangerText),
        },
      },
      focus: { ring: c(v.focus) },
      status: { success: c(v.success), danger: c(v.dangerText) },
      brand: { start: c(v.brandStart), end: c(v.brandEnd) },
    },
  })

  const light = semantic({
    surface: 'white',
    raised: 'slate.50',
    hover: 'slate.100',
    inverse: 'slate.900',
    text: 'slate.900',
    muted: 'slate.600',
    onInverse: 'white',
    border: 'slate.200',
    borderStrong: 'slate.300',
    primary: 'indigo.600',
    primaryHover: 'indigo.700',
    primaryText: 'indigo.700',
    danger: 'red.600',
    dangerHover: 'red.700',
    dangerText: 'red.700',
    focus: 'indigo.600',
    success: 'green.700',
    brandStart: 'indigo.500',
    brandEnd: 'violet.500',
  })
  const dark = semantic({
    surface: 'slate.950',
    raised: 'slate.900',
    hover: 'slate.800',
    inverse: 'slate.50',
    text: 'slate.50',
    muted: 'slate.300',
    onInverse: 'slate.900',
    border: 'slate.800',
    borderStrong: 'slate.700',
    primary: 'indigo.600',
    primaryHover: 'indigo.500',
    primaryText: 'indigo.300',
    danger: 'red.600',
    dangerHover: 'red.700',
    dangerText: 'red.300',
    focus: 'indigo.400',
    success: 'green.400',
    brandStart: 'indigo.400',
    brandEnd: 'violet.400',
  })
  const tagSemantic = (tree: Json): Json => ({
    $type: 'color',
    ...Object.fromEntries(Object.entries(tree)),
  })
  const semanticFile: Json = {
    $description: 'Semantic colors: what components use. Primitives are in colors.tokens.json.',
    color: { $extensions: tier('semantic'), $type: 'color', ...(light.color as Json) },
  }
  void tagSemantic

  return {
    'colors.tokens.json': colors,
    'scale.tokens.json': scale,
    'effects.tokens.json': effects,
    'layout.tokens.json': layout,
    'semantic.tokens.json': semanticFile,
    'themes/dark.tokens.json': {
      $extends: 'base',
      $auto: 'prefers-color-scheme: dark',
      color: dark.color as Json,
    },
  }
}
