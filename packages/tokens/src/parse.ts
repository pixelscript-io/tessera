import type { TokenDiagnostic } from './errors'

export interface RawToken {
  /** Dotted path, such as `color.action.primary.bg`. A trailing `$root` segment is kept. */
  path: string
  segments: string[]
  file: string
  /** Explicit or inherited from a group. Undefined when the token must take its type from what it references. */
  type?: string
  value: unknown
  description?: string
  extensions?: Record<string, unknown>
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const NAME = /^[A-Za-z0-9_-]+$/

/** CSS custom property name for a token path: `--t-color-action-primary-bg`. `$root` is dropped. */
export function cssVarName(path: string): string {
  return `--t-${path
    .split('.')
    .filter((s) => s !== '$root')
    .join('-')}`
}

const tierOf = (extensions: Record<string, unknown> | undefined): unknown =>
  (extensions?.tessera as { tier?: unknown } | undefined)?.tier

export function parseJson(
  content: unknown,
  file: string,
  diagnostics: TokenDiagnostic[],
): Record<string, unknown> | undefined {
  let doc = content
  if (typeof content === 'string') {
    try {
      doc = JSON.parse(content)
    } catch (e) {
      diagnostics.push({
        code: 'T1001',
        severity: 'error',
        file,
        message: `Could not parse as JSON: ${(e as Error).message}`,
      })
      return undefined
    }
  }
  if (!isObject(doc)) {
    diagnostics.push({
      code: 'T1001',
      severity: 'error',
      file,
      message: 'A token file must contain a JSON object at the top level.',
    })
    return undefined
  }
  return doc
}

/**
 * Flatten a DTCG document into tokens. `rootKeys` are top-level `$` keys the caller handles itself
 * (themes use `$extends`, `$attribute` and `$auto`).
 */
export function flattenTokens(
  doc: Record<string, unknown>,
  file: string,
  diagnostics: TokenDiagnostic[],
  rootKeys: ReadonlySet<string> = new Set(),
): RawToken[] {
  const tokens: RawToken[] = []

  const report = (code: TokenDiagnostic['code'], path: string, message: string, hint?: string) =>
    diagnostics.push({ code, severity: 'error', file, path: path || undefined, message, hint })

  function walk(
    node: Record<string, unknown>,
    segments: string[],
    inherited: string | undefined,
    inheritedTier: unknown,
  ) {
    const path = segments.join('.')
    const isToken = '$value' in node
    if ('$extends' in node && !(segments.length === 0 && rootKeys.has('$extends'))) {
      report(
        'T1009',
        path,
        'Group "$extends" is not supported yet. Write the tokens out in the group instead.',
      )
    }
    if (!isToken && '$ref' in node) {
      report(
        'T1009',
        path,
        'JSON Pointer "$ref" is not supported yet. Use a {group.token} alias instead.',
      )
      return
    }

    let type = inherited
    const tier = tierOf(isObject(node.$extensions) ? node.$extensions : undefined) ?? inheritedTier
    if ('$type' in node) {
      if (typeof node.$type === 'string') type = node.$type
      else report('T1001', path, '"$type" must be a string.')
    }

    if (isToken) {
      const children = Object.keys(node).filter((k) => !k.startsWith('$'))
      if (children.length > 0) {
        report('T1001', path, `A token cannot also contain nested names (${children.join(', ')}).`)
      }
      const description = typeof node.$description === 'string' ? node.$description : undefined
      let extensions = isObject(node.$extensions) ? node.$extensions : undefined
      // A group can set the tier for every token below it with $extensions.tessera.tier.
      if (inheritedTier !== undefined && tierOf(extensions) === undefined) {
        extensions = {
          ...extensions,
          tessera: { ...(extensions?.tessera as object | undefined), tier: inheritedTier },
        }
      }
      tokens.push({ path, segments, file, type, value: node.$value, description, extensions })
      return
    }

    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$') && key !== '$root') {
        if (segments.length === 0 && rootKeys.has(key)) continue
        continue
      }
      if (key !== '$root' && !NAME.test(key)) {
        report(
          'T1002',
          [...segments, key].join('.'),
          `Invalid token name "${key}". Names may only contain letters, numbers, "-" and "_" so they can become CSS custom properties.`,
        )
        continue
      }
      if (!isObject(child)) {
        report(
          'T1001',
          [...segments, key].join('.'),
          `Expected a group or a token (an object), got ${JSON.stringify(child)}.`,
        )
        continue
      }
      if (key === '$root' && !('$value' in child)) {
        report('T1001', [...segments, key].join('.'), '"$root" must be a token with a "$value".')
        continue
      }
      walk(child, [...segments, key], type, tier)
    }
  }

  walk(doc, [], undefined, undefined)
  return tokens
}
