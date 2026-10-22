import { TokenFailure, nearest, type TokenDiagnostic } from './errors'
import { cssVarName, flattenTokens, parseJson, type RawToken } from './parse'
import { aliasTarget, collectAliases, serialize } from './values'

export interface TokenFileInput {
  /** Used in diagnostics. For themes, the file name (without `.tokens.json`) is the theme value. */
  file: string
  /** Parsed JSON, or the JSON text. */
  content: unknown
}

export interface BuildInput {
  /** Name that theme files must name in `$extends`. Defaults to `base`. */
  baseName?: string
  base: TokenFileInput[]
  themes?: TokenFileInput[]
}

export type TokenTier = 'primitive' | 'semantic' | 'component'

export interface ManifestValue {
  /** CSS value as emitted. Aliases stay as `var(--t-…)`. */
  css: string
  /** CSS value with every alias followed to a literal. */
  resolved: string
  /** Dotted path of the token this value aliases, if it is an alias. */
  alias?: string
}

export interface ManifestToken {
  path: string
  cssVar: string
  type: string
  tier: TokenTier
  description?: string
  extensions?: Record<string, unknown>
  /** `base`, plus `<attribute>=<name>` for every theme (for example `theme=dark`). */
  values: Record<string, ManifestValue>
}

export interface ManifestTheme {
  attribute: string
  name: string
  file: string
  /** Media feature for `auto` mode, for example `prefers-color-scheme: dark`. */
  auto?: string
  overrides: string[]
}

export interface TokenManifest {
  version: 1
  base: string
  tokens: ManifestToken[]
  themes: ManifestTheme[]
}

export interface BuildResult {
  ok: boolean
  diagnostics: TokenDiagnostic[]
  /** Empty when `ok` is false. */
  css: string
  dts: string
  manifest: TokenManifest | undefined
}

interface Theme extends ManifestTheme {
  tokens: Map<string, RawToken>
}

const THEME_KEYS = new Set(['$extends', '$attribute', '$auto', '$description'])
const ATTRIBUTE = /^[a-z][a-z0-9-]*$/
const THEME_VALUE = /^[A-Za-z0-9_-]+$/
const LAYER_ORDER = '@layer tessera.reset, tessera.tokens, tessera.components, tessera.overrides;'

