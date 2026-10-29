import { parseCssColor } from './color-math'
import type { TokenDiagnostic } from './errors'
import { isObject, sanitizeName, warn, type Doc, type InterchangeFile } from './interchange'

/**
 * The loose reader. A team's tokens are rarely in a token format: they are CSS custom properties, or the JSON of
 * Style Dictionary, which has no types. This reads them without asking the person to rename or restructure anything:
 * the names stay as written (a CSS `--color-brand-600` is the token `color.brand.600`), and a type is told from the
 * value (`#1d4ed8` is a color, `1rem` a dimension, `200ms` a duration) and, where a number could be several things,
 * from the words in the name. What cannot be told is left out and counted in a note, never guessed.
 */

type Hint = (joined: string) => boolean
const hint =
  (re: RegExp): Hint =>
  (joined) =>
    re.test(joined)

const WEIGHT = hint(/(^|-)(font-weight|weight|weights|fontweight)(-|$)/)
const OPACITY = hint(/(^|-)(opacity|alpha)(-|$)/)
const LEADING = hint(/(^|-)(line-height|lineheight|leading|line-heights|lineheights)(-|$)/)
const LENGTH = hint(
  /(^|-)(space|spacing|spaces|gap|size|sizes|radius|radii|rounded|width|widths|height|heights|padding|margin|inset|stroke|breakpoint|breakpoints|screen|screens|container)(-|$)/,
)
const DURATION = hint(/(^|-)(duration|durations|delay|delays)(-|$)/)
const SHADOW = hint(/(^|-)(shadow|shadows|elevation|elevations)(-|$)/)
const FAMILY = hint(/(^|-)(family|families|typeface|typefaces|font-sans|font-serif|font-mono)(-|$)/)

const NUM = '-?(?:\\d+\\.?\\d*|\\.\\d+)'
const NUMBER = new RegExp(`^${NUM}$`)
const LENGTH_VALUE = new RegExp(
  `^${NUM}(px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt|cm|mm|in|pc|svh|dvh|lvh)$`,
  'i',
)
const DURATION_VALUE = new RegExp(`^${NUM}(ms|s)$`, 'i')
const GENERIC_FAMILY =
  /(^|,)\s*(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|emoji|math|fangsong)\s*(,|$)/i
const BORDER_STYLES = new Set([
  'none',
  'hidden',
  'dotted',
  'dashed',
  'solid',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
])
const WEIGHT_WORDS =
  /^(thin|hairline|extralight|ultralight|light|normal|regular|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy)$/i

/** The pieces of `text` outside brackets and quotes, split on `separator`. */
export function splitTop(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0 && c === separator) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** Words of a value split on whitespace outside brackets and quotes. */
function words(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quote) {
      current += c
      if (c === '\\') current += text[++i] ?? ''
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
      current += c
    } else if (c === '(') {
      depth++
      current += c
    } else if (c === ')') {
      depth = Math.max(0, depth - 1)
      current += c
    } else if (depth === 0 && /\s/.test(c)) {
      if (current) out.push(current)
      current = ''
    } else current += c
  }
  if (current) out.push(current)
  return out
}

const isColor = (text: string) => parseCssColor(text) !== undefined
const isLength = (text: string) => LENGTH_VALUE.test(text) || text === '0'
const isAlias = (text: unknown): boolean =>
  typeof text === 'string' && /^\{[^{}]+\}$/.test(text.trim())

/** `0 1px 2px rgb(0 0 0 / 5%)` as the object layers a shadow token has, or undefined if it is not a shadow. */
function parseShadow(text: string, needsColor: boolean): Doc | Doc[] | undefined {
  const layers = splitTop(text, ',').map((layer) => {
    const parts = words(layer.trim())
    let inset = false
    const rest = parts.filter((p) => {
      if (p.toLowerCase() === 'inset') {
        inset = true
        return false
      }
      return true
    })
    // The color is the one word that is not a length, first or last.
    const colorAt = rest.findIndex((p) => !isLength(p))
    const lengths = rest.filter((p) => isLength(p))
    if (lengths.length < 2 || lengths.length > 4 || rest.length - lengths.length > 1)
      return undefined
    if (colorAt === -1 && needsColor) return undefined
    const color = colorAt === -1 ? 'rgb(0 0 0)' : rest[colorAt]!
    if (colorAt !== -1 && !isColor(color) && !isAlias(color)) return undefined
    const [x, y, blur = '0', spread = '0'] = lengths
    return { offsetX: x, offsetY: y, blur, spread, color, ...(inset ? { inset: true } : {}) } as Doc
  })
  if (layers.some((l) => l === undefined)) return undefined
  return layers.length === 1 ? layers[0]! : (layers as Doc[])
}

