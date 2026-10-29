import { buildTokens, type BuildInput } from './build'
import { toLoose, toStrict, type ConvertContext } from './convert'
import type { TokenDiagnostic } from './errors'
import { parseJson } from './parse'
import { collectAliases, colorToCss, SUPPORTED_TYPES } from './values'

/** A file the importer reads or the exporter writes. Paths use forward slashes. */
export interface InterchangeFile {
  path: string
  content: string
}

export type InterchangeFormat = 'dtcg' | 'tokens-studio'

export interface ExportResult {
  files: InterchangeFile[]
  diagnostics: TokenDiagnostic[]
}

export interface ImportResult {
  /** Tessera token files for the base (`<name>.tokens.json`). */
  base: InterchangeFile[]
  /** Tessera theme files (`<theme>.tokens.json`), each with `$extends`. */
  themes: InterchangeFile[]
  /** What was skipped, adjusted or rejected, plus any error the result has as a Tessera token set. */
  diagnostics: TokenDiagnostic[]
}

export type Doc = Record<string, unknown>

export const isObject = (v: unknown): v is Doc =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n'

/** `a/b/dark.tokens.json` becomes `dark`. */
export const nameOf = (file: string): string =>
  file
    .replaceAll('\\', '/')
    .split('/')
    .pop()!
    .replace(/\.tokens\.json$|\.json$/, '')

/** A token or file name Tessera accepts, from one that may have spaces or punctuation. */
export const sanitizeName = (name: string): string =>
  name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

export function warn(file: string | undefined, message: string, path?: string): TokenDiagnostic {
  return { code: 'T1016', severity: 'warning', file, path, message }
}

export function failure(file: string | undefined, message: string, hint?: string): TokenDiagnostic {
  return { code: 'T1017', severity: 'error', file, message, hint }
}

/** Merge `source` into `target`: groups merge, anything else (a token) replaces. */
export function merge(target: Doc, source: Doc): Doc {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key]
    if (isObject(value) && isObject(existing) && !('$value' in value) && !('$value' in existing)) {
      merge(existing, value)
    } else {
      target[key] = structuredClone(value)
    }
  }
  return target
}

export interface FlatToken {
  path: string
  type?: string
  node: Doc
  parent: Doc
  key: string
}

/** Every token of a document, with the `$type` it inherits from its groups. */
export function tokensOf(doc: Doc): FlatToken[] {
  const out: FlatToken[] = []
  const walk = (node: Doc, segments: string[], inherited: string | undefined) => {
    for (const [key, child] of Object.entries(node)) {
      if (!isObject(child)) continue
      if (key.startsWith('$') && key !== '$root') continue
      const type = typeof child.$type === 'string' ? child.$type : inherited
      if ('$value' in child) {
        out.push({ path: [...segments, key].join('.'), type, node: child, parent: node, key })
      } else walk(child, [...segments, key], type)
    }
  }
  walk(doc, [], typeof doc.$type === 'string' ? doc.$type : undefined)
  return out
}

/** Remove groups left with nothing in them. */
function prune(node: Doc): boolean {
  for (const [key, child] of Object.entries(node)) {
    if (!isObject(child) || key.startsWith('$') || '$value' in child) continue
    if (prune(child)) delete node[key]
  }
  // `$root` is a token of the group, not metadata about it.
  return Object.keys(node).every((k) => k.startsWith('$') && k !== '$root')
}

/** Where a skipped token is kept, so an export can put it back. */
const skippedOf = (doc: Doc): Array<Doc> => {
  const tessera = (isObject(doc.$extensions) ? doc.$extensions.tessera : undefined) as
    { skipped?: unknown } | undefined
  return Array.isArray(tessera?.skipped) ? (tessera.skipped as Array<Doc>) : []
}

/** The type each token path has, following a typeless token to what it references. */
export function typeIndex(docs: Doc[]): Map<string, string> {
  const own = new Map<string, string>()
  const target = new Map<string, string>()
  for (const doc of docs) {
    for (const t of tokensOf(doc)) {
      if (t.type !== undefined) own.set(t.path, t.type)
      else if (typeof t.node.$value === 'string') {
        const a = /^\{([^{}]+)\}$/.exec(t.node.$value)?.[1]
        if (a) target.set(t.path, a)
      }
    }
  }
  const resolved = new Map(own)
  for (const path of target.keys()) {
    const seen = new Set<string>()
    let at: string | undefined = path
    while (at !== undefined && !own.has(at) && !seen.has(at)) {
      seen.add(at)
      at = target.get(at)
    }
    if (at !== undefined && own.has(at)) resolved.set(path, own.get(at)!)
  }
  return resolved
}

