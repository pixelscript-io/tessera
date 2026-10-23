import { contrastRatio, parseCssColor } from './color-math'
import type { TokenManifest } from './build'

export interface ContrastRow {
  scope: string
  foreground: string
  background: string
  ratio: number
  /** Against the minimum the caller passed. */
  passes: boolean
}

const TEXT_NAMES = new Set(['text', 'fg', 'foreground'])
const BACKGROUND_NAMES = new Set(['bg', 'background'])

/**
 * Pairs of tokens a person would put text on: the `text` and `bg` siblings of a group (`color.action.primary.text`
 * on `color.action.primary.bg`), and every `color.text.*` on every `color.surface.*`. The ratio is measured in
 * every scope that has both, from the value after aliases are followed.
 */
export function contrastPairs(manifest: TokenManifest | undefined, minimum: number): ContrastRow[] {
  if (!manifest) return []
  const colors = manifest.tokens.filter((t) => t.type === 'color')
  const byPath = new Map(colors.map((t) => [t.path, t]))
  const pairs = new Set<string>()
  for (const t of colors) {
    const segments = t.path.split('.')
    const last = segments.pop()!
    if (TEXT_NAMES.has(last)) {
      for (const bg of BACKGROUND_NAMES) {
        const other = [...segments, bg].join('.')
        if (byPath.has(other)) pairs.add(`${t.path}|${other}`)
      }
    }
    if (t.path.startsWith('color.text.')) {
      for (const s of colors)
        if (s.path.startsWith('color.surface.')) pairs.add(`${t.path}|${s.path}`)
    }
  }
  const scopes = [
    'base',
    ...manifest.themes.filter((t) => t.attribute === 'theme').map((t) => `theme=${t.name}`),
  ]
  const out: ContrastRow[] = []
  for (const pair of pairs) {
    const [fg, bg] = pair.split('|') as [string, string]
    for (const scope of scopes) {
      const f = parseCssColor(
        byPath.get(fg)!.values[scope]?.resolved ?? byPath.get(fg)!.values['base']!.resolved,
      )
      const b = parseCssColor(
        byPath.get(bg)!.values[scope]?.resolved ?? byPath.get(bg)!.values['base']!.resolved,
      )
      if (!f || !b || f.alpha < 1 || b.alpha < 1) continue
      const ratio = Math.round(contrastRatio(f, b) * 100) / 100
      out.push({ scope, foreground: fg, background: bg, ratio, passes: ratio >= minimum })
    }
  }
  return out
}