/** `1px solid #ccc` as a border token's object, or undefined. */
function parseBorder(text: string): Doc | undefined {
  const parts = words(text)
  if (parts.length < 2 || parts.length > 3) return undefined
  const width = parts.find((p) => isLength(p))
  const style = parts.find((p) => BORDER_STYLES.has(p.toLowerCase()))
  const rest = parts.filter((p) => p !== width && p !== style)
  if (!width || !style || rest.length > 1) return undefined
  const color = rest[0] ?? 'rgb(0 0 0)'
  if (!isColor(color) && !isAlias(color)) return undefined
  return { width, style, color }
}

export interface Inferred {
  type: string
  value: unknown
}

/**
 * The type and DTCG value of a token that has none, told from its value and the words of its name (`path`), or
 * undefined if it cannot be told. An alias has no value to tell it from: the caller gives it the type of its target.
 */
export function inferToken(path: string[], value: unknown): Inferred | undefined {
  const joined = path.join('-').toLowerCase()
  if (typeof value === 'number') return inferNumber(joined, String(value))
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '' || isAlias(text)) return undefined

  if (NUMBER.test(text)) return inferNumber(joined, text)
  if (isColor(text)) return { type: 'color', value: text }
  if (LENGTH_VALUE.test(text)) {
    if (text.endsWith('%')) {
      const n = Number(text.slice(0, -1)) / 100
      if (OPACITY(joined) || LEADING(joined)) return { type: 'number', value: n }
    }
    return { type: 'dimension', value: text }
  }
  if (DURATION_VALUE.test(text)) return { type: 'duration', value: text }
  if (/^cubic-bezier\(/i.test(text)) return { type: 'cubicBezier', value: text }
  const shadow = parseShadow(text, !SHADOW(joined))
  if (shadow) return { type: 'shadow', value: shadow }
  const border = parseBorder(text)
  if (border) return { type: 'border', value: border }
  if (WEIGHT(joined) && WEIGHT_WORDS.test(text.replace(/[\s_-]+/g, ''))) {
    return { type: 'fontWeight', value: text }
  }
  if (GENERIC_FAMILY.test(text) || (FAMILY(joined) && /^["'A-Za-z]/.test(text))) {
    return { type: 'fontFamily', value: text }
  }
  return undefined
}

/** A bare number is a weight, an opacity, a line height, a length or a duration by its name, and a number otherwise. */
function inferNumber(joined: string, text: string): Inferred {
  const n = Number(text)
  if (WEIGHT(joined)) return { type: 'fontWeight', value: n }
  if (OPACITY(joined) || LEADING(joined)) return { type: 'number', value: n }
  if (DURATION(joined)) return { type: 'duration', value: n === 0 ? '0ms' : `${text}ms` }
  if (LENGTH(joined)) return { type: 'dimension', value: n === 0 ? '0px' : `${text}px` }
  return { type: 'number', value: n }
}

/** An example in a note is one line and short: a real shadow or font stack can run to hundreds of characters. */
const shorten = (text: string): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 100 ? `${one.slice(0, 97)}...` : one
}

/** What is left out, counted: `reason: N, for example "x".` */
class Skips {
  private reasons = new Map<string, { count: number; example: string }>()
  add(reason: string, example: string) {
    const entry = this.reasons.get(reason)
    if (entry) entry.count++
    else this.reasons.set(reason, { count: 1, example: shorten(example) })
  }
  notes(file: string): TokenDiagnostic[] {
    return [...this.reasons].map(([reason, { count, example }]) =>
      warn(file, `${reason}: ${count}, for example "${example}".`),
    )
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// CSS custom properties
// ---------------------------------------------------------------------------------------------------------------------

const ROOT_LIKE = /^(:root|html|:host|\*|body|\[data-theme=["']?light["']?\]|\.light)$/i
const TRANSPARENT_AT = new Set(['layer', 'theme', 'supports', 'tailwind', 'config'])

interface Declaration {
  name: string
  value: string
}

interface CssRead {
  declarations: Declaration[]
  /** Custom properties of a theme (`.dark`, `[data-theme=dark]`, `prefers-color-scheme: dark`), by the theme's name. */
  themes: Map<string, { auto: boolean; declarations: Declaration[] }>
  /** Custom properties in a selector or condition that is not the root or a theme (a component), by selector. */
  elsewhere: Map<string, number>
}

/** The root, with conditions on it that leave it the root (`:root:not([data-theme=light])`). */
const ROOTISH = /^(:root|html|:host|\*|body)(:not\([^)]*\))*$/i

/** Attributes a page switches its theme with. */
const THEME_ATTRIBUTES = new Set([
  'data-theme',
  'data-bs-theme',
  'data-color-mode',
  'data-color-scheme',
  'data-mode',
  'data-theme-mode',
  'data-md-color-scheme',
])

/**
 * The theme a selector switches on, by name: `.dark`, `.theme-dark`, `html.dark`, `:root[data-theme="dark"]`,
 * `[data-bs-theme=dark]`. Not a descendant (`.dark .card`), and not `light`, which is the root.
 */
function themeOf(selector: string): string | undefined {
  const rest = selector.trim().replace(/^(:root|html|:host|body|\*)(?=[.[])/i, '')
  const attr = /^\[([\w-]+)\s*=\s*["']?([\w-]+)["']?\]$/.exec(rest)
  if (attr) {
    const value = attr[2]!.toLowerCase()
    return THEME_ATTRIBUTES.has(attr[1]!.toLowerCase()) && value !== 'light'
      ? sanitizeName(value) || undefined
      : undefined
  }
  const cls = /^\.([\w-]+)$/.exec(rest)
  if (cls && /(^|[-_])dark([-_]|$)/i.test(cls[1]!)) return 'dark'
  return undefined
}

/** The light theme is the root: `[data-bs-theme=light]`, `.light`, `:root.theme-light` say what the root already is. */
function isLight(selector: string): boolean {
  const rest = selector.trim().replace(/^(:root|html|:host|body|\*)(?=[.[])/i, '')
  const attr = /^\[([\w-]+)\s*=\s*["']?light["']?\]$/i.exec(rest)
  if (attr) return THEME_ATTRIBUTES.has(attr[1]!.toLowerCase())
  const cls = /^\.([\w-]+)$/.exec(rest)
  return !!cls && /(^|[-_])light([-_]|$)/i.test(cls[1]!)
}

const isDarkMedia = (head: string): boolean =>
  /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/i.test(head.trim())

/** The text between `start` (just after a `{`) and its matching `}`, and where that `}` is. */
function matchBrace(css: string, start: number): number {
  let depth = 1
  let quote = ''
  for (let i = start; i < css.length; i++) {
    const c = css[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return css.length
}

/** The declarations of a rule body, and the nested rules it contains. */
function splitBody(body: string): {
  declarations: string[]
  nested: Array<{ head: string; body: string }>
} {
  const declarations: string[] = []
  const nested: Array<{ head: string; body: string }> = []
  let i = 0
  let statement = ''
  let depth = 0
  let quote = ''
  while (i < body.length) {
    const c = body[i]!
    if (quote) {
      statement += c
      if (c === '\\') statement += body[++i] ?? ''
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
      statement += c
    } else if (c === '(') {
      depth++
      statement += c
    } else if (c === ')') {
      depth = Math.max(0, depth - 1)
      statement += c
    } else if (c === '{' && depth === 0) {
      const end = matchBrace(body, i + 1)
      nested.push({ head: statement.trim(), body: body.slice(i + 1, end) })
      statement = ''
      i = end
    } else if (c === ';' && depth === 0) {
      if (statement.trim()) declarations.push(statement.trim())
      statement = ''
    } else statement += c
    i++
  }
  if (statement.trim()) declarations.push(statement.trim())
  return { declarations, nested }
}

function readCss(source: string): CssRead {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const read: CssRead = { declarations: [], themes: new Map(), elsewhere: new Map() }

  const customProperties = (declarations: string[]): Declaration[] =>
    declarations.flatMap((d) => {
      const colon = d.indexOf(':')
      if (colon === -1 || !d.startsWith('--')) return []
      return [
        {
          name: d.slice(2, colon).trim(),
          value: d
            .slice(colon + 1)
            .replace(/\s*!important\s*$/i, '')
            .trim(),
        },
      ]
    })

  /** Where the custom properties of a block go: the root, a theme, or nowhere we read. */
  type Target =
    { kind: 'root' } | { kind: 'theme'; name: string; auto: boolean } | { kind: 'other' }
  /** What the rules inside a block can be: at the root, inside `@media (prefers-color-scheme: dark)`, or neither. */
  type Container = 'root' | 'dark-media' | 'other'

  const walk = (text: string, context: string[], target: Target, container: Container) => {
    const { declarations, nested } = splitBody(text)
    const found = customProperties(declarations)
    if (target.kind === 'root') read.declarations.push(...found)
    else if (target.kind === 'theme') {
      const theme = read.themes.get(target.name) ?? { auto: false, declarations: [] }
      theme.auto ||= target.auto
      theme.declarations.push(...found)
      read.themes.set(target.name, theme)
    } else if (found.length) {
      const where = context.join(' ').replace(/\s+/g, ' ') || 'the file'
      read.elsewhere.set(where, (read.elsewhere.get(where) ?? 0) + found.length)
    }
    for (const { head, body } of nested) {
      if (head.startsWith('@')) {
        const at = /^@([\w-]+)/.exec(head)![1]!.toLowerCase()
        if (container === 'root' && TRANSPARENT_AT.has(at)) {
          walk(body, [...context, head], { kind: 'root' }, 'root')
        } else if (container === 'root' && isDarkMedia(head)) {
          walk(body, [...context, head], { kind: 'other' }, 'dark-media')
        } else walk(body, [...context, head], { kind: 'other' }, 'other')
        continue
      }
      const selectors = splitTop(head, ',').map((s) => s.trim())
      let inner: Target = { kind: 'other' }
      if (container === 'root') {
        const names = new Set(selectors.map(themeOf))
        if (selectors.every((s) => ROOTISH.test(s) || ROOT_LIKE.test(s) || isLight(s))) {
          inner = { kind: 'root' }
        } else if (names.size === 1 && !names.has(undefined)) {
          inner = { kind: 'theme', name: [...names][0]!, auto: false }
        }
      } else if (container === 'dark-media') {
        if (selectors.every((s) => ROOTISH.test(s) || themeOf(s) === 'dark')) {
          inner = { kind: 'theme', name: 'dark', auto: true }
        }
      }
      walk(body, [...context, head], inner, 'other')
    }
  }
  // The top level is "the file": a rule there is the root or a theme or neither, an at-rule is looked into.
  const statements = /@(import|charset|namespace|tailwind|plugin|source|config)\b[^;{]*;/gi
  walk(css.replace(statements, ''), [], { kind: 'other' }, 'root')
  return read
}

const VAR = /^var\(\s*--([^,\s)]+)\s*(?:,\s*([\s\S]+))?\)$/

/** A theme read from a CSS file: its name, whether the system's setting turns it on, and the tokens it overrides. */
export interface CssTheme {
  name: string
  auto: boolean
  doc: Doc
}

export interface CssTokens {
  doc: Doc
  themes: CssTheme[]
}

/** The tokens in a CSS file as a DTCG document with loose values, its themes, and what could not be read. */
export function cssToDoc(
  source: string,
  file: string,
  diagnostics: TokenDiagnostic[],
): CssTokens | undefined {
  const read = readCss(source)
  const skips = new Skips()

  // Last write wins, as it does in the cascade.
  const declared = new Map<string, string>()
  for (const d of read.declarations) declared.set(d.name, d.value)
  if (declared.size === 0 && read.themes.size === 0 && read.elsewhere.size === 0) return undefined

  const segmentsOf = (name: string) =>
    name
      .split('-')
      .map((s) => sanitizeName(s))
      .filter(Boolean)
  const segments = new Map<string, string[]>()
  for (const name of declared.keys()) {
    const s = segmentsOf(name)
    if (s.length) segments.set(name, s)
  }
  // A name that is also the start of another (`--primary` and `--primary-foreground`) is the group's `$root`.
  const prefixes = new Set<string>()
  for (const s of segments.values())
    for (let i = 1; i < s.length; i++) prefixes.add(s.slice(0, i).join('.'))
  const finalPath = (name: string): string[] => {
    const s = segments.get(name)!
    return prefixes.has(s.join('.')) ? [...s, '$root'] : s
  }
  const aliasOf = (name: string) => `{${finalPath(name).join('.')}}`

  /** A value with its `var()` references made into aliases, or undefined if some cannot be. */
  const resolve = (value: string, seen: Set<string>): string | undefined => {
    const m = VAR.exec(value)
    if (!m) return value
    const target = m[1]!
    if (segments.has(target) && !seen.has(target)) return aliasOf(target)
    if (m[2] !== undefined) return resolve(m[2].trim(), seen)
    return undefined
  }

  /**
   * One declaration as a token: an alias (which takes its target's type later), or a typed value. A value that cannot
   * be one is counted in `skips` and gives undefined. `where` says what it is in the note.
   */
  const convert = (
    name: string,
    raw: string,
    where: string,
    group: string,
  ): { token: Doc; target?: string } | undefined => {
    const path = finalPath(name)
    const resolved = resolve(raw, new Set([name]))
    if (resolved === undefined) {
      skips.add(`Values that refer to a custom property the file does not define${group}`, where)
      return undefined
    }
    if (isAlias(resolved)) {
      const target = [...segments.keys()].find((n) => aliasOf(n) === resolved)!
      return { token: { $value: resolved }, target }
    }
    // `var()` inside a larger value: only a shadow or border can hold a reference (to its color).
    let text = resolved
    if (/\bvar\(/.test(text)) {
      text = text.replace(
        /var\(\s*--([^,\s)]+)\s*(?:,\s*([^)]+))?\)/g,
        (all, n: string, fallback?: string) => {
          if (segments.has(n)) return aliasOf(n)
          return fallback?.trim() ?? all
        },
      )
      if (/\bvar\(/.test(text)) {
        skips.add(`Values that mix a custom property into a longer expression${group}`, where)
        return undefined
      }
    }
    if (/\b(calc|clamp|min|max|env|attr|url)\(/i.test(text) && !isColor(text)) {
      skips.add(
        `Values computed with calc(), clamp(), min(), max() or url() (a token is one value)${group}`,
        where,
      )
      return undefined
    }
    const inferred = inferToken(path, text)
    if (!inferred) {
      skips.add(
        `Values whose type could not be told (a keyword, a gradient, a font shorthand)${group}`,
        where,
      )
      return undefined
    }
    return { token: { $type: inferred.type, $value: inferred.value } }
  }

  const entries: Array<{ name: string; path: string[]; token: Doc; target?: string }> = []
  for (const [name, raw] of declared) {
    if (!segments.has(name)) continue
    const got = convert(name, raw, `--${name}: ${raw}`, '')
    if (got) entries.push({ name, path: finalPath(name), ...got })
  }

  // An alias takes its target's type (following a chain), or is left out with its target.
  const byName = new Map(entries.map((e) => [e.name, e]))
  const typeOf = (name: string, depth = 0): string | undefined => {
    const entry = byName.get(name)
    if (!entry || depth > 20) return undefined
    if (typeof entry.token.$type === 'string') return entry.token.$type
    return entry.target ? typeOf(entry.target, depth + 1) : undefined
  }
  const kept: typeof entries = []
  for (const e of entries) {
    if (typeof e.token.$type !== 'string') {
      const type = typeOf(e.name)
      if (!type) {
        skips.add('Values that refer to a custom property that could not be read', `--${e.name}`)
        continue
      }
      e.token.$type = type
    }
    kept.push(e)
  }
  const keptByName = new Map(kept.map((e) => [e.name, e]))

  const place = (doc: Doc, path: string[], token: Doc) => {
    let node = doc
    for (const segment of path.slice(0, -1)) {
      node[segment] =
        isObject(node[segment]) && !('$value' in (node[segment] as Doc)) ? node[segment] : {}
      node = node[segment] as Doc
    }
    node[path[path.length - 1]!] = token
  }
  const doc: Doc = {}
  for (const { path, token } of kept) place(doc, path, token)

  // A theme overrides tokens of the root: a name it declares that the root does not is left out, and so is a value
  // that would change a token's type (the build takes a theme's type from the base).
  const themes: CssTheme[] = []
  for (const [themeName, theme] of read.themes) {
    const values = new Map<string, string>()
    for (const d of theme.declarations) values.set(d.name, d.value)
    const group = ` (in the ${themeName} theme)`
    const themeDoc: Doc = {}
    for (const [name, raw] of values) {
      const base = keptByName.get(name)
      if (!base) {
        if (!declared.has(name)) {
          skips.add(
            `Custom properties only in the ${themeName} theme, not in the root`,
            `--${name}: ${raw}`,
          )
        }
        continue
      }
      // The same value as the root's says nothing.
      if (raw === declared.get(name)) continue
      const got = convert(name, raw, `--${name}: ${raw}`, group)
      if (!got) continue
      const type = typeof got.token.$type === 'string' ? got.token.$type : typeOf(got.target ?? '')
      if (type !== base.token.$type) {
        skips.add(`Values that would change a token's type${group}`, `--${name}: ${raw}`)
        continue
      }
      place(themeDoc, base.path, { $value: got.token.$value })
    }
    if (Object.keys(themeDoc).length)
      themes.push({ name: themeName, auto: theme.auto, doc: themeDoc })
  }

  diagnostics.push(...skips.notes(file))
  if (read.elsewhere.size) {
    const total = [...read.elsewhere.values()].reduce((a, b) => a + b, 0)
    const [example] = [...read.elsewhere.keys()]
    diagnostics.push(
      warn(
        file,
        `Custom properties outside the root and its themes (a component, a media query) were not imported: ${total} in ${read.elsewhere.size} place${read.elsewhere.size === 1 ? '' : 's'}, for example in "${example}".`,
      ),
    )
  }
  return Object.keys(doc).length || themes.length ? { doc, themes } : undefined
}

// ---------------------------------------------------------------------------------------------------------------------
// JSON without types (Style Dictionary and the like)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Gives a type to the tokens of a JSON document that have none, or have one Tessera does not know (Style Dictionary's
 * `size`, `time`, `other`), and removes the `.value` its references end with. A token it cannot type is removed and
 * counted. Tokens with a known type are not touched.
 */
export function typeJson(
  doc: Doc,
  file: string,
  isKnownType: (type: string) => boolean,
  diagnostics: TokenDiagnostic[],
): void {
  const skips = new Skips()
  const tokens: Array<{
    path: string[]
    node: Doc
    parent: Doc
    key: string
    type: string | undefined
  }> = []
  const walk = (node: Doc, path: string[], inherited: string | undefined) => {
    const groupType =
      typeof node.$type === 'string'
        ? node.$type
        : typeof node.type === 'string'
          ? node.type
          : undefined
    const type = groupType ?? inherited
    for (const [key, child] of Object.entries(node)) {
      if (!isObject(child) || (key.startsWith('$') && key !== '$root')) continue
      if ('value' in child || '$value' in child) {
        const own =
          typeof child.$type === 'string'
            ? child.$type
            : typeof child.type === 'string'
              ? child.type
              : undefined
        tokens.push({ path: [...path, key], node: child, parent: node, key, type: own ?? type })
      } else walk(child, [...path, key], type)
    }
  }
  walk(doc, [], undefined)

  const valueKey = (n: Doc) => ('$value' in n ? '$value' : 'value')
  // Style Dictionary writes a reference to a token's value: {color.brand.value}.
  const fixRef = (v: unknown): unknown =>
    typeof v === 'string' ? v.replace(/\{([^{}]+)\.value\}/g, '{$1}') : v
  for (const t of tokens) {
    const k = valueKey(t.node)
    t.node[k] = fixRef(t.node[k])
  }

  const dot = (p: string[]) => p.join('.')
  const typeByPath = new Map<string, string>()
  for (const t of tokens) if (t.type && isKnownType(t.type)) typeByPath.set(dot(t.path), t.type)

  const apply = (t: (typeof tokens)[number], type: string, value?: unknown) => {
    const legacy = !('$value' in t.node)
    t.node[legacy ? 'type' : '$type'] = type
    if (value !== undefined) t.node[valueKey(t.node)] = value
    typeByPath.set(dot(t.path), type)
  }
  const pending: typeof tokens = []
  const removed = new Set<string>()
  for (const t of tokens) {
    if (t.type && isKnownType(t.type)) continue
    const value = t.node[valueKey(t.node)]
    // A composite of a type Tessera does not have is left for the import to keep and report.
    if (t.type && typeof value !== 'string' && typeof value !== 'number') continue
    if (isAlias(value)) {
      pending.push(t)
      continue
    }
    const inferred = inferToken(t.path, value)
    if (inferred) apply(t, inferred.type, inferred.value)
    else if (!t.type) {
      skips.add('Tokens whose type could not be told', `${dot(t.path)}: ${JSON.stringify(value)}`)
      delete t.parent[t.key]
      removed.add(dot(t.path))
    }
  }
  // An alias takes the type of what it refers to, which may itself have been one.
  for (let changed = true; changed && pending.length;) {
    changed = false
    for (let i = pending.length - 1; i >= 0; i--) {
      const t = pending[i]!
      const target = String(t.node[valueKey(t.node)]).trim().slice(1, -1)
      const type = typeByPath.get(target)
      if (type) {
        apply(t, type)
        pending.splice(i, 1)
        changed = true
      }
    }
  }
  // An alias to a token removed above cannot stand either. Any other alias is left for the import to check.
  for (let changed = true; changed;) {
    changed = false
    for (const t of pending) {
      const target = String(t.node[valueKey(t.node)]).trim().slice(1, -1)
      if (removed.has(target) && !removed.has(dot(t.path))) {
        skips.add('Tokens that refer to a token that could not be typed', dot(t.path))
        delete t.parent[t.key]
        removed.add(dot(t.path))
        changed = true
      }
    }
  }
  diagnostics.push(...skips.notes(file))
}

/** Looks like the JSON of tokens Tessera should type, not a resolver, a themes list or an empty document. */
const isTypeable = (doc: unknown): doc is Doc =>
  isObject(doc) &&
  !Array.isArray(doc.resolutionOrder) &&
  !('$themes' in doc) &&
  !('$metadata' in doc) &&
  !('$extends' in doc)

/**
 * The files an import starts from: a CSS file becomes a token file, and a JSON file has its untyped tokens typed.
 * Resolver and Tokens Studio exports are left as they are (their themes override a token without repeating its type).
 */
export function prepareFiles(
  files: InterchangeFile[],
  isKnownType: (type: string) => boolean,
  diagnostics: TokenDiagnostic[],
): InterchangeFile[] {
  const named = (path: string) => path.replaceAll('\\', '/').split('/').pop()!
  const sets = files.some((f) => ['$themes.json', '$metadata.json'].includes(named(f.path)))
  const resolver = files.some((f) => {
    try {
      return Array.isArray((JSON.parse(f.content) as Doc).resolutionOrder)
    } catch {
      return false
    }
  })
  const out: InterchangeFile[] = []
  for (const f of files) {
    if (/\.css$/i.test(f.path)) {
      const got = cssToDoc(f.content, f.path, diagnostics)
      if (got) {
        const folder = f.path.replace(/[^/\\]*$/, '')
        const base = named(f.path).replace(/\.css$/i, '')
        if (Object.keys(got.doc).length) {
          out.push({
            path: `${folder}${base}.tokens.json`,
            content: JSON.stringify(got.doc, null, 2) + '\n',
          })
        }
        // A theme is a file that extends the base, as a project writes one: the import reads it as a theme.
        for (const theme of got.themes) {
          out.push({
            path: `${folder}themes/${theme.name}.tokens.json`,
            content:
              JSON.stringify(
                {
                  $extends: 'base',
                  ...(theme.auto ? { $auto: 'prefers-color-scheme: dark' } : {}),
                  ...theme.doc,
                },
                null,
                2,
              ) + '\n',
          })
        }
      } else diagnostics.push(warn(f.path, 'No custom properties were found in this file.'))
      continue
    }
    if (sets || resolver) {
      out.push(f)
      continue
    }
    let doc: unknown
    try {
      doc = JSON.parse(f.content)
    } catch {
      out.push(f)
      continue
    }
    if (!isTypeable(doc)) {
      out.push(f)
      continue
    }
    typeJson(doc, f.path, isKnownType, diagnostics)
    out.push({ path: f.path, content: JSON.stringify(doc, null, 2) + '\n' })
  }
  return out
}