/**
 * Make documents Tessera can build: convert values to the strict forms, and take out what Tessera does not
 * support (a gradient, a typography composite, an object `strokeStyle`), together with everything that
 * references it, in any of the documents. Skipped tokens are kept in `$extensions.tessera.skipped`, so an
 * export restores them. A token with no `$type` (a theme override, which takes its type from the base) is
 * converted by the type its path has elsewhere.
 */
export function makeBuildable(
  docs: Array<{ file: string; doc: Doc }>,
  diagnostics: TokenDiagnostic[],
): void {
  const notes = new Map<string, Set<string>>()
  const skippedBy = new Map<string, Doc[]>()
  const skippedPaths = new Set<string>()
  const types = typeIndex(docs.map((d) => d.doc))

  const skip = (file: string, t: FlatToken, type: string | undefined, why: string) => {
    const list = skippedBy.get(file) ?? []
    list.push({
      path: t.path,
      ...(type ? { type } : {}),
      value: t.node.$value,
      ...(typeof t.node.$description === 'string' ? { description: t.node.$description } : {}),
    })
    skippedBy.set(file, list)
    skippedPaths.add(t.path)
    delete t.parent[t.key]
    diagnostics.push(warn(file, `${why} Kept in $extensions.tessera.skipped.`, t.path))
  }

  for (const { file, doc } of docs) {
    const ctx: ConvertContext = {
      note: (m) => notes.set(file, (notes.get(file) ?? new Set()).add(m)),
    }
    for (const t of tokensOf(doc)) {
      const type = t.type ?? types.get(t.path)
      if (type === undefined) continue
      if (!(SUPPORTED_TYPES as readonly string[]).includes(type)) {
        skip(file, t, type, `The type "${type}" is not supported.`)
        continue
      }
      const before = t.node.$value
      const strict = toStrict(type, before, ctx)
      if (strict === undefined) {
        skip(
          file,
          t,
          type,
          `The ${type} value ${JSON.stringify(before)} cannot be expressed as a strict DTCG value.`,
        )
        continue
      }
      t.node.$value = strict
    }
  }

  // A token that references a skipped one cannot stand either. Repeat until nothing more falls out.
  for (let changed = true; changed;) {
    changed = false
    for (const { file, doc } of docs) {
      for (const t of tokensOf(doc)) {
        const dead = collectAliases(t.node.$value).find((a) => skippedPaths.has(a))
        if (dead !== undefined) {
          skip(file, t, t.type ?? types.get(t.path), `It references ${dead}, which was skipped.`)
          changed = true
        }
      }
    }
  }

  for (const { file, doc } of docs) {
    for (const message of notes.get(file) ?? []) diagnostics.push(warn(file, message))
    prune(doc)
    const skipped = skippedBy.get(file)
    if (skipped?.length) {
      const extensions = isObject(doc.$extensions) ? doc.$extensions : (doc.$extensions = {})
      const tessera = isObject((extensions as Doc).tessera) ? (extensions as Doc).tessera : {}
      ;(extensions as Doc).tessera = {
        ...(tessera as Doc),
        skipped: [...skippedOf(doc), ...skipped],
      }
    }
  }
}

// --- export ---------------------------------------------------------------------------------------------

export interface ThemeDoc {
  name: string
  attribute: string
  auto?: string
  doc: Doc
}

const THEME_KEYS = new Set(['$extends', '$attribute', '$auto'])

/** Put back the tokens an import took out. */
function restoreSkipped(doc: Doc): void {
  const extensions = isObject(doc.$extensions) ? doc.$extensions : undefined
  const tessera = isObject(extensions?.tessera) ? (extensions!.tessera as Doc) : undefined
  const skipped = skippedOf(doc)
  if (!tessera || !skipped.length) return
  for (const s of skipped) {
    const segments = String(s.path).split('.')
    let node = doc
    for (const seg of segments.slice(0, -1)) {
      if (!isObject(node[seg])) node[seg] = {}
      node = node[seg] as Doc
    }
    node[segments[segments.length - 1]!] = {
      ...(s.type ? { $type: s.type } : {}),
      $value: s.value,
      ...(s.description ? { $description: s.description } : {}),
    }
  }
  delete tessera.skipped
  if (!Object.keys(tessera).length) delete extensions!.tessera
  if (!Object.keys(extensions!).length) delete doc.$extensions
}

