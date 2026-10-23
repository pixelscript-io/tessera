import { contrastPairs, type TokenManifest } from '@tessera/tokens'
import type { ManifestComponent } from './agent-manifest'
import { numericValue } from './style/tokens'

/**
 * What changed between two versions of a design system, classified by what it does to the people using it.
 * Pure: it compares two snapshots, and `tessera diff` gets them from git.
 */
export type ChangeKind = 'breaking' | 'additive' | 'cosmetic'

export interface Change {
  kind: ChangeKind
  /** `component`, `variant`, `token`, `theme` and so on: what the change is about. */
  subject: 'component' | 'token' | 'theme'
  /** `Button`, `Button.tone`, `$color.action.primary.bg`. */
  name: string
  message: string
  /** A rename that `tessera codemod` can apply to every use. */
  codemod?: boolean
  /** The change is a deprecation: nothing breaks yet, and it is listed under Deprecated. */
  deprecation?: boolean
}

export interface Snapshot {
  components: ManifestComponent[]
  tokens?: TokenManifest
}

export interface DiffOptions {
  /** The text contrast ratio the project requires. Default 4.5. */
  contrastMinimum?: number
}

const q = (s: string) => `"${s}"`
const list = (xs: string[]) => xs.map(q).join(', ')
const added = <T>(a: T[], b: T[]) => b.filter((x) => !a.includes(x))

function diffComponent(before: ManifestComponent, after: ManifestComponent, out: Change[]): void {
  const name = after.name
  const push = (c: Omit<Change, 'subject'>) => out.push({ subject: 'component', ...c })

  if (before.role !== after.role) {
    push({
      kind: 'breaking',
      name,
      message: `${name} changed role from ${q(before.role)} to ${q(after.role)}.`,
    })
  }
  if (before.behavior !== after.behavior) {
    if (after.behavior === undefined) {
      push({
        kind: 'breaking',
        name,
        message: `${name} no longer has the ${q(before.behavior!)} behavior.`,
      })
    } else if (before.behavior === undefined) {
      push({ kind: 'additive', name, message: `${name} gained the ${q(after.behavior)} behavior.` })
    } else {
      push({
        kind: 'breaking',
        name,
        message: `${name} changed behavior from ${q(before.behavior)} to ${q(after.behavior)}.`,
      })
    }
  }

  for (const part of before.parts.filter((p) => !after.parts.includes(p))) {
    push({
      kind: 'breaking',
      name: `${name}.${part}`,
      message: `${name} lost the part ${q(part)}.`,
    })
  }
  for (const part of added(before.parts, after.parts)) {
    push({
      kind: 'additive',
      name: `${name}.${part}`,
      message: `${name} gained the part ${q(part)}.`,
    })
  }

  for (const state of before.states.filter((s) => !after.states.includes(s))) {
    push({ kind: 'breaking', name, message: `${name} lost the state ${q(state)}.` })
  }
  for (const state of added(before.states, after.states)) {
    push({ kind: 'additive', name, message: `${name} gained the state ${q(state)}.` })
  }

  for (const slot of Object.keys(before.slots).filter((s) => !(s in after.slots))) {
    push({ kind: 'breaking', name, message: `${name} lost the slot ${q(slot)}.` })
  }
  for (const slot of Object.keys(after.slots).filter((s) => !(s in before.slots))) {
    push({ kind: 'additive', name, message: `${name} gained the slot ${q(slot)}.` })
  }
  for (const event of Object.keys(before.events).filter((e) => !(e in after.events))) {
    push({ kind: 'breaking', name, message: `${name} lost the event ${q(event)}.` })
  }
  for (const event of Object.keys(after.events).filter((e) => !(e in before.events))) {
    push({ kind: 'additive', name, message: `${name} gained the event ${q(event)}.` })
  }

  const beforeVariants = new Map(before.variants.map((v) => [v.name, v]))
  const afterVariants = new Map(after.variants.map((v) => [v.name, v]))
  for (const [variant, was] of beforeVariants) {
    const now = afterVariants.get(variant)
    const at = `${name}.${variant}`
    if (!now) {
      push({ kind: 'breaking', name: at, message: `${name} lost the variant ${q(variant)}.` })
      continue
    }
    for (const value of was.values.filter((v) => !now.values.includes(v))) {
      const renamed = after.renamedValues?.[variant]?.[value]
      if (renamed !== undefined) {
        push({
          kind: 'breaking',
          name: at,
          message: `${at} value ${q(value)} was renamed to ${q(renamed)}.`,
          codemod: true,
        })
      } else {
        push({ kind: 'breaking', name: at, message: `${at} lost the value ${q(value)}.` })
      }
    }
    for (const value of added(was.values, now.values)) {
      push({ kind: 'additive', name: at, message: `${at} gained the value ${q(value)}.` })
    }
    if (was.default !== now.default && now.values.includes(was.default)) {
      push({
        kind: 'breaking',
        name: at,
        message: `The default of ${at} changed from ${q(was.default)} to ${q(now.default)}, so uses that do not set it render differently.`,
      })
    }
  }
  for (const [variant, now] of afterVariants) {
    if (!beforeVariants.has(variant)) {
      push({
        kind: 'additive',
        name: `${name}.${variant}`,
        message: `${name} gained the variant ${q(variant)} (${list(now.values)}, default ${q(now.default)}).`,
      })
    }
  }

  if (after.deprecated !== undefined && before.deprecated === undefined) {
    push({
      kind: 'additive',
      name,
      deprecation: true,
      message: `${name} is now deprecated${after.deprecated ? `: ${after.deprecated}` : '.'}`,
    })
  }
  for (const [variant, values] of Object.entries(after.deprecatedValues ?? {})) {
    for (const [value, why] of Object.entries(values)) {
      if (before.deprecatedValues?.[variant]?.[value] === undefined) {
        push({
          kind: 'additive',
          name: `${name}.${variant}`,
          deprecation: true,
          message: `${name}.${variant} ${q(value)} is now deprecated${why ? `: ${why}` : '.'}`,
        })
      }
    }
  }
}

