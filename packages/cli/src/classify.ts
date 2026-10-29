import { TOKEN_CATEGORIES, type TokenCategory } from '@tessera/compiler'

/**
 * Works out which of a person's token groups hold spacing, radii, font sizes and so on, from the type of each token
 * and the words in its path, so enforcement reads the groups they have and not the ones Tessera's own tokens use.
 * It never renames a token. What it cannot place is counted and reported, not guessed.
 */

export interface TokenRef {
  path: string
  type: string
}

export interface Classification {
  /** The `tokenGroups` setting that makes enforcement read these groups. Empty when the defaults already fit. */
  tokenGroups: Partial<Record<TokenCategory, string[] | false>>
  /** What each category found, for the report: the groups, and how many tokens. */
  found: Array<{ category: TokenCategory; groups: string[]; count: number }>
  /** Dimension and number tokens that are in none of the categories, by the group they are in. */
  unplaced: Array<{ group: string; type: string; count: number; example: string }>
}

interface Rule {
  category: TokenCategory
  type: string
  /** Index of the last segment of the path that says what the token is, or -1 if the path does not say. */
  at(segments: string[]): number
}

/** Path segments, lower case and split at dashes and camelCase (`fontSize`, `font-size`, `font.size` read alike). */
function words(path: string): { segments: string[]; parts: string[][] } {
  const segments = path.split('.')
  const parts = segments.map((s) =>
    s
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .split(/[-_]+/)
      .filter(Boolean),
  )
  return { segments, parts }
}

/** The first segment, from the start, whose words include one of `names`. */
const segmentWith = (parts: string[][], names: string[]): number =>
  parts.findIndex((p) => p.some((w) => names.includes(w)))

/** The segment that names the thing most exactly (`duration`), else one that only names its area (`motion`). */
const named = (segments: string[], exact: string[], area: string[]): number => {
  const { parts } = words(segments.join('.'))
  const at = segmentWith(parts, exact)
  return at !== -1 ? at : segmentWith(parts, area)
}

const RULES: Rule[] = [
  {
    category: 'radius',
    type: 'dimension',
    at: (s) =>
      segmentWith(words(s.join('.')).parts, ['radius', 'radii', 'rounded', 'corner', 'corners']),
  },
  {
    // `font.size.lg`, `fontSizes.lg`, `text.lg`, `type.size.lg`
    category: 'fontSize',
    type: 'dimension',
    at: (s) => {
      const { parts } = words(s.join('.'))
      const direct = segmentWith(parts, ['fontsize', 'fontsizes'])
      if (direct !== -1) return direct
      for (let i = 0; i < parts.length; i++) {
        const joined = parts[i]!.join('-')
        if (joined === 'font-size' || joined === 'font-sizes') return i
        if (parts[i]!.includes('font') && parts[i + 1]?.some((w) => w === 'size' || w === 'sizes'))
          return i + 1
        if (
          parts[i]!.some((w) => w === 'type' || w === 'typography') &&
          parts[i + 1]?.some((w) => w === 'size' || w === 'sizes')
        )
          return i + 1
      }
      return segmentWith(parts, ['text', 'texts'])
    },
  },
  {
    category: 'space',
    type: 'dimension',
    at: (s) =>
      segmentWith(words(s.join('.')).parts, [
        'space',
        'spaces',
        'spacing',
        'spacings',
        'spacer',
        'spacers',
        'gap',
        'gaps',
        'gutter',
        'gutters',
        'padding',
        'margin',
        'inset',
        'sp',
      ]),
  },
  {
    category: 'opacity',
    type: 'number',
    at: (s) => segmentWith(words(s.join('.')).parts, ['opacity', 'opacities', 'alpha']),
  },
  // These types mean one thing each; the name only says where they are grouped.
  {
    category: 'duration',
    type: 'duration',
    at: (s) => named(s, ['duration', 'durations'], ['speed', 'timing', 'motion', 'transition']),
  },
  {
    category: 'easing',
    type: 'cubicBezier',
    at: (s) =>
      named(
        s,
        ['easing', 'easings', 'ease', 'curve', 'curves'],
        ['motion', 'transition', 'timing'],
      ),
  },
  {
    category: 'shadow',
    type: 'shadow',
    at: (s) =>
      segmentWith(words(s.join('.')).parts, ['shadow', 'shadows', 'elevation', 'elevations']),
  },
]