/** `theme` themes keep their name; other attributes are written `density=compact`. */
export const themeLabel = (attribute: string, name: string): string =>
  attribute === 'theme' ? name : `${attribute}=${name}`

/**
 * Write the tokens in a form other tools read. `dtcg`: strict DTCG 2025.10 token files plus a Resolver document
 * (`tessera.resolver.json`) that lists the base as a set and each attribute (`theme`, `density`) as a modifier
 * with one context per theme. `tokens-studio`: the multi-file layout of Tokens Studio (one file per set,
 * `$themes.json`, `$metadata.json`) with values as the strings that plugin reads.
 */
export function exportTokens(input: BuildInput, format: InterchangeFormat): ExportResult {
  const diagnostics: TokenDiagnostic[] = []
  const baseName = input.baseName ?? 'base'
  const base: Array<{ name: string; doc: Doc }> = []
  for (const f of input.base) {
    const doc = parseJson(f.content, f.file, diagnostics)
    if (doc) base.push({ name: nameOf(f.file), doc: structuredClone(doc) })
  }
  const themes: ThemeDoc[] = []
  for (const f of input.themes ?? []) {
    const doc = parseJson(f.content, f.file, diagnostics)
    if (!doc) continue
    const copy = structuredClone(doc)
    themes.push({
      name: nameOf(f.file),
      attribute: typeof copy.$attribute === 'string' ? copy.$attribute : 'theme',
      auto: typeof copy.$auto === 'string' ? copy.$auto : undefined,
      doc: Object.fromEntries(Object.entries(copy).filter(([k]) => !THEME_KEYS.has(k))),
    })
  }
  if (diagnostics.some((d) => d.severity === 'error')) return { files: [], diagnostics }
  for (const b of base) restoreSkipped(b.doc)

  if (format === 'tokens-studio') return exportTokensStudio(base, themes, diagnostics)

  const files: InterchangeFile[] = []
  const baseRefs = base.map((b) => ({ $ref: `sets/${b.name}.tokens.json` }))
  for (const b of base) files.push({ path: `sets/${b.name}.tokens.json`, content: json(b.doc) })

  const modifiers: Record<string, unknown> = {}
  const attributes = [...new Set(themes.map((t) => t.attribute))]
  for (const attribute of attributes) {
    const contexts: Record<string, unknown> = { [baseName]: [] }
    const auto: Record<string, string> = {}
    for (const t of themes.filter((x) => x.attribute === attribute)) {
      const path = `modifiers/${attribute}/${t.name}.tokens.json`
      files.push({ path, content: json(t.doc) })
      contexts[t.name] = [{ $ref: path }]
      if (t.auto) auto[t.name] = t.auto
    }
    modifiers[attribute] = {
      contexts,
      default: baseName,
      ...(Object.keys(auto).length ? { $extensions: { tessera: { auto } } } : {}),
    }
  }

  const resolver = {
    $schema: 'https://www.designtokens.org/schemas/2025.10/resolver.json',
    version: '2025.10',
    name: 'Tessera tokens',
    sets: { base: { sources: baseRefs } },
    modifiers,
    resolutionOrder: [
      { $ref: '#/sets/base' },
      ...attributes.map((a) => ({ $ref: `#/modifiers/${a}` })),
    ],
    ...(baseName !== 'base' ? { $extensions: { tessera: { baseName } } } : {}),
  }
  files.unshift({ path: 'tessera.resolver.json', content: json(resolver) })
  return { files, diagnostics }
}