/** Moving a token across its neighbours in a scale (a spacing step that becomes larger than the next one). */
function scaleCrossings(before: TokenManifest, after: TokenManifest): Change[] {
  const out: Change[] = []
  const byGroup = new Map<string, string[]>()
  const was = new Map(before.tokens.map((t) => [t.path, t]))
  const now = new Map(after.tokens.map((t) => [t.path, t]))
  for (const t of after.tokens) {
    if (!was.has(t.path) || !['dimension', 'duration', 'number', 'fontWeight'].includes(t.type))
      continue
    const group = t.path.split('.').slice(0, -1).join('.')
    byGroup.set(group, [...(byGroup.get(group) ?? []), t.path])
  }
  const value = (m: Map<string, TokenManifest['tokens'][number]>, path: string) => {
    const css = m.get(path)?.values['base']?.resolved
    return css === undefined ? undefined : numericValue(css)
  }
  for (const paths of byGroup.values()) {
    const moved = new Map<string, string[]>()
    for (const a of paths) {
      for (const b of paths) {
        if (a >= b) continue
        const [a0, b0, a1, b1] = [value(was, a), value(was, b), value(now, a), value(now, b)]
        if ([a0, b0, a1, b1].some((n) => n === undefined)) continue
        if (Math.sign(a0! - b0!) !== 0 && Math.sign(a0! - b0!) === -Math.sign(a1! - b1!)) {
          // Whichever token changed is the one that moved; if both did, name both.
          const changed = [a, b].filter((p) => value(was, p) !== value(now, p))
          for (const p of changed) moved.set(p, [...(moved.get(p) ?? []), p === a ? b : a])
        }
      }
    }
    for (const [path, others] of moved) {
      out.push({
        kind: 'breaking',
        subject: 'token',
        name: `$${path}`,
        message: `$${path} moved past ${others.map((o) => `$${o}`).join(', ')} in its scale, so it is no longer in the same step.`,
      })
    }
  }
  return out
}