/** These types mean one thing each: the name only says where they are grouped, so a token without a hint counts. */
const UNAMBIGUOUS = new Set<TokenCategory>(['duration', 'easing', 'shadow'])

/** `a.b.$root` is the token `a.b`: its group is above it. */
const withoutRoot = (path: string) => path.replace(/\.\$root$/, '')

/** The group of a token that is not named for one: the group it sits in, or itself if it is at the top. */
const parentGroup = (segments: string[]): string =>
  segments.length > 1 ? segments.slice(0, -1).join('.') : segments.join('.')

export function classifyTokens(tokens: TokenRef[]): Classification {
  const groups = new Map<TokenCategory, Map<string, number>>()
  const unplaced = new Map<
    string,
    { group: string; type: string; count: number; example: string }
  >()
  const colors = { all: 0, outside: 0 }

  for (const { path: raw, type } of tokens) {
    const path = withoutRoot(raw)
    const segments = path.split('.')
    if (type === 'color') {
      colors.all++
      if (segments[0] !== 'color') colors.outside++
      continue
    }
    const rule = RULES.find(
      (r) => r.type === type && (r.at(segments) !== -1 || UNAMBIGUOUS.has(r.category)),
    )
    if (!rule) {
      if (type === 'dimension' || type === 'number') {
        const group = parentGroup(segments)
        const key = `${group}|${type}`
        const entry = unplaced.get(key)
        if (entry) entry.count++
        else unplaced.set(key, { group, type, count: 1, example: path })
      }
      continue
    }
    const at = rule.at(segments)
    const group = at === -1 ? parentGroup(segments) : segments.slice(0, at + 1).join('.')
    const map = groups.get(rule.category) ?? new Map<string, number>()
    map.set(group, (map.get(group) ?? 0) + 1)
    groups.set(rule.category, map)
  }

  const tokenGroups: Classification['tokenGroups'] = {}
  const found: Classification['found'] = []
  for (const [category, map] of groups) {
    const names = [...map.keys()].sort()
    found.push({ category, groups: names, count: [...map.values()].reduce((a, b) => a + b, 0) })
    const home = TOKEN_CATEGORIES[category]
    // Already read from the default group (or below it): nothing to say.
    if (names.every((g) => g === home || g.startsWith(`${home}.`))) continue
    tokenGroups[category] = names
  }
  if (colors.outside > 0) {
    found.push({ category: 'color', groups: [], count: colors.all })
    tokenGroups.color = false
  }
  return { tokenGroups, found, unplaced: [...unplaced.values()] }
}

/** The `tokenGroups` setting as the lines of a config file. */
export function tokenGroupsSource(tokenGroups: Classification['tokenGroups']): string {
  const entries = Object.entries(tokenGroups).map(([category, groups]) =>
    groups === false || groups === undefined
      ? `${category}: false`
      : `${category}: [${groups.map((g) => `'${g.replaceAll("'", "\\'")}'`).join(', ')}]`,
  )
  return `tokenGroups: { ${entries.join(', ')} }`
}

/**
 * Puts `tokenGroups` into the object a config file exports, or says why it did not. A config that already has
 * `tokenGroups` is left to the person; one whose shape this does not know is too.
 */
export function addTokenGroups(
  config: string,
  tokenGroups: Classification['tokenGroups'],
): { text: string } | { reason: string } {
  if (/\btokenGroups\s*:/.test(config))
    return { reason: 'tessera.config.ts already sets tokenGroups' }
  const open = /export\s+default\s+(?:defineConfig\(\s*)?\{[^\S\r\n]*(\r?\n)?/.exec(config)
  if (!open) return { reason: 'tessera.config.ts does not start with "export default {"' }
  const eol = config.includes('\r\n') ? '\r\n' : '\n'
  const insert = [
    '  // Written by `tessera tokens import`: the groups of your tokens that hold each kind of value. Edit freely.',
    `  ${tokenGroupsSource(tokenGroups)},`,
    '',
  ].join(eol)
  const at = open.index + open[0].length
  const lead = open[1] ? '' : eol
  return { text: config.slice(0, at) + lead + insert + config.slice(at) }
}