function exportTokensStudio(
  base: Array<{ name: string; doc: Doc }>,
  themes: ThemeDoc[],
  diagnostics: TokenDiagnostic[],
): ExportResult {
  const loose = (doc: Doc): Doc => toLoose(doc, colorToCss) as Doc
  // A set read on its own needs every token to say its type, including theme overrides that take it from the base.
  const types = typeIndex([...base.map((b) => b.doc), ...themes.map((t) => t.doc)])
  for (const doc of [...base.map((b) => b.doc), ...themes.map((t) => t.doc)]) {
    for (const t of tokensOf(doc)) {
      const type = t.type ?? types.get(t.path)
      if (t.type === undefined && type !== undefined) t.node.$type = type
    }
  }
  const files: InterchangeFile[] = []
  const setNames = new Set(base.map((b) => b.name))
  for (const b of base) files.push({ path: `${b.name}.json`, content: json(loose(b.doc)) })

  const order = base.map((b) => b.name)
  const selected = Object.fromEntries(base.map((b) => [b.name, 'source']))
  const entries = themes.map((t) => {
    let set = t.attribute === 'theme' ? t.name : `${t.attribute}-${t.name}`
    while (setNames.has(set)) set += '-theme'
    setNames.add(set)
    order.push(set)
    files.push({ path: `${set}.json`, content: json(loose(t.doc)) })
    return {
      id: `${t.attribute}-${t.name}`,
      name: themeLabel(t.attribute, t.name),
      selectedTokenSets: { ...selected, [set]: 'enabled' },
    }
  })
  files.push({ path: '$themes.json', content: json(entries) })
  files.push({ path: '$metadata.json', content: json({ tokenSetOrder: order }) })
  const auto = themes.filter((t) => t.auto)
  if (auto.length) {
    diagnostics.push(
      warn(
        undefined,
        `Tokens Studio has no equivalent of "$auto" (${auto.map((t) => `${t.name}: ${t.auto}`).join('; ')}), so automatic switching is not exported.`,
      ),
    )
  }
  return { files, diagnostics }
}

// --- import ---------------------------------------------------------------------------------------------

/** The files a Resolver document refers to, so a caller can read them before importing. */
export function resolverRefs(content: string): string[] {
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch {
    return []
  }
  const refs = new Set<string>()
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (isObject(v)) {
      if (typeof v.$ref === 'string' && !v.$ref.startsWith('#')) refs.add(v.$ref)
      Object.values(v).forEach(walk)
    }
  }
  if (isObject(doc)) {
    walk(doc.sets)
    walk(doc.modifiers)
  }
  return [...refs]
}

const isResolver = (doc: Doc): boolean => Array.isArray(doc.resolutionOrder)

const dirOf = (path: string): string => {
  const parts = path.replaceAll('\\', '/').split('/')
  parts.pop()
  return parts.join('/')
}

/** Join and normalize `a/b` + `../c`. */
function resolvePath(dir: string, ref: string): string {
  const out: string[] = []
  for (const part of [...(dir ? dir.split('/') : []), ...ref.replaceAll('\\', '/').split('/')]) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return out.join('/')
}

export interface BaseDoc {
  name: string
  doc: Doc
}

/** A file name not used yet: `tokens`, `tokens-2`, ... */
function uniqueName(name: string, taken: BaseDoc[]): string {
  const used = new Set(taken.map((b) => b.name))
  let out = name
  for (let n = 2; used.has(out); n++) out = `${name}-${n}`
  return out
}

/** Apply a document's values over the base files: a token replaces the one that defines it, new ones join the last file. */
function applyOverride(base: BaseDoc[], doc: Doc): void {
  if (!base.length) base.push({ name: 'base', doc: {} })
  const owner = new Map<string, BaseDoc>()
  for (const b of base) for (const t of tokensOf(b.doc)) owner.set(t.path, b)
  for (const t of tokensOf(doc)) {
    const target = owner.get(t.path) ?? base[base.length - 1]!
    const segments = t.path.split('.')
    let node = target.doc
    for (const seg of segments.slice(0, -1)) {
      if (!isObject(node[seg])) node[seg] = {}
      node = node[seg] as Doc
    }
    node[segments[segments.length - 1]!] = structuredClone(t.node)
  }
}

