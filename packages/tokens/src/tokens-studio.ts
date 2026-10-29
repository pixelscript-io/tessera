import type { TokenDiagnostic } from './errors'
import {
  importWith,
  isObject,
  merge,
  nameOf,
  sanitizeName,
  tokensOf,
  failure,
  warn,
  type Doc,
  type ImportResult,
  type InterchangeFile,
  type InterchangeFormat,
  type ThemeDoc,
} from './interchange'
import { prepareFiles } from './loose'
import { parseJson } from './parse'
import { SUPPORTED_TYPES } from './values'

/**
 * The Tokens Studio adapter. Tokens Studio (and Penpot, which exports the same shape) does not write strict
 * DTCG: tokens are `{ value, type }` (or `$value` and `$type` in its DTCG mode), types have their own names
 * (`spacing`, `borderRadius`, `fontWeights`), values are strings (`"16"`, `"#ff0000"`, `"50%"`), and themes are
 * combinations of token sets listed in `$themes`. This reads that into Tessera's strict token files.
 */

/** Tokens Studio type names and the DTCG type each becomes. Anything else is kept as it is and skipped. */
const TYPES: Record<string, string> = {
  color: 'color',
  spacing: 'dimension',
  sizing: 'dimension',
  borderRadius: 'dimension',
  borderWidth: 'dimension',
  fontSizes: 'dimension',
  letterSpacing: 'dimension',
  paragraphSpacing: 'dimension',
  paragraphIndent: 'dimension',
  dimension: 'dimension',
  opacity: 'number',
  number: 'number',
  lineHeights: 'number',
  fontFamilies: 'fontFamily',
  fontFamily: 'fontFamily',
  fontWeights: 'fontWeight',
  fontWeight: 'fontWeight',
  boxShadow: 'shadow',
  shadow: 'shadow',
  border: 'border',
  duration: 'duration',
  cubicBezier: 'cubicBezier',
  strokeStyle: 'strokeStyle',
  transition: 'transition',
}

const ALIAS = /^\{([^{}]+)\}$/
const LEGACY_ALIAS = /^\$([A-Za-z_][A-Za-z0-9_.-]*)$/

const sanitizePath = (path: string): string =>
  path
    .split('.')
    .map((s) => sanitizeName(s) || '_')
    .join('.')

/** `{a.b}` and `$a.b` become `{a.b}` with Tessera-valid names; anything else is untouched. */
function fixAliases(value: unknown): unknown {
  if (typeof value === 'string') {
    const braced = ALIAS.exec(value)
    if (braced) return `{${sanitizePath(braced[1]!)}}`
    const legacy = LEGACY_ALIAS.exec(value)
    if (legacy) return `{${sanitizePath(legacy[1]!)}}`
    return value
  }
  if (Array.isArray(value)) return value.map(fixAliases)
  if (isObject(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fixAliases(v)]))
  return value
}

/** Opacity and line height are percentages in design tools and plain numbers in CSS. */
function ratio(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const m = /^(-?(?:\d+\.?\d*|\.\d+))\s*%$/.exec(value.trim())
  return m ? Number(m[1]) / 100 : value
}

/** A group's description and extensions (Tessera's tier lives there) survive the conversion. */
const keepMeta = (node: Doc): Doc => ({
  ...(typeof node.$description === 'string' ? { $description: node.$description } : {}),
  ...(isObject(node.$extensions) ? { $extensions: node.$extensions } : {}),
})

function convertSet(doc: Doc, set: string, diagnostics: TokenDiagnostic[]): Doc {
  const out: Doc = {}
  const renamed = new Set<string>()

  const walk = (node: Doc, target: Doc, inherited: string | undefined) => {
    const groupType =
      typeof node.type === 'string'
        ? node.type
        : typeof node.$type === 'string'
          ? node.$type
          : undefined
    const type = groupType ?? inherited
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$') && key !== '$root') continue
      if (!isObject(child)) continue
      const name = key === '$root' ? key : sanitizeName(key) || '_'
      if (name !== key) renamed.add(key)
      const isToken = 'value' in child || '$value' in child
      if (!isToken) {
        const group: Doc = keepMeta(child)
        target[name] = group
        walk(child, group, type)
        continue
      }
      const tsType =
        (typeof child.type === 'string' ? child.type : undefined) ??
        (typeof child.$type === 'string' ? child.$type : undefined) ??
        type
      const dtcgType = tsType !== undefined ? (TYPES[tsType] ?? tsType) : undefined
      let value = fixAliases('value' in child ? child.value : child.$value)
      let outType = dtcgType
      if (tsType === 'opacity') value = ratio(value)
      if (tsType === 'lineHeights') {
        value = ratio(value)
        // A line height with a length unit is a dimension; a bare number or percentage is a multiplier.
        if (typeof value === 'string' && /(px|rem)$/i.test(value.trim())) outType = 'dimension'
      }
      if (tsType === 'letterSpacing' && typeof value === 'string' && value.trim().endsWith('%')) {
        // Percent letter spacing depends on the font size and has no CSS length; keep it as unsupported.
        outType = 'letterSpacingPercent'
      }
      const description =
        typeof child.description === 'string'
          ? child.description
          : typeof child.$description === 'string'
            ? child.$description
            : undefined
      target[name] = {
        ...(outType ? { $type: outType } : {}),
        $value: value,
        ...(description ? { $description: description } : {}),
        ...(isObject(child.$extensions) ? { $extensions: child.$extensions } : {}),
      }
    }
  }
  Object.assign(out, keepMeta(doc))
  walk(doc, out, undefined)
  if (renamed.size) {
    diagnostics.push(
      warn(
        set,
        `Names that Tessera cannot use as CSS custom properties were rewritten (${[...renamed].slice(0, 5).join(', ')}${renamed.size > 5 ? ', ...' : ''}); references to them were rewritten too.`,
      ),
    )
  }
  return out
}