function diffTokens(
  before: TokenManifest,
  after: TokenManifest,
  contrastMinimum: number,
  out: Change[],
): void {
  const was = new Map(before.tokens.map((t) => [t.path, t]))
  const now = new Map(after.tokens.map((t) => [t.path, t]))
  const renamedTo = new Map<string, string>()
  for (const t of after.tokens) {
    const from = (t.extensions?.tessera as { renamedFrom?: unknown } | undefined)?.renamedFrom
    if (typeof from === 'string') renamedTo.set(from, t.path)
  }
  const push = (c: Omit<Change, 'subject'>) => out.push({ subject: 'token', ...c })

  for (const [path, old] of was) {
    const t = now.get(path)
    if (!t) {
      const renamed = renamedTo.get(path)
      push(
        renamed
          ? {
              kind: 'breaking',
              name: `$${path}`,
              message: `$${path} was renamed to $${renamed}.`,
              codemod: true,
            }
          : { kind: 'breaking', name: `$${path}`, message: `$${path} was removed.` },
      )
      continue
    }
    if (old.type !== t.type) {
      push({
        kind: 'breaking',
        name: `$${path}`,
        message: `$${path} changed type from ${old.type} to ${t.type}.`,
      })
      continue
    }
    const scopes = [...new Set([...Object.keys(old.values), ...Object.keys(t.values)])]
    const changed = scopes.filter((s) => old.values[s]?.resolved !== t.values[s]?.resolved)
    if (changed.length) {
      const detail = changed
        .slice(0, 3)
        .map(
          (s) => `${s}: ${old.values[s]?.resolved ?? 'none'} → ${t.values[s]?.resolved ?? 'none'}`,
        )
        .join('; ')
      push({
        kind: 'cosmetic',
        name: `$${path}`,
        message: `$${path} changed value (${detail}${changed.length > 3 ? `; ${changed.length - 3} more` : ''}).`,
      })
    }
    const deprecated = (t.extensions?.tessera as { deprecated?: unknown } | undefined)?.deprecated
    const wasDeprecated = (old.extensions?.tessera as { deprecated?: unknown } | undefined)
      ?.deprecated
    if (typeof deprecated === 'string' && wasDeprecated === undefined) {
      push({
        kind: 'additive',
        name: `$${path}`,
        deprecation: true,
        message: `$${path} is now deprecated${deprecated ? `: ${deprecated}` : '.'}`,
      })
    }
  }
  for (const path of now.keys()) {
    if (!was.has(path)) {
      // A rename's new name is reported with the old one.
      const isRename =
        [...renamedTo.values()].includes(path) &&
        [...renamedTo.keys()].some((k) => was.has(k) && !now.has(k))
      if (!isRename) push({ kind: 'additive', name: `$${path}`, message: `$${path} was added.` })
    }
  }

  // A value change that flips a contrast result in any theme is breaking, wherever it came from.
  const pairsBefore = contrastPairs(before, contrastMinimum)
  const key = (r: { foreground: string; background: string; scope: string }) =>
    `${r.foreground}|${r.background}|${r.scope}`
  const nowPairs = new Map(contrastPairs(after, contrastMinimum).map((r) => [key(r), r]))
  for (const r of pairsBefore) {
    const next = nowPairs.get(key(r))
    if (!next || r.passes === next.passes) continue
    const where = r.scope === 'base' ? 'the default theme' : r.scope
    if (r.passes) {
      push({
        kind: 'breaking',
        name: `$${r.foreground}`,
        message: `Contrast of $${r.foreground} on $${r.background} in ${where} fell from ${r.ratio}:1 to ${next.ratio}:1, below the ${contrastMinimum}:1 minimum.`,
      })
    } else {
      push({
        kind: 'cosmetic',
        name: `$${r.foreground}`,
        message: `Contrast of $${r.foreground} on $${r.background} in ${where} rose from ${r.ratio}:1 to ${next.ratio}:1, now meeting the ${contrastMinimum}:1 minimum.`,
      })
    }
  }

  out.push(...scaleCrossings(before, after))

  const themeKey = (t: { attribute: string; name: string }) => `${t.attribute}=${t.name}`
  const beforeThemes = new Set(before.themes.map(themeKey))
  const afterThemes = new Set(after.themes.map(themeKey))
  for (const t of beforeThemes) {
    if (!afterThemes.has(t)) {
      out.push({
        kind: 'breaking',
        subject: 'theme',
        name: t,
        message: `The theme ${q(t)} was removed.`,
      })
    }
  }
  for (const t of afterThemes) {
    if (!beforeThemes.has(t)) {
      out.push({
        kind: 'additive',
        subject: 'theme',
        name: t,
        message: `The theme ${q(t)} was added.`,
      })
    }
  }
}

