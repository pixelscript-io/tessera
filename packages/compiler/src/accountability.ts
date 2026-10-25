/**
 * Accountable enforcement (spec section 8.5), as a library. A strict rule is only workable if existing code
 * has a way in (a baseline), violations have a repair (autofix), and exceptions are visible, reasoned and
 * able to expire (severity per path). The CLI exposes these in Milestone 11; the Vite plugin applies them now.
 */
import type { CompilerDiagnostic } from './diagnostics'
import type { ResolvedConfig, SeverityRule, TesseraConfig } from './config'
import { resolveConfig } from './config'

/** Style rules that count as violations: they can be baselined, and a severity rule with `*` covers them. */
export const VIOLATION_CODES: ReadonlySet<string> = new Set([
  'T2101', // raw color
  'T2102', // raw value off the scale
  'T2103', // wrong kind of token for the property
  'T2104', // unknown token
  'T2105', // primitive token in a component
  'T2107', // contrast
  'T2108', // malformed raw()
  'T2114', // unknown variant value in a selector
  'W4105', // data that can fail, shown without loading or error (a warning; a severity rule can make it an error)
])

/** Never baselined or downgraded: an expired escape must be dealt with, and contracts must be valid. */
export const isBaselineable = (code: string) => VIOLATION_CODES.has(code)

// --- globs -----------------------------------------------------------------------------------------

/** `*` matches within a folder, `**` across folders, `?` one character. */
export function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          out += '(?:.*/)?'
        } else out += '.*'
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