interface ThemeEntry {
  name: string
  selectedTokenSets: Record<string, string>
}

function readParts(files: InterchangeFile[], diagnostics: TokenDiagnostic[]) {
  const sets = new Map<string, Doc>()
  let themes: ThemeEntry[] = []
  let order: string[] = []
  const setNameOf = (path: string) => path.replaceAll('\\', '/').replace(/\.json$/, '')

  for (const f of files) {
    const name = nameOf(f.path)
    if (name === '$themes') {
      try {
        const list: unknown = JSON.parse(f.content)
        if (Array.isArray(list)) themes = list.filter(isObject) as unknown as ThemeEntry[]
      } catch (e) {
        diagnostics.push(failure(f.path, `Could not parse as JSON: ${(e as Error).message}`))
      }
      continue
    }
    const doc = parseJson(f.content, f.path, diagnostics)
    if (!doc) continue
    if (name === '$metadata') {
      if (Array.isArray(doc.tokenSetOrder)) order = doc.tokenSetOrder.map(String)
      continue
    }
    if ('$themes' in doc || '$metadata' in doc) {
      // One file holding every set.
      if (Array.isArray(doc.$themes))
        themes = (doc.$themes as unknown[]).filter(isObject) as unknown as ThemeEntry[]
      if (isObject(doc.$metadata) && Array.isArray(doc.$metadata.tokenSetOrder)) {
        order = doc.$metadata.tokenSetOrder.map(String)
      }
      for (const [key, value] of Object.entries(doc)) {
        if (!key.startsWith('$') && isObject(value)) sets.set(key, value)
      }
    } else {
      sets.set(setNameOf(f.path), doc)
    }
  }
  const names = [...sets.keys()]
  const sorted = [...order.filter((n) => sets.has(n)), ...names.filter((n) => !order.includes(n))]
  return { sets, themes, order: sorted }
}

const THEME_LABEL = /^([a-z][a-z0-9-]*)=(.+)$/

/** Read the files of a Tokens Studio export into a strict base document and Tessera themes. */
export function fromTokensStudio(
  files: InterchangeFile[],
  diagnostics: TokenDiagnostic[],
): { base: Doc; themes: ThemeDoc[] } {
  const { sets, themes: entries, order } = readParts(files, diagnostics)
  const converted = new Map<string, Doc>()
  for (const name of order) converted.set(name, convertSet(sets.get(name)!, name, diagnostics))

  if (!entries.length) {
    const base: Doc = {}
    for (const name of order) merge(base, converted.get(name)!)
    return { base, themes: [] }
  }

  const status = (t: ThemeEntry, set: string) => {
    const s = t.selectedTokenSets?.[set]
    return s === 'source' || s === 'enabled' ? s : 'disabled'
  }
  // A set that every theme applies is the base; a set only some themes apply belongs to those themes.
  const baseSets = order.filter((s) => entries.every((t) => status(t, s) !== 'disabled'))
  const used = new Set(order.filter((s) => entries.some((t) => status(t, s) !== 'disabled')))
  for (const s of order) {
    if (!used.has(s))
      diagnostics.push(
        warn(s, `The token set "${s}" is not enabled in any theme, so it was left out.`),
      )
  }

  const base: Doc = {}
  for (const s of baseSets) merge(base, converted.get(s)!)

  const themes: ThemeDoc[] = entries.map((t) => {
    const label = String(t.name ?? '')
    const m = THEME_LABEL.exec(label)
    const attribute = m ? m[1]! : 'theme'
    const raw = m ? m[2]! : label
    const name = sanitizeName(raw).toLowerCase()
    if (name !== raw)
      diagnostics.push(warn(undefined, `The theme "${label}" is written as "${name}".`))
    const doc: Doc = {}
    for (const s of order) {
      if (!baseSets.includes(s) && status(t, s) !== 'disabled') merge(doc, converted.get(s)!)
    }
    return { name, attribute, doc }
  })

  // Tokens Studio themes often define the semantic layer only in the theme sets. Tessera themes override
  // values and never add names, so such a token goes into the base with the first theme's value.
  const known = new Set(tokensOf(base).map((t) => t.path))
  const hoisted: string[] = []
  for (const t of themes) {
    for (const tok of tokensOf(t.doc)) {
      if (known.has(tok.path)) continue
      known.add(tok.path)
      hoisted.push(tok.path)
      const segments = tok.path.split('.')
      let target = base
      for (const seg of segments.slice(0, -1)) {
        if (!isObject(target[seg])) target[seg] = {}
        target = target[seg] as Doc
      }
      target[segments[segments.length - 1]!] = structuredClone(tok.node)
    }
  }
  if (hoisted.length) {
    diagnostics.push(
      warn(
        undefined,
        `${hoisted.length} tokens exist only in theme sets (${hoisted.slice(0, 3).join(', ')}${hoisted.length > 3 ? ', ...' : ''}). Tessera themes override values and cannot add tokens, so they were added to the base with the value from the first theme that defines them.`,
      ),
    )
  }
  return { base, themes }
}

/** Import tokens from files written by Tokens Studio or Penpot, strict DTCG, or a DTCG Resolver document. */
export function importTokens(
  files: InterchangeFile[],
  format: InterchangeFormat | 'auto' = 'auto',
): ImportResult {
  // CSS files become token files and untyped JSON gets types before the import reads it.
  const notes: TokenDiagnostic[] = []
  const known = (type: string) =>
    type in TYPES || (SUPPORTED_TYPES as readonly string[]).includes(type)
  const result = importWith(prepareFiles(files, known, notes), format, fromTokensStudio)
  result.diagnostics.unshift(...notes)
  return result
}