const ORDER: Record<ChangeKind, number> = { breaking: 0, additive: 1, cosmetic: 2 }

/** Compare two snapshots of a design system. */
export function diffSnapshots(
  before: Snapshot,
  after: Snapshot,
  options: DiffOptions = {},
): Change[] {
  const out: Change[] = []
  const was = new Map(before.components.map((c) => [c.name, c]))
  const now = new Map(after.components.map((c) => [c.name, c]))
  const renamedTo = new Map<string, ManifestComponent>()
  for (const c of after.components)
    if (c.renamedFrom && !now.has(c.renamedFrom)) renamedTo.set(c.renamedFrom, c)

  for (const [name, old] of was) {
    const current = now.get(name)
    if (current) {
      diffComponent(old, current, out)
      continue
    }
    const renamed = renamedTo.get(name)
    if (renamed) {
      out.push({
        kind: 'breaking',
        subject: 'component',
        name,
        message: `${name} was renamed to ${renamed.name}.`,
        codemod: true,
      })
      // What else changed is measured against the old component under its new name.
      diffComponent({ ...old, name: renamed.name }, renamed, out)
    } else {
      out.push({ kind: 'breaking', subject: 'component', name, message: `${name} was removed.` })
    }
  }
  const renamedNames = new Set([...renamedTo.values()].map((c) => c.name))
  for (const [name, current] of now) {
    if (!was.has(name) && !renamedNames.has(name)) {
      out.push({
        kind: 'additive',
        subject: 'component',
        name,
        message: `${name} was added${current.description ? `: ${current.description}` : '.'}`,
      })
    }
  }

  if (before.tokens && after.tokens) {
    diffTokens(before.tokens, after.tokens, options.contrastMinimum ?? 4.5, out)
  } else if (before.tokens && !after.tokens) {
    out.push({
      kind: 'breaking',
      subject: 'token',
      name: 'tokens',
      message: 'The design tokens were removed.',
    })
  } else if (!before.tokens && after.tokens) {
    out.push({
      kind: 'additive',
      subject: 'token',
      name: 'tokens',
      message: 'Design tokens were added.',
    })
  }

  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name))
}

export interface ChangelogOptions {
  /** Heading for the section, such as `1.3.0`. Default `Unreleased`. */
  version?: string
  /** `YYYY-MM-DD`, shown beside the version. */
  date?: string
}

/** A changelog section, in Markdown, from a diff. */
export function renderChangelog(changes: Change[], options: ChangelogOptions = {}): string {
  const heading = `## ${options.version ?? 'Unreleased'}${options.date ? ` (${options.date})` : ''}`
  const lines = [heading, '']
  const section = (title: string, items: Change[]) => {
    if (!items.length) return
    lines.push(
      `### ${title}`,
      '',
      ...items.map((c) => `- ${c.message}${c.codemod ? ' (`tessera codemod` updates it)' : ''}`),
      '',
    )
  }
  section(
    'Breaking changes',
    changes.filter((c) => c.kind === 'breaking'),
  )
  section(
    'Added',
    changes.filter((c) => c.kind === 'additive' && !c.deprecation),
  )
  section(
    'Deprecated',
    changes.filter((c) => c.deprecation),
  )
  section(
    'Changed',
    changes.filter((c) => c.kind === 'cosmetic'),
  )
  if (changes.length === 0) lines.push('No changes to the design system.', '')
  return lines.join('\n').trimEnd() + '\n'
}

export function summarize(changes: Change[]): {
  breaking: number
  additive: number
  cosmetic: number
} {
  return {
    breaking: changes.filter((c) => c.kind === 'breaking').length,
    additive: changes.filter((c) => c.kind === 'additive').length,
    cosmetic: changes.filter((c) => c.kind === 'cosmetic').length,
  }
}
