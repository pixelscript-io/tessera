export const CONTRACT_CODES = {
  T3001: 'Contract is not valid JSON',
  T3002: 'Unknown contract field',
  T3003: 'Invalid contract field',
  T3004: 'Contract name does not match the file name',
  T3005: 'Unknown ARIA role',
  T3006: 'Missing root part',
  T3007: 'Duplicate value',
  T3008: 'Unknown behavior',
  T3009: 'Behavior requirement not met',
  T3010: 'Contrast pairing names an undeclared part',
  T3011: 'Declared part is not used in the template',
  T3012: 'Missing required contract field',
  T3013: 'Root element does not carry the root part',
  T3014: 'Invalid rename or deprecation of a variant value',
} as const

export type ContractCode = keyof typeof CONTRACT_CODES

export interface ContractDiagnostic {
  code: ContractCode
  severity: 'error' | 'warning'
  message: string
  /** A suggestion phrased as a sentence, for example `Did you mean "danger"?` */
  hint?: string
  file: string
  line: number
  column: number
}

/** The error format from the spec (section 11). */
export function formatDiagnostic(d: Omit<ContractDiagnostic, 'code'> & { code: string }): string {
  const lines = [
    `${d.severity.toUpperCase()}  ${d.code}  ${d.file}:${d.line}:${d.column}`,
    `  ${d.message}`,
  ]
  if (d.hint) lines.push(`  ${d.hint}`)
  lines.push(`  Run \`tessera explain ${d.code}\` for details.`)
  return lines.join('\n')
}

function distance(a: string, b: string): number {
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
