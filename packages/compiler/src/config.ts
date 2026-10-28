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
  /**
   * The design systems in `system/`: each is a folder of tokens (`system/<path>/tokens`) that the shared
   * `system/components` are styled by. `path` is the folder under `system/` and defaults to the lower-cased name.
   */
  systems?: SystemEntry[]
  /** The name of the system the app builds with and the docs show first. Default: the first of `systems`. */
  defaultSystem?: string
  /** `false` turns off the docs that `tessera dev` serves beside the app. Default `true`. */
  docs?: boolean
}

export interface SystemEntry {
  name: string
  /** Folder under `system/`, such as `/tailwind`. Default: the name in lower case. */
  path?: string
}

const folderOf = (system: SystemEntry): string =>
  (system.path ?? system.name.toLowerCase()).replace(/^[\\/]+|[\\/]+$/g, '').replaceAll('\\', '/')

/** The folder under `system/` that holds the tokens of the active system, or undefined if the config names none. */
export function activeSystemFolder(config: TesseraConfig): string | undefined {
  const wanted = config.defaultSystem
  const systems = config.systems ?? []
  if (wanted === undefined) return systems[0] ? folderOf(systems[0]) : undefined
  const found = systems.find((s) => s.name.toLowerCase() === wanted.toLowerCase())
  return found ? folderOf(found) : wanted
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
  code: 'T2112' | 'T2115'
  message: string
  /** Index into `severity` (T2112) or `systems` (T2115; 0 when the problem is the default). */
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
  issues.push(...validateSystems(config))
  return issues
}

/** Problems with `systems` and `defaultSystem`: a missing name, two the same, a folder outside `system/`, a default not in the list. */
function validateSystems(config: TesseraConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const systems = config.systems ?? []
  const names = new Map<string, number>()
  const folders = new Map<string, number>()
  systems.forEach((system, index) => {
    const bad = (message: string) => issues.push({ code: 'T2115', index, message })
    const where = `systems[${index}]`
    if (typeof system.name !== 'string' || !system.name.trim()) {
      bad(`${where} has no name. Give each system a name, such as { name: 'Tailwind' }.`)
      return
    }
    const folder = folderOf(system)
    if (!folder || folder.split('/').includes('..') || /^[A-Za-z]:/.test(folder)) {
      bad(
        `${where} (${system.name}) has the path "${system.path}", which is not a folder inside system/. Use a name such as "/${system.name.toLowerCase()}".`,
      )
      return
    }
    const sameName = names.get(system.name.toLowerCase())
    if (sameName !== undefined) {
      bad(
        `${where} repeats the name "${system.name}" (see systems[${sameName}]). System names must be different.`,
      )
      return
    }
    names.set(system.name.toLowerCase(), index)
    const sameFolder = folders.get(folder)
    if (sameFolder !== undefined) {
      bad(
        `${where} (${system.name}) uses the folder "${folder}", which systems[${sameFolder}] already uses. Give each system its own path.`,
      )
    } else folders.set(folder, index)
  })
  if (
    config.defaultSystem !== undefined &&
    systems.length &&
    !names.has(config.defaultSystem.toLowerCase())
  ) {
    issues.push({
      code: 'T2115',
      index: 0,
      message: `defaultSystem is "${config.defaultSystem}", which is not in systems. The systems are: ${systems.map((s) => s.name).join(', ')}.`,
    })
  }
  return issues
}
