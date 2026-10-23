export const TOKEN_CODES = {
  T1001: 'Invalid token file',
  T1002: 'Invalid token name',
  T1003: 'Missing token type',
  T1004: 'Unsupported token type',
  T1005: 'Invalid token value',
  T1006: 'Unknown token reference',
  T1007: 'Circular token reference',
  T1008: 'Token reference has the wrong type',
  T1009: 'Unsupported DTCG feature',
  T1010: 'Theme extends the wrong base',
  T1011: 'Theme adds a new token name',
  T1012: 'Theme changes a token type',
  T1013: 'Duplicate token',
  T1014: 'Invalid theme file',
  T1015: 'Duplicate theme',
  T1016: 'Import skipped or adjusted something',
  T1017: 'Cannot read the import',
} as const

export type TokenCode = keyof typeof TOKEN_CODES

export interface TokenDiagnostic {
  code: TokenCode
  severity: 'error' | 'warning'
  message: string
  /** Suggestion, phrased as a sentence, such as `Did you mean "x"?` */
  hint?: string
  file?: string
  /** Dotted token path. Token files are parsed without source positions, so the path stands in for line and column. */
  path?: string
}

/** Same layout as the compiler errors in the spec (section 11), with the token path in place of line:column. */
export function formatDiagnostic(d: TokenDiagnostic): string {
  const where = [d.file, d.path].filter(Boolean).join('  ')
  const lines = [
    `${d.severity.toUpperCase()}  ${d.code}${where ? `  ${where}` : ''}`,
    `  ${d.message}`,
  ]
  if (d.hint) lines.push(`  ${d.hint}`)
  lines.push(`  Run \`tessera explain ${d.code}\` for details.`)
  return lines.join('\n')
}

/** Thrown while rendering a single token's value; converted to a diagnostic by the builder. */
export class TokenFailure extends Error {
  constructor(
    readonly code: TokenCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
  }
}

export function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j]!
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return prev[b.length]!
}

/** The closest candidate, if it is close enough to plausibly be a typo. */
export function nearest(input: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const d = distance(input, candidate)
    if (d < bestDistance) {
      best = candidate
      bestDistance = d
    }
  }
  const limit = Math.max(1, Math.ceil(input.length * 0.4))
  return best !== undefined && bestDistance <= limit ? best : undefined
}