function importResolver(
  file: InterchangeFile,
  doc: Doc,
  files: Map<string, string>,
  diagnostics: TokenDiagnostic[],
): { base: BaseDoc[]; baseName: string; themes: ThemeDoc[] } | undefined {
  const dir = dirOf(file.path)
  const load = (source: unknown): { name?: string; doc: Doc } | undefined => {
    if (!isObject(source)) return undefined
    if (typeof source.$ref === 'string') {
      if (source.$ref.startsWith('#')) {
        diagnostics.push(
          failure(
            file.path,
            `The reference "${source.$ref}" points inside the resolver, which is not supported in a source list.`,
          ),
        )
        return undefined
      }
      const path = resolvePath(dir, source.$ref)
      const text = files.get(path)
      if (text === undefined) {
        diagnostics.push(
          failure(
            file.path,
            `The resolver refers to "${source.$ref}", which was not provided.`,
            'Pass the file as well, or import the resolver file itself so the files it names are read.',
          ),
        )
        return undefined
      }
      const parsed = parseJson(text, path, diagnostics)
      return parsed ? { name: nameOf(path), doc: parsed } : undefined
    }
    return { doc: source }
  }
  const loadAll = (sources: unknown): Doc => {
    const merged: Doc = {}
    for (const s of Array.isArray(sources) ? sources : []) {
      const d = load(s)
      if (d) merge(merged, d.doc)
    }
    return merged
  }

  const sets = isObject(doc.sets) ? doc.sets : {}
  const modifiers = isObject(doc.modifiers) ? doc.modifiers : {}
  const ext = (doc.$extensions as { tessera?: { baseName?: string } } | undefined)?.tessera
  const baseName = typeof ext?.baseName === 'string' ? ext.baseName : 'base'
  const base: BaseDoc[] = []
  const themes: ThemeDoc[] = []

  for (const entry of doc.resolutionOrder as unknown[]) {
    const ref = isObject(entry) && typeof entry.$ref === 'string' ? entry.$ref : undefined
    const set = ref?.match(/^#\/sets\/(.+)$/)?.[1]
    const modifier = ref?.match(/^#\/modifiers\/(.+)$/)?.[1]
    if (set !== undefined && isObject(sets[set])) {
      const sources = Array.isArray((sets[set] as Doc).sources)
        ? ((sets[set] as Doc).sources as unknown[])
        : []
      // Each source stays its own file, so group-level metadata such as a tier is not merged away.
      sources.forEach((source, i) => {
        const loaded = load(source)
        if (loaded) {
          const name = loaded.name ?? (sources.length > 1 ? `${set}-${i + 1}` : set)
          base.push({ name: uniqueName(sanitizeName(name) || 'tokens', base), doc: loaded.doc })
        }
      })
    } else if (modifier !== undefined && isObject(modifiers[modifier])) {
      const m = modifiers[modifier] as Doc
      const attribute = sanitizeName(modifier).toLowerCase()
      if (attribute !== modifier || !/^[a-z][a-z0-9-]*$/.test(attribute)) {
        diagnostics.push(
          warn(file.path, `The modifier "${modifier}" is used as the attribute "${attribute}".`),
        )
      }
      const auto = (m.$extensions as { tessera?: { auto?: Record<string, string> } } | undefined)
        ?.tessera?.auto
      for (const [context, sources] of Object.entries(isObject(m.contexts) ? m.contexts : {})) {
        const tokens = loadAll(sources)
        if (!Object.keys(tokens).length) continue
        if (context === m.default) {
          // The default context is what applies when none is chosen: it is the base.
          applyOverride(base, tokens)
          continue
        }
        const name = sanitizeName(context)
        if (name !== context) {
          diagnostics.push(
            warn(file.path, `The context "${context}" is written as the theme "${name}".`),
          )
        }
        themes.push({ name, attribute, auto: auto?.[context], doc: tokens })
      }
    } else {
      diagnostics.push(
        failure(
          file.path,
          `The resolver's resolutionOrder names "${String(ref)}", which is not a set or modifier in it.`,
        ),
      )
    }
  }
  return { base, baseName, themes }
}

/** Detect what a set of files is, if the caller did not say. */
export function detectFormat(files: InterchangeFile[]): InterchangeFormat {
  for (const f of files) {
    const name = nameOf(f.path)
    if (name === '$themes' || name === '$metadata') return 'tokens-studio'
    let doc: unknown
    try {
      doc = JSON.parse(f.content)
    } catch {
      continue
    }
    if (isObject(doc) && ('$themes' in doc || '$metadata' in doc)) return 'tokens-studio'
    if (isObject(doc) && !isResolver(doc)) {
      // Legacy Tokens Studio tokens are { value, type } with no dollar signs.
      const legacy = (node: Doc): boolean =>
        Object.entries(node).some(
          ([k, v]) =>
            !k.startsWith('$') &&
            isObject(v) &&
            (('value' in v && !('$value' in v)) || (!('value' in v) && legacy(v))),
        )
      if (legacy(doc)) return 'tokens-studio'
    }
  }
  return 'dtcg'
}

/** Check the result as a Tessera token set, so what an import hands back builds or says why not. */
export function verify(result: ImportResult, baseName: string): void {
  const built = buildTokens({
    baseName,
    base: result.base.map((f) => ({ file: f.path, content: f.content })),
    themes: result.themes.map((f) => ({ file: f.path, content: f.content })),
  })
  for (const d of built.diagnostics) result.diagnostics.push(d)
}

const tesseraFile = (doc: Doc, name: string): InterchangeFile => ({
  path: `${name}.tokens.json`,
  content: json(doc),
})

function themeFile(t: ThemeDoc, baseName: string): InterchangeFile {
  return {
    path: `themes/${t.name}.tokens.json`,
    content: json({
      $extends: baseName,
      ...(t.attribute !== 'theme' ? { $attribute: t.attribute } : {}),
      ...(t.auto ? { $auto: t.auto } : {}),
      ...t.doc,
    }),
  }
}

/**
 * Read tokens another tool wrote and return Tessera token files. `files` are the files given (a Resolver
 * document with the files it names, a single DTCG file, or the files of a Tokens Studio export). Nothing is
 * dropped silently: what cannot be kept is listed in `diagnostics` (T1016), and the result is built to catch
 * the rest (T1006, T1011, ...).
 */
export function importWith(
  files: InterchangeFile[],
  format: InterchangeFormat | 'auto',
  fromTokensStudio: (
    files: InterchangeFile[],
    diagnostics: TokenDiagnostic[],
  ) => { base: Doc; themes: ThemeDoc[] },
): ImportResult {
  const diagnostics: TokenDiagnostic[] = []
  const result: ImportResult = { base: [], themes: [], diagnostics }
  const chosen = format === 'auto' ? detectFormat(files) : format
  let baseName = 'base'
  let base: BaseDoc[] = []
  let themes: ThemeDoc[] = []

  if (chosen === 'tokens-studio') {
    const got = fromTokensStudio(files, diagnostics)
    base = [{ name: 'base', doc: got.base }]
    themes = got.themes
  } else {
    const byPath = new Map(files.map((f) => [f.path.replaceAll('\\', '/'), f.content]))
    const parsed = files.map((f) => ({ file: f, doc: parseJson(f.content, f.path, diagnostics) }))
    const resolver = parsed.find((p) => p.doc && isResolver(p.doc))
    if (resolver) {
      const got = importResolver(resolver.file, resolver.doc!, byPath, diagnostics)
      if (got) ({ base, baseName, themes } = got)
    } else {
      // Plain DTCG documents: each is a base file of its own, unless it extends the base (a theme file, as a Tessera
      // project writes one, or as the CSS reader makes one): then it is a theme, and files of one name are one theme.
      for (const p of parsed) {
        if (!p.doc) continue
        if (typeof p.doc.$extends === 'string') {
          const name = sanitizeName(nameOf(p.file.path)) || 'theme'
          const tokens = { ...p.doc }
          const { $attribute, $auto } = tokens
          for (const key of ['$extends', '$attribute', '$auto']) delete tokens[key]
          const attribute = typeof $attribute === 'string' ? $attribute : 'theme'
          const auto = typeof $auto === 'string' ? $auto : undefined
          const same = themes.find((t) => t.name === name && t.attribute === attribute)
          if (same) {
            same.doc = merge(same.doc, tokens)
            if (auto && !same.auto) same.auto = auto
          } else themes.push({ name, attribute, ...(auto ? { auto } : {}), doc: tokens })
          continue
        }
        base.push({
          name: uniqueName(sanitizeName(nameOf(p.file.path)) || 'tokens', base),
          doc: p.doc,
        })
      }
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) return result

  makeBuildable(
    [
      ...base.map((b) => ({ file: `${b.name}.tokens.json`, doc: b.doc })),
      ...themes.map((t) => ({ file: `themes/${t.name}.tokens.json`, doc: t.doc })),
    ],
    diagnostics,
  )
  for (const b of base) result.base.push(tesseraFile(b.doc, b.name))
  for (const t of themes) result.themes.push(themeFile(t, baseName))
  verify(result, baseName)
  return result
}
