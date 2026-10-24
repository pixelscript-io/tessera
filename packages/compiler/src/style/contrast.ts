import type { Contract } from '@tessera/contract'
import { contrastRatio } from '@tessera/tokens'
import { selectorClasses, type CssDecl, type CssNode } from './css'
import type { StyleIssue } from './enforce'
import type { StyleTokens } from './tokens'
import { tokenizeValue } from './value'

interface Slot {
  path: string
  offset: number
}

interface Entry {
  subject: string
  /** The simple selectors after the subject class: `[data-tone="danger"]`, `:hover`. Empty for the base rule. */
  parts: string[]
  /** `null`: set to something that is not a token (a keyword, `raw()`), so what is behind it is unknown. */
  fg?: Slot | null
  bg?: Slot | null
  /** Source order, to break ties between rules of the same specificity. */
  order: number
}

export interface ContrastInput {
  /** Plain CSS: tokens are `var(--name)`; this says which custom property is which token. */
  resolveVar?: (name: string) => string | undefined
  /** Name tokens as `var(--t-space-4)`, the way plain CSS writes them, not `$space.4`. */
  showVar?: boolean
  nodes: CssNode[]
  tokens: StyleTokens
  contract?: Contract
  /** Required ratio, such as 4.5 for WCAG AA. */
  minimum: number
  /** Where the style block starts, for problems that belong to the block as a whole. */
  styleStart: number
}

/** Inactive controls are exempt from WCAG contrast requirements. */
const EXEMPT = /disabled|readonly|inert/

/** Split a selector list on commas that are not inside parentheses or brackets. */
function splitList(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      parts.push(selector.slice(from, i))
      from = i + 1
    }
  }
  parts.push(selector.slice(from))
  return parts.map((s) => s.trim()).filter(Boolean)
}

/** The last compound selector: everything after the final combinator outside brackets. */
function lastCompound(selector: string): string {
  let depth = 0
  let from = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]!
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) from = i + 1
  }
  return selector.slice(from).trim()
}

const SIMPLE = /\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?|\.[\w-]+/g
const simpleSelectors = (qualifier: string) =>
  [...qualifier.matchAll(SIMPLE)].map((m) => m[0].replace(/\s+/g, ''))

function slotOf(
  decl: CssDecl,
  resolveVar?: (name: string) => string | undefined,
): Slot | undefined {
  const atoms = tokenizeValue(decl.value, decl.valueStart, resolveVar ? { resolveVar } : {})
  const only = atoms.length === 1 ? atoms[0] : undefined
  return only?.kind === 'token' ? { path: only.path, offset: decl.valueStart } : undefined
}

function collect(
  nodes: CssNode[],
  parent: { subject?: string; parts: string[] } | undefined,
  out: Entry[],
  resolveVar?: (name: string) => string | undefined,
): void {
  for (const node of nodes) {
    if (node.type === 'rule') {
      for (const selector of splitList(node.selector)) {
        const compound = lastCompound(selector)
        let subject: string | undefined
        let parts: string[] = []
        if (compound.includes('&')) {
          subject = parent?.subject
          parts = [...(parent?.parts ?? []), ...simpleSelectors(compound.replaceAll('&', ''))]
        } else {
          const classes = selectorClasses(compound, 0)
          const last = classes[classes.length - 1]
          if (last) {
            subject = last.name
            parts = simpleSelectors(
              compound.slice(0, last.start - 1) + compound.slice(last.start + last.name.length),
            )
          }
        }
        if (subject !== undefined) {
          const entry: Entry = { subject, parts, order: out.length }
          for (const child of node.children) {
            if (child.type !== 'decl') continue
            const prop = child.prop.toLowerCase()
            if (prop === 'color') entry.fg = slotOf(child, resolveVar) ?? null
            else if (prop === 'background' || prop === 'background-color') {
              entry.bg = slotOf(child, resolveVar) ?? null
            }
          }
          out.push(entry)
        }
        collect(
          node.children.filter((c) => c.type !== 'decl'),
          { subject, parts },
          out,
          resolveVar,
        )
      }
    } else if (node.type === 'at' && node.children) {
      collect(node.children, parent, out, resolveVar)
    }
  }
}

const scopeLabel = (scope: string) => {
  if (scope === 'base') return 'the default theme'
  const [attribute, name] = scope.split('=')
  return `${attribute} "${name}"`
}

const fmt = (ratio: number) => (Math.floor(ratio * 10) / 10).toFixed(1)

/** Every set of simple selectors that can apply at once: one value per attribute, at most one pseudo-class. */
function combinations(alphabet: string[]): string[][] {
  const attributes = new Map<string, string[]>()
  const pseudos: string[] = []
  for (const part of alphabet) {
    if (part.startsWith('[')) {
      const name = /^\[([^~|^$*=\]]+)/.exec(part)?.[1] ?? part
      attributes.set(name, [...(attributes.get(name) ?? []), part])
    } else pseudos.push(part)
  }
  let combos: string[][] = [[]]
  for (const values of attributes.values()) {
    combos = combos.flatMap((c) => [c, ...values.map((v) => [...c, v])])
  }
  return combos
    .flatMap((c) => [c, ...pseudos.map((p) => [...c, p])])
    .sort((a, b) => a.length - b.length)
}