const normalizePath = (path: string) => path.replaceAll('\\', '/').replace(/^\.\//, '')

// --- severity per path -----------------------------------------------------------------------------

export type Level = 'error' | 'warn' | 'off'

function matchingRule(file: string, code: string, rules: SeverityRule[]): SeverityRule | undefined {
  const path = normalizePath(file)
  let found: SeverityRule | undefined
  for (const rule of rules) {
    const files = [rule.files].flat()
    const codes = [rule.rules].flat()
    if (!files.some((g) => globToRegExp(normalizePath(g)).test(path))) continue
    if (!codes.includes(code) && !(codes.includes('*') && isBaselineable(code))) continue
    found = rule
  }
  return found
}

/**
 * The severity configured for a rule in a file, or undefined when no setting applies. A setting with an
 * `expires` date that has passed reverts to `error`.
 */
export function resolveSeverity(
  file: string,
  code: string,
  config: TesseraConfig | ResolvedConfig,
  today: string,
): { level: Level; rule: SeverityRule; expired: boolean } | undefined {
  const rule = matchingRule(file, code, config.severity ?? [])
  if (!rule) return undefined
  const expired = rule.expires !== undefined && today > rule.expires
  return { level: expired ? 'error' : rule.level, rule, expired }
}

/** Apply the configured severities to a file's diagnostics. `off` removes a diagnostic. */
export function applySeverity(
  file: string,
  diagnostics: CompilerDiagnostic[],
  config: TesseraConfig,
  today: string,
): CompilerDiagnostic[] {
  const resolved = resolveConfig(config)
  const out: CompilerDiagnostic[] = []
  for (const d of diagnostics) {
    const setting = isBaselineable(d.code)
      ? resolveSeverity(file, d.code, resolved, today)
      : undefined
    if (!setting) {
      out.push(d)
      continue
    }
    if (setting.level === 'off') continue
    const note = setting.expired
      ? `The exemption for ${[setting.rule.files].flat().join(', ')} expired on ${setting.rule.expires}: "${setting.rule.reason}".`
      : undefined
    out.push({
      ...d,
      severity: setting.level === 'warn' ? 'warning' : 'error',
      ...(note ? { hint: [d.hint, note].filter(Boolean).join(' ') } : {}),
    })
  }
  return out
}

// --- baseline --------------------------------------------------------------------------------------

export interface Baseline {
  version: 1
  /** File path to rule code to the number of violations recorded. */
  files: Record<string, Record<string, number>>
}

export const emptyBaseline = (): Baseline => ({ version: 1, files: {} })

/** Count the violations that currently fail (errors) in each file. */
export function countViolations(diagnostics: CompilerDiagnostic[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const d of diagnostics) {
    if (d.severity === 'error' && isBaselineable(d.code)) counts[d.code] = (counts[d.code] ?? 0) + 1
  }
  return counts
}

/** Record today's violations as the baseline. Files with none are left out. */
export function createBaseline(
  results: Array<{ file: string; diagnostics: CompilerDiagnostic[] }>,
): Baseline {
  const baseline = emptyBaseline()
  for (const { file, diagnostics } of results) {
    const counts = countViolations(diagnostics)
    if (Object.keys(counts).length) baseline.files[normalizePath(file)] = counts
  }
  return baseline
}

export interface BaselineResult {
  /** What is left to fix: everything not covered by the baseline. */
  diagnostics: CompilerDiagnostic[]
  /** How many violations the baseline absorbed. */
  suppressed: number
  /** Rules where the file now has fewer violations than recorded; `baseline --prune` lowers these. */
  improved: Array<{ code: string; recorded: number; current: number }>
}

/**
 * Hold a file to its baseline. For each rule, the first N violations in the file (N is the recorded count)
 * are absorbed and the rest are reported, so a file can only get better: fixing one lowers what it may have,
 * and adding one beyond the recorded count fails. Which violation counts as "new" is not tracked; the later
 * ones in the file are the ones reported.
 */
export function applyBaseline(
  file: string,
  diagnostics: CompilerDiagnostic[],
  baseline: Baseline | undefined,
): BaselineResult {
  const recorded = baseline?.files[normalizePath(file)] ?? {}
  const remaining = new Map<string, number>(Object.entries(recorded))
  const seen: Record<string, number> = {}
  const kept: CompilerDiagnostic[] = []
  let suppressed = 0

  const ordered = [...diagnostics].sort((a, b) => a.line - b.line || a.column - b.column)
  for (const d of ordered) {
    if (d.severity === 'error' && isBaselineable(d.code)) {
      seen[d.code] = (seen[d.code] ?? 0) + 1
      const left = remaining.get(d.code) ?? 0
      if (left > 0) {
        remaining.set(d.code, left - 1)
        suppressed++
        continue
      }
    }
    kept.push(d)
  }

  const improved = Object.entries(recorded)
    .filter(([code, count]) => (seen[code] ?? 0) < count)
    .map(([code, count]) => ({ code, recorded: count, current: seen[code] ?? 0 }))
  return { diagnostics: kept, suppressed, improved }
}

/** Lower the baseline to what files have now. Counts never go up, and entries that reach zero are removed. */
export function pruneBaseline(
  baseline: Baseline,
  current: Array<{ file: string; diagnostics: CompilerDiagnostic[] }>,
): Baseline {
  const now = new Map(current.map((c) => [normalizePath(c.file), countViolations(c.diagnostics)]))
  const pruned = emptyBaseline()
  for (const [file, codes] of Object.entries(baseline.files)) {
    const seen = now.get(file) ?? {}
    for (const [code, count] of Object.entries(codes)) {
      const lowered = Math.min(count, seen[code] ?? 0)
      if (lowered > 0) (pruned.files[file] ??= {})[code] = lowered
    }
  }
  return pruned
}

// --- autofix ---------------------------------------------------------------------------------------

export interface FixResult {
  source: string
  applied: number
  /** Fixes left out because they overlapped an earlier one. */
  skipped: number
}

/**
 * Apply the fixes that diagnostics carry. A fix only exists when it is unambiguous and leaves the rendered
 * result in the default theme unchanged: an exact value match to a single token, or a typo with one clear
 * target. Run the compiler again afterwards; a fix can reveal the next problem.
 */
export function applyFixes(source: string, diagnostics: CompilerDiagnostic[]): FixResult {
  const fixes = diagnostics
    .flatMap((d) => (d.fix ? [d.fix] : []))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  let out = source
  let applied = 0
  let skipped = 0
  let limit = Infinity
  // Apply from the end so earlier offsets stay valid; skip anything overlapping a later fix.
  for (const fix of fixes.reverse()) {
    if (fix.end > limit) {
      skipped++
      continue
    }
    out = out.slice(0, fix.start) + fix.text + out.slice(fix.end)
    limit = fix.start
    applied++
  }
  return { source: out, applied, skipped }
}
