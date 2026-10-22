import { parseCssColor, type Color, type TokenManifest, type TokenTier } from '@tessera/tokens'
import type { Accept } from '../config'

export interface StyleToken {
  path: string
  type: string
  tier: TokenTier | 'unknown'
  /** `--t-color-action-primary-bg` */
  cssVar: string
  /** Resolved CSS value per scope: `base`, then `theme=dark`, `density=compact`, and so on. */
  resolved: Record<string, string>
}

/** The design tokens that style checks look things up in. */
export class StyleTokens {
  private readonly byPath = new Map<string, StyleToken>()

  constructor(
    tokens: StyleToken[],
    /** Scope names, `base` first. */
    readonly scopes: string[] = ['base'],
  ) {
    for (const token of tokens) this.byPath.set(token.path, token)
  }

  static fromManifest(manifest: TokenManifest): StyleTokens {
    const scopes = ['base', ...manifest.themes.map((t) => `${t.attribute}=${t.name}`)]
    return new StyleTokens(
      manifest.tokens.map((t) => ({
        path: t.path,
        type: t.type,
        tier: t.tier,
        cssVar: t.cssVar,
        resolved: Object.fromEntries(
          Object.entries(t.values).map(([scope, v]) => [scope, v.resolved]),
        ),
      })),
      scopes,
    )
  }

  /** Only the names are known: enough to check that a token exists, not what type it is. */
  static fromPaths(paths: Iterable<string>): StyleTokens {
    return new StyleTokens(
      [...paths].map((path) => ({
        path,
        type: 'unknown',
        tier: 'unknown',
        cssVar: `--t-${path
          .split('.')
          .filter((s) => s !== '$root')
          .join('-')}`,
        resolved: {},
      })),
    )
  }

  has(path: string): boolean {
    return this.byPath.has(path)
  }

  get(path: string): StyleToken | undefined {
    return this.byPath.get(path)
  }

  paths(): string[] {
    return [...this.byPath.keys()]
  }

  all(): StyleToken[] {
    return [...this.byPath.values()]
  }

  /** Tokens a property may use, by type and group. */
  accepted(accepts: Accept[]): StyleToken[] {
    return this.all().filter((t) => accepts.some((a) => matches(t, a)))
  }

  /** The color of a token in a scope, if it has one. */
  color(path: string, scope: string): Color | undefined {
    const value = this.byPath.get(path)?.resolved[scope]
    return value === undefined ? undefined : parseCssColor(value)
  }
}

export function matches(token: StyleToken, accept: Accept): boolean {
  if (token.type !== accept.type) return false
  if (!accept.groups?.length) return true
  return accept.groups.some((g) => token.path === g || token.path.startsWith(`${g}.`))
}

/** Length in px (rem is 16px), duration in ms, or a plain number: how tokens and raw values compare. */
export function numericValue(css: string): number | undefined {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|ms|s)?$/.exec(css.trim())
  if (!m) return undefined
  const n = parseFloat(m[1]!)
  switch (m[2]) {
    case 'rem':
      return n * 16
    case 's':
      return n * 1000
    default:
      return n
  }
}