export function buildTokens(input: BuildInput): BuildResult {
  const diagnostics: TokenDiagnostic[] = []
  const baseName = input.baseName ?? 'base'
  const error = (
    code: TokenDiagnostic['code'],
    message: string,
    where: { file?: string; path?: string },
    hint?: string,
  ) => diagnostics.push({ code, severity: 'error', message, hint, ...where })

  // 1. Base tokens.
  const base = new Map<string, RawToken>()
  for (const { file, content } of input.base) {
    const doc = parseJson(content, file, diagnostics)
    if (!doc) continue
    for (const token of flattenTokens(doc, file, diagnostics)) {
      const existing = base.get(token.path)
      if (existing) {
        error('T1013', `Token "${token.path}" is already defined in ${existing.file}.`, {
          file,
          path: token.path,
        })
      } else {
        base.set(token.path, token)
      }
    }
  }
  const baseProblems = checkGraph(base, undefined, error)

  // 2. Themes, which may only override names that already exist.
  const themes: Theme[] = []
  const seenThemes = new Map<string, string>()
  for (const { file, content } of input.themes ?? []) {
    const theme = parseTheme(file, content, base, baseName, diagnostics, baseProblems)
    if (!theme) continue
    const key = `${theme.attribute}=${theme.name}`
    const earlier = seenThemes.get(key)
    if (earlier) {
      error(
        'T1015',
        `Theme "${theme.name}" for data-${theme.attribute} is already defined in ${earlier}.`,
        { file },
      )
      continue
    }
    seenThemes.set(key, file)
    themes.push(theme)
  }

  // 3. Validate each effective token set (base, then base overlaid by each theme).
  const scopes: Array<{ key: string; map: Map<string, RawToken>; changed?: ReadonlySet<string> }> =
    [{ key: 'base', map: base }]
  for (const theme of themes) {
    const map = new Map(base)
    for (const [path, token] of theme.tokens) map.set(path, token)
    const changed = new Set(theme.tokens.keys())
    const problems = checkGraph(map, changed, error)
    scopes.push({ key: `${theme.attribute}=${theme.name}`, map, changed })
    for (const path of problems) baseProblems.add(path)
  }

  const rendered = new Map<string, Map<string, ManifestValue>>()
  const failed = new Set(baseProblems)
  for (const { key, map, changed } of scopes) {
    const values = new Map<string, ManifestValue>()
    rendered.set(key, values)
    for (const token of map.values()) {
      if (failed.has(token.path)) continue
      // Report value problems once: in base, or for the tokens a theme overrides.
      const report = key === 'base' || changed?.has(token.path)
      try {
        values.set(token.path, {
          css: render(token, map, 'var'),
          resolved: render(token, map, 'literal'),
          ...(aliasTarget(token.value) ? { alias: aliasTarget(token.value) } : {}),
        })
      } catch (e) {
        if (!(e instanceof TokenFailure)) throw e
        if (report) error(e.code, e.message, { file: token.file, path: token.path }, e.hint)
        failed.add(token.path)
      }
    }
  }

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics, css: '', dts: '', manifest: undefined }
  }

  const tiers = new Map<string, TokenTier>()
  const tierOf = (path: string): TokenTier => {
    const known = tiers.get(path)
    if (known) return known
    const token = base.get(path)!
    const explicit = (token.extensions?.tessera as { tier?: unknown } | undefined)?.tier
    let tier: TokenTier
    if (explicit === 'primitive' || explicit === 'semantic' || explicit === 'component')
      tier = explicit
    else {
      const target = aliasTarget(token.value)
      tier =
        target === undefined
          ? 'primitive'
          : tierOf(target) === 'primitive'
            ? 'semantic'
            : 'component'
    }
    tiers.set(path, tier)
    return tier
  }

  const manifest: TokenManifest = {
    version: 1,
    base: baseName,
    tokens: [...base.values()].map((token) => {
      const values: Record<string, ManifestValue> = {}
      for (const { key } of scopes) values[key] = rendered.get(key)!.get(token.path)!
      return {
        path: token.path,
        cssVar: cssVarName(token.path),
        type: token.type!,
        tier: tierOf(token.path),
        ...(token.description ? { description: token.description } : {}),
        ...(token.extensions ? { extensions: token.extensions } : {}),
        values,
      }
    }),
    themes: themes.map(({ tokens, ...rest }) => ({ ...rest, overrides: [...tokens.keys()] })),
  }

  return {
    ok: true,
    diagnostics,
    css: emitCss(manifest, rendered),
    dts: emitDts(manifest),
    manifest,
  }
}

/** Theme file name without directories or the `.tokens.json` suffix. */
function themeValue(file: string): string {
  const name = file.split(/[\\/]/).pop()!
  return name.replace(/\.tokens\.json$/, '').replace(/\.json$/, '')
}

