/** What a property may be given in `<style>` instead of a raw value. */
export interface Accept {
  /** Token `$type`, such as `dimension`, `color` or `duration`. */
  type: string
  /** Token groups it may come from, such as `space`. A path matches when it is in or under a group. */
  groups?: string[]
}

/** Property name to what it accepts. `false` removes a property from the governed set. */
export type GovernedMap = Record<string, Accept | Accept[] | false>

export interface SeverityRule {
  /** Glob or globs (`*`, `**`) matched against the file path. */
  files: string | string[]
  /** Rule codes, or `*` for all token and contrast rules. */
  rules: string | string[]
  level: 'error' | 'warn' | 'off'
  /** Required whenever `level` is `warn` or `off`. */
  reason?: string
  /** ISO date. After it, the rule reverts to `error`. */
  expires?: string
}

export interface TesseraConfig {
  /** Properties whose values must come from tokens. Merged over the defaults. */
  governed?: GovernedMap
  /** WCAG contrast needed between a part's text and background. Default `AA` (4.5). */
  contrast?: { level?: 'AA' | 'AAA'; minimum?: number }
  /** What referencing a primitive token from `<style>` does. Default `warn`. */
  primitives?: 'warn' | 'error' | 'off'
  /** `false` requires explicit imports everywhere. Components stay registered for docs and the manifest. Default `true`. */
  autoImports?: boolean
  /** Lower the severity of rules for paths, with a reason and optionally an expiry. */
  severity?: SeverityRule[]
}

export interface ResolvedConfig {
  governed: Record<string, Accept[]>
  contrast: { minimum: number }
  primitives: 'warn' | 'error' | 'off'
  severity: SeverityRule[]
  autoImports: boolean
}

const space: Accept = { type: 'dimension', groups: ['space'] }
const radius: Accept = { type: 'dimension', groups: ['radius'] }
const color: Accept = { type: 'color', groups: ['color'] }

const SIDES = ['top', 'right', 'bottom', 'left']
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

/** The defaults: spacing, radius, font size, opacity, motion, shadows and colors. */
export const DEFAULT_GOVERNED: GovernedMap = {
  padding: space,
  margin: space,
  gap: space,
  'row-gap': space,
  'column-gap': space,
  ...Object.fromEntries(
    SIDES.flatMap((s) => [
      [`padding-${s}`, space],
      [`margin-${s}`, space],
    ]),
  ),
  'padding-inline': space,
  'padding-block': space,
  'margin-inline': space,
  'margin-block': space,
  'border-radius': radius,
  ...Object.fromEntries(CORNERS.map((c) => [`border-${c}-radius`, radius])),
  'font-size': { type: 'dimension', groups: ['font.size'] },
  opacity: { type: 'number', groups: ['opacity'] },
  'transition-duration': { type: 'duration', groups: ['motion.duration'] },
  'animation-duration': { type: 'duration', groups: ['motion.duration'] },
  'transition-timing-function': { type: 'cubicBezier', groups: ['motion.easing'] },
  'box-shadow': { type: 'shadow', groups: ['shadow'] },
  color,
  background: color,
  'background-color': color,
  'border-color': color,
  ...Object.fromEntries(SIDES.map((s) => [`border-${s}-color`, color])),
  'outline-color': color,
  fill: color,
  stroke: color,
  'caret-color': color,
  'accent-color': color,
  'text-decoration-color': color,
}

export function defineConfig(config: TesseraConfig): TesseraConfig {
  return config
}

export function resolveConfig(config: TesseraConfig = {}): ResolvedConfig {
  const governed: Record<string, Accept[]> = {}
  for (const [property, accepts] of Object.entries({ ...DEFAULT_GOVERNED, ...config.governed })) {
    if (accepts === false) continue
    governed[property] = Array.isArray(accepts) ? accepts : [accepts]
  }
  const contrast = config.contrast ?? {}
  return {
    governed,
    contrast: { minimum: contrast.minimum ?? (contrast.level === 'AAA' ? 7 : 4.5) },
    primitives: config.primitives ?? 'warn',
    severity: config.severity ?? [],
    autoImports: config.autoImports ?? true,
  }
}

export interface ConfigIssue {
  code: 'T2112'
  message: string
  /** Index into `severity`. */
  index: number
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Problems with the accountability settings: a downgrade without a reason, or a bad date. */
export function validateConfig(config: TesseraConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  config.severity?.forEach((rule, index) => {
    const where = `severity[${index}] (${[rule.files].flat().join(', ')})`
    if (rule.level !== 'error' && !rule.reason?.trim()) {
      issues.push({
        code: 'T2112',
        index,
        message: `${where} sets "${rule.level}" without a reason. Add a "reason" saying why this path is exempt.`,
      })
    }
    if (
      rule.expires !== undefined &&
      (!ISO_DATE.test(rule.expires) || Number.isNaN(Date.parse(rule.expires)))
    ) {
      issues.push({
        code: 'T2112',
        index,
        message: `${where} has expires "${rule.expires}", which is not a date like "2027-03-01".`,
      })
    }
    if (!['error', 'warn', 'off'].includes(rule.level)) {
      issues.push({
        code: 'T2112',
        index,
        message: `${where} has level "${rule.level as string}"; use "error", "warn" or "off".`,
      })
    }
  })
  return issues
}