/**
 * Check text contrast wherever a part ends up with both a `color` token and a `background` token. The
 * rules of a part are layered the way the cascade layers them: for every combination of variant values and
 * one state that the stylesheet mentions, the rules that apply are merged by specificity (the number of
 * attribute and pseudo selectors, then source order). Each distinct pair is checked in every theme, and a
 * failure names the first combination that shows it. Disabled and read-only states are exempt, as in WCAG.
 * Pairs the contract declares across parts (`"contrast": [{ "foreground": "label", "background": "root" }]`)
 * are checked the same way. A pair the compiler cannot see (a color set by a script, a background inherited
 * from an ancestor the contract does not name) is not checked.
 */
export function checkContrast(input: ContrastInput): StyleIssue[] {
  const { tokens, minimum } = input
  const entries: Entry[] = []
  collect(input.nodes, undefined, entries, input.resolveVar)
  const issues: StyleIssue[] = []
  const show = (path: string) =>
    input.showVar ? `var(${tokens.get(path)?.cssVar ?? path})` : `$${path}`

  const evaluate = (fg: Slot, bg: Slot, where: string, offset: number, context?: string): void => {
    const failures: string[] = []
    const seen = new Set<string>()
    for (const scope of tokens.scopes) {
      const foreground = tokens.color(fg.path, scope)
      const background = tokens.color(bg.path, scope)
      if (!foreground || !background || background.alpha < 1) continue
      // A theme that does not change either color repeats an earlier result.
      const key = JSON.stringify([foreground, background])
      if (seen.has(key)) continue
      seen.add(key)
      const ratio = contrastRatio(foreground, background)
      if (ratio < minimum) failures.push(`${fmt(ratio)}:1 in ${scopeLabel(scope)}`)
    }
    if (!failures.length) return
    issues.push({
      code: 'T2107',
      severity: 'error',
      offset,
      message: `Contrast between "${show(fg.path)}" and "${show(bg.path)}" is too low: ${failures.join(', ')} (needs ${minimum}:1).`,
      hint: `${context ? `${context}. ` : ''}Set in "${where}". Pick tokens that are at least ${minimum}:1 apart in every theme.`,
    })
  }

  /** What a part looks like when `active` simple selectors apply. */
  const effective = (subject: string, active: string[]): { fg?: Slot; bg?: Slot } => {
    const on = new Set(active)
    const applicable = entries
      .filter((e) => e.subject === subject && e.parts.every((p) => on.has(p)))
      .sort((a, b) => a.parts.length - b.parts.length || a.order - b.order)
    let fg: Slot | null | undefined
    let bg: Slot | null | undefined
    for (const e of applicable) {
      if (e.fg !== undefined) fg = e.fg
      if (e.bg !== undefined) bg = e.bg
    }
    return { fg: fg ?? undefined, bg: bg ?? undefined }
  }

  const reported = new Set<string>()
  for (const subject of new Set(entries.map((e) => e.subject))) {
    const alphabet = [
      ...new Set(
        entries
          .filter((e) => e.subject === subject)
          .flatMap((e) => e.parts)
          .filter((p) => !EXEMPT.test(p)),
      ),
    ]
    for (const combo of combinations(alphabet)) {
      const { fg, bg } = effective(subject, combo)
      if (!fg || !bg) continue
      const key = `${subject}|${fg.path}|${bg.path}`
      if (reported.has(key)) continue
      reported.add(key)
      evaluate(fg, bg, `.${subject}${combo.join('')}`, (fg.offset > bg.offset ? fg : bg).offset)
    }
  }

  // Pairings the contract declares across parts.
  for (const pair of input.contract?.contrast ?? []) {
    const fg = effective(pair.foreground, []).fg
    const bg = effective(pair.background, []).bg
    if (!fg || !bg) {
      const missing = !fg
        ? `.${pair.foreground} sets no color token`
        : `.${pair.background} sets no background token`
      issues.push({
        code: 'T2109',
        severity: 'warning',
        offset: input.styleStart,
        message: `The contract pairs "${pair.foreground}" text with a "${pair.background}" background, but ${missing}, so the pairing cannot be checked.`,
        hint: 'Set the missing token in <style>, or remove the pairing from the contract.',
      })
      continue
    }
    evaluate(
      fg,
      bg,
      `.${pair.foreground} on .${pair.background}`,
      fg.offset,
      `The contract pairs "${pair.foreground}" with "${pair.background}"`,
    )
  }
  return issues.sort((a, b) => a.offset - b.offset)
}