function parseTheme(
  file: string,
  content: unknown,
  base: Map<string, RawToken>,
  baseName: string,
  diagnostics: TokenDiagnostic[],
  baseProblems: Set<string>,
): Theme | undefined {
  const start = diagnostics.length
  const bad = (code: TokenDiagnostic['code'], message: string, path?: string, hint?: string) =>
    diagnostics.push({ code, severity: 'error', file, path, message, hint })

  const doc = parseJson(content, file, diagnostics)
  if (!doc) return undefined

  const name = themeValue(file)
  if (!THEME_VALUE.test(name)) {
    bad(
      'T1014',
      `Invalid theme name "${name}" taken from the file name. Use letters, numbers, "-" and "_".`,
    )
  }
  const attribute = doc.$attribute === undefined ? 'theme' : doc.$attribute
  if (typeof attribute !== 'string' || !ATTRIBUTE.test(attribute)) {
    bad(
      'T1014',
      `"$attribute" must be a lowercase name such as "theme" or "density", got ${JSON.stringify(attribute)}.`,
    )
  }
  const auto = doc.$auto
  if (auto !== undefined && (typeof auto !== 'string' || !/^[a-z-]+:\s*[a-z0-9-]+$/.test(auto))) {
    bad(
      'T1014',
      `"$auto" must be a media feature such as "prefers-color-scheme: dark", got ${JSON.stringify(auto)}.`,
    )
  }
  if (doc.$extends === undefined) {
    bad('T1010', `Theme "${name}" must declare "$extends": "${baseName}".`)
  } else if (doc.$extends !== baseName) {
    bad(
      'T1010',
      `Theme "${name}" extends ${JSON.stringify(doc.$extends)}, but the base is "${baseName}".`,
      undefined,
      `Did you mean "${baseName}"?`,
    )
  }

  const tokens = new Map<string, RawToken>()
  for (const token of flattenTokens(doc, file, diagnostics, THEME_KEYS)) {
    const original = base.get(token.path)
    if (!original) {
      const close = nearest(token.path, base.keys())
      bad(
        'T1011',
        `Theme "${name}" adds a new token "${token.path}". Themes can only override values of tokens that already exist.`,
        token.path,
        close ? `Did you mean "${close}"?` : `Add "${token.path}" to the base tokens first.`,
      )
      continue
    }
    if (token.type !== undefined && original.type !== undefined && token.type !== original.type) {
      bad(
        'T1012',
        `Theme "${name}" sets "${token.path}" to type "${token.type}", but the base type is "${original.type}".`,
        token.path,
      )
      continue
    }
    if (baseProblems.has(token.path)) continue
    tokens.set(token.path, {
      ...token,
      type: original.type,
      description: original.description,
      extensions: original.extensions,
    })
  }

  if (diagnostics.length > start) return undefined
  return {
    attribute: attribute as string,
    name,
    file,
    ...(auto ? { auto: auto as string } : {}),
    overrides: [],
    tokens,
  }
}

/**
 * Check references in a token map: unknown targets, cycles, and tokens with no type. Resolves the
 * type of typeless aliases in place. With `only`, just the tokens in it are reported (theme overrides);
 * returns the paths that have a problem.
 */
function checkGraph(
  map: Map<string, RawToken>,
  only: ReadonlySet<string> | undefined,
  error: (
    code: TokenDiagnostic['code'],
    message: string,
    where: { file?: string; path?: string },
    hint?: string,
  ) => void,
): Set<string> {
  const problems = new Set<string>()
  const wanted = (path: string) => !only || only.has(path)
  const edges = new Map<string, string[]>()

  for (const token of map.values()) {
    const targets: string[] = []
    for (const target of collectAliases(token.value)) {
      if (map.has(target)) {
        targets.push(target)
      } else {
        problems.add(token.path)
        if (wanted(token.path)) {
          const close = nearest(target, map.keys())
          error(
            'T1006',
            `Unknown token "{${target}}"`,
            { file: token.file, path: token.path },
            close ? `Did you mean "{${close}}"?` : undefined,
          )
        }
      }
    }
    edges.set(token.path, targets)
  }

  // Cycles: depth-first search; each back edge reports every token on the cycle.
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const inCycle = new Set<string>()
  const visit = (path: string) => {
    state.set(path, 1)
    stack.push(path)
    for (const next of edges.get(path) ?? []) {
      if (state.get(next) === 1) {
        const members = stack.slice(stack.indexOf(next))
        const chain = [...members, next].join(' -> ')
        for (const member of members) {
          if (inCycle.has(member)) continue
          inCycle.add(member)
          problems.add(member)
          if (wanted(member) || members.some(wanted)) {
            error('T1007', `Circular reference: ${chain}`, {
              file: map.get(member)!.file,
              path: member,
            })
          }
        }
      } else if (!state.has(next)) {
        visit(next)
      }
    }
    stack.pop()
    state.set(path, 2)
  }
  for (const path of map.keys()) if (!state.has(path)) visit(path)

  // Types: explicit or inherited, else follow the alias chain.
  const typeOf = (path: string, seen = new Set<string>()): string | undefined => {
    const token = map.get(path)
    if (!token || seen.has(path)) return undefined
    if (token.type !== undefined) return token.type
    const target = aliasTarget(token.value)
    if (target === undefined) return undefined
    seen.add(path)
    return typeOf(target, seen)
  }
  for (const token of map.values()) {
    if (token.type !== undefined || problems.has(token.path)) continue
    const resolved = typeOf(token.path)
    if (resolved !== undefined) token.type = resolved
    else {
      problems.add(token.path)
      if (wanted(token.path)) {
        error(
          'T1003',
          `Token "${token.path}" has no $type. Set "$type" on the token or on a parent group.`,
          { file: token.file, path: token.path },
        )
      }
    }
  }
  return problems
}

/** Render one token's value as CSS. `var` keeps aliases as custom properties; `literal` inlines them. */
function render(
  token: RawToken,
  map: Map<string, RawToken>,
  mode: 'var' | 'literal',
  depth = 0,
): string {
  if (depth > 64)
    throw new TokenFailure('T1007', `Reference chain from "${token.path}" is too deep.`)
  const type = token.type!
  const alias = (path: string, expected: string): string => {
    const target = map.get(path)!
    if (target.type !== expected) {
      throw new TokenFailure(
        'T1008',
        `"{${path}}" has type "${target.type}", but "${token.path}" needs "${expected}".`,
      )
    }
    return mode === 'var' ? `var(${cssVarName(path)})` : render(target, map, mode, depth + 1)
  }
  const target = aliasTarget(token.value)
  if (target !== undefined) return alias(target, type)
  return serialize(type, token.value, alias)
}

function emitCss(
  manifest: TokenManifest,
  rendered: Map<string, Map<string, ManifestValue>>,
): string {
  const block = (selector: string, entries: Array<[string, string]>, indent = '') =>
    `${indent}${selector} {\n${entries.map(([n, v]) => `${indent}  ${n}: ${v};`).join('\n')}\n${indent}}`

  const baseValues = rendered.get('base')!
  const blocks = [
    LAYER_ORDER,
    `@layer tessera.tokens {\n${[
      block(
        ':where(:root)',
        manifest.tokens.map((t) => [t.cssVar, baseValues.get(t.path)!.css]),
        '  ',
      ),
      ...manifest.themes.flatMap((theme) => {
        const values = rendered.get(`${theme.attribute}=${theme.name}`)!
        const entries = theme.overrides.map((path): [string, string] => [
          cssVarName(path),
          values.get(path)!.css,
        ])
        const selector = `[data-${theme.attribute}="${theme.name}"]`
        const out = [block(selector, entries, '  ')]
        if (theme.auto) {
          out.push(
            `  @media (${theme.auto}) {\n${block(`[data-${theme.attribute}="auto"]`, entries, '    ')}\n  }`,
          )
        }
        return out
      }),
    ].join('\n')}\n}`,
  ]
  return blocks.join('\n\n') + '\n'
}

function emitDts(manifest: TokenManifest): string {
  const q = (s: string) => JSON.stringify(s)
  const attributes = new Map<string, string[]>()
  for (const theme of manifest.themes) {
    const names = attributes.get(theme.attribute) ?? []
    names.push(theme.name)
    attributes.set(theme.attribute, names)
  }
  for (const [attribute, names] of attributes) {
    if (attribute === 'theme' && manifest.themes.some((t) => t.auto)) names.push('auto')
  }
  return [
    '// Generated by @tessera/tokens. Do not edit.',
    '',
    'export interface TokenTypes {',
    ...manifest.tokens.map((t) => `  ${q(t.path)}: ${q(t.type)}`),
    '}',
    '',
    'export type TokenPath = keyof TokenTypes',
    '',
    'export type TokenVar =',
    ...(manifest.tokens.length ? manifest.tokens.map((t) => `  | ${q(t.cssVar)}`) : ['  | never']),
    '',
    '/** Theme names per `data-*` attribute. */',
    'export interface ThemeNames {',
    ...[...attributes].map(
      ([attribute, names]) => `  ${q(attribute)}: ${names.map(q).join(' | ')}`,
    ),
    '}',
    '',
  ].join('\n')
}
