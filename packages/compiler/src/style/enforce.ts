import type { Contract } from '@tessera/contract'
import { nearest } from '@tessera/contract'
import { NAMED_COLORS, colorDistance, parseCssColor, toHex } from '@tessera/tokens'
import type { Accept, ResolvedConfig } from '../config'
import { parseCss, selectorClasses, type CssDecl, type CssNode, type CssRule } from './css'
import { matches, numericValue, type StyleToken, type StyleTokens } from './tokens'
import { tokenizeValue, type Atom } from './value'

/** A fix a tool can apply to the file without changing what it renders in the default theme. */
export interface Fix {
  start: number
  end: number
  text: string
}

export interface StyleIssue {
  code: string
  severity: 'error' | 'warning'
  /** Offset in the file. */
  offset: number
  message: string
  hint?: string
  fix?: Fix
}

/** One use of `raw()`, for the report. */
export interface RawEscape {
  offset: number
  value: string
  reason: string
  expires?: string
}

export interface StyleStats {
  /** Every declaration in the block. */
  declarations: number
  /** Declarations that use at least one token. */
  tokenized: number
  /** Declarations that write a design value (length, color, duration, number) by hand or through `raw()`. */
  rawValues: number
  escapes: RawEscape[]
}

export interface StyleInput {
  /** Contents of the `<style>` block. */
  css: string
  /** Where those contents start in the file. */
  base: number
  /** Omit to skip the checks that need tokens (existence, type, nearest value, contrast). */
  tokens?: StyleTokens
  config: ResolvedConfig
  contract?: Contract
  /** Prepended to every class name, such as `t-Button__`. */
  prefix: string
  /** ISO date, for `raw()` expiry. */
  today: string
}

export interface StyleResult {
  /** The CSS to ship: scoped, with token references as `var()` and `raw()` unwrapped, in `@layer tessera.components`. */
  css: string
  issues: StyleIssue[]
  stats: StyleStats
  nodes: CssNode[]
}

const KIND_TYPE = { length: 'dimension', duration: 'duration', number: 'number' } as const

/** Properties that take a color but are not in the governed map, so a named color there is still caught. */
const COLOR_BEARING = new Set([
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'outline',
  'text-decoration',
  'column-rule',
  'text-shadow',
  'filter',
  'background-image',
])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** Colors closer than this in OKLab are the same 8-bit color. */
const EXACT_COLOR = 0.0015
const q = (s: string) => JSON.stringify(s)
const dollar = (path: string) => '$' + path

const describe = (accepts: Accept[]) =>
  accepts
    .map(
      (a) => `${a.type} tokens${a.groups?.length ? ` from ${a.groups.map(q).join(' or ')}` : ''}`,
    )
    .join(' or ')

export function processStyle(input: StyleInput): StyleResult {
  const { css, base, tokens, config, contract, prefix, today } = input
  const issues: StyleIssue[] = []
  const edits: Fix[] = []
  const stats: StyleStats = { declarations: 0, tokenized: 0, rawValues: 0, escapes: [] }

  const parsed = parseCss(css, base)
  for (const error of parsed.errors) {
    issues.push({
      code: 'T2106',
      severity: 'error',
      offset: error.offset,
      message: `Invalid style: ${error.message}`,
    })
  }

  const issue = (
    code: string,
    severity: StyleIssue['severity'],
    offset: number,
    message: string,
    hint?: string,
    fix?: Fix,
  ) =>
    issues.push({
      code,
      severity,
      offset,
      message,
      ...(hint ? { hint } : {}),
      ...(fix ? { fix } : {}),
    })

  const cssVarOf = (path: string) =>
    tokens?.get(path)?.cssVar ??
    `--t-${path
      .split('.')
      .filter((s) => s !== '$root')
      .join('-')}`

  /** The base-theme value of a token as a number in px or ms. */
  const numeric = (t: StyleToken) =>
    t.resolved.base === undefined ? undefined : numericValue(t.resolved.base)

  function checkToken(
    atom: Extract<Atom, { kind: 'token' }>,
    prop: string,
    accepts: Accept[] | undefined,
  ): void {
    if (!tokens) return
    const token = tokens.get(atom.path)
    if (!token) {
      const close = nearest(atom.path, tokens.paths())
      const ranked = tokens
        .paths()
        .map((p) => ({ p, d: levenshtein(atom.path, p) }))
        .sort((x, y) => x.d - y.d)
      // A fix only when one token is clearly the typo's target: within two edits and strictly closer than the rest.
      const first = ranked[0]
      const renamed = tokens.renamedTo(atom.path)
      // A rename is the codemod's job: the new token may not have the old one's value, so it is not an autofix.
      const target =
        !renamed && first && first.d <= 2 && (ranked[1] === undefined || ranked[1].d > first.d)
          ? first.p
          : undefined
      issue(
        'T2104',
        'error',
        atom.start,
        `Unknown token "${dollar(atom.path)}"`,
        renamed
          ? `"${dollar(atom.path)}" was renamed to "${dollar(renamed)}".`
          : close
            ? `Did you mean "${dollar(close)}"?`
            : undefined,
        target ? { start: atom.start, end: atom.end, text: dollar(target) } : undefined,
      )
      return
    }
    if (token.deprecated !== undefined) {
      issue(
        'T2113',
        'warning',
        atom.start,
        `"${dollar(atom.path)}" is deprecated${token.deprecated ? `: ${token.deprecated}` : '.'}`,
      )
    }
    if (accepts && token.type !== 'unknown' && !accepts.some((a) => matches(token, a))) {
      issue(
        'T2103',
        'error',
        atom.start,
        `"${prop}" takes ${describe(accepts)}, but "${dollar(atom.path)}" is a ${token.type} token.`,
      )
    }
    if (token.tier === 'primitive' && config.primitives !== 'off') {
      issue(
        'T2105',
        config.primitives === 'error' ? 'error' : 'warning',
        atom.start,
        `"${dollar(atom.path)}" is a primitive token. Components should use semantic or component tokens.`,
        'Reference a semantic token instead, or add one that aliases this primitive.',
      )
    }
  }

  function checkRaw(atom: Extract<Atom, { kind: 'raw' }>): void {
    const { args } = atom
    const usage = 'raw(13px, "why it is needed", "2027-03-01")'
    const [value, reason, expires] = args
    let ok = true
    const fail = (message: string) => {
      ok = false
      issue('T2108', 'error', atom.start, message)
    }
    const unquote = (text: string | undefined) => {
      const m = text === undefined ? null : /^(["'])([\s\S]*)\1$/.exec(text)
      return m ? m[2]! : undefined
    }

    if (!value || value.text === '') {
      fail(`raw() needs a value, a reason and optionally an expiry date, like ${usage}.`)
    } else if (
      args.length === 1 ||
      unquote(reason?.text) === undefined ||
      unquote(reason?.text)!.trim() === ''
    ) {
      fail(`raw(${value.text}) needs a reason, like raw(${value.text}, "why it is needed").`)
    } else if (args.length > 3) {
      fail(
        `raw() takes a value, a reason and an optional expiry date, but got ${args.length} arguments.`,
      )
    } else if (
      expires &&
      (unquote(expires.text) === undefined ||
        !ISO_DATE.test(unquote(expires.text)!) ||
        Number.isNaN(Date.parse(unquote(expires.text)!)))
    ) {
      fail(`The expiry in raw() must be a quoted date like "2027-03-01", got ${expires.text}.`)
    }

    if (value) edits.push({ start: atom.start, end: atom.end, text: value.text })
    if (!ok || !value) return

    const why = unquote(reason!.text)!
    const until = expires ? unquote(expires.text) : undefined
    stats.escapes.push({
      offset: atom.start,
      value: value.text,
      reason: why,
      ...(until ? { expires: until } : {}),
    })
    if (until && today > until) {
      issue(
        'T2110',
        'error',
        atom.start,
        `This raw(${value.text}) expired on ${until}: "${why}".`,
        `Replace ${value.text} with a token, or extend the date with a new reason.`,
      )
    } else {
      issue(
        'T2111',
        'warning',
        atom.start,
        `raw(${value.text}) leaves the design system: "${why}".`,
        until
          ? `Expires ${until}.`
          : 'Add an expiry date as a third argument so it does not last forever.',
      )
    }
  }

  function checkNumeric(
    atom: Extract<Atom, { kind: 'length' | 'duration' | 'number' }>,
    prop: string,
    accepts: Accept[] | undefined,
  ): void {
    if (atom.value === 0) return
    const wanted = accepts?.filter((a) => a.type === KIND_TYPE[atom.kind])
    if (!wanted?.length) return
    const label = atom.kind
    const candidates = tokens ? tokens.accepted(wanted) : []
    let px: number | undefined
    if (atom.kind === 'number') px = atom.value
    else if (atom.unit === 'rem') px = atom.value * 16
    else if (atom.unit === 's') px = atom.value * 1000
    else if (atom.unit !== 'em') px = atom.value

    if (px !== undefined && candidates.length) {
      const scored = candidates
        .map((t) => ({ t, v: numeric(t) }))
        .filter((c): c is { t: StyleToken; v: number } => c.v !== undefined)
      const exact = scored.filter((c) => Math.abs(c.v - px) < 1e-9)
      if (exact.length) {
        const only = exact.length === 1 ? exact[0]! : undefined
        issue(
          'T2102',
          'error',
          atom.start,
          `Raw ${label} "${atom.text}" in "${prop}" is not a token.`,
          only
            ? `Use "${dollar(only.t.path)}".`
            : `Use one of: ${exact.map((c) => `"${dollar(c.t.path)}"`).join(', ')}.`,
          only ? { start: atom.start, end: atom.end, text: dollar(only.t.path) } : undefined,
        )
        return
      }
      const best = scored.sort((a, b) => Math.abs(a.v - px) - Math.abs(b.v - px))[0]
      if (best) {
        issue(
          'T2102',
          'error',
          atom.start,
          `Raw ${label} "${atom.text}" in "${prop}" is off the scale.`,
          `Did you mean "${dollar(best.t.path)}" (${best.t.resolved.base})? Or write raw(${atom.text}, "reason") to keep it.`,
        )
        return
      }
    }
    issue(
      'T2102',
      'error',
      atom.start,
      `Raw ${label} "${atom.text}" in "${prop}" is not a token.`,
      candidates.length
        ? `Use a token from ${
            wanted
              .flatMap((a) => a.groups ?? [])
              .map(q)
              .join(' or ') || 'the design system'
          }, or write raw(${atom.text}, "reason").`
        : `No matching tokens exist. Add one, or write raw(${atom.text}, "reason").`,
    )
  }

  function checkColor(
    text: string,
    start: number,
    end: number,
    prop: string,
    accepts: Accept[] | undefined,
  ): void {
    const color = parseCssColor(text)
    const colorAccepts = accepts?.filter((a) => a.type === 'color')
    let pool = tokens
      ? colorAccepts?.length
        ? tokens.accepted(colorAccepts)
        : tokens.all().filter((t) => t.type === 'color')
      : []
    // Components should use semantic tokens, so suggest those first.
    const semantic = pool.filter((t) => t.tier !== 'primitive')
    if (semantic.length) pool = semantic

    const message = `Raw color "${text}" in "${prop}" is not a token.`
    let hint = tokens ? `Add a color token, or write raw(${text}, "reason").` : undefined
    let fix: Fix | undefined
    if (color && pool.length) {
      const scored = pool
        .map((t) => ({ t, c: tokens!.color(t.path, 'base') }))
        .filter((s): s is { t: StyleToken; c: NonNullable<typeof s.c> } => s.c !== undefined)
        .map((s) => ({ t: s.t, c: s.c, d: colorDistance(color, s.c) }))
        .sort((a, b) => a.d - b.d)
      const best = scored[0]
      if (best) {
        const exact = scored.filter((s) => s.d < EXACT_COLOR)
        if (exact.length === 1) {
          hint = `Use "${dollar(best.t.path)}".`
          fix = { start, end, text: dollar(best.t.path) }
        } else if (exact.length > 1) {
          hint = `Use one of: ${exact.map((s) => `"${dollar(s.t.path)}"`).join(', ')}.`
        } else {
          hint = `The closest token is "${dollar(best.t.path)}" (${toHex(best.c)}). Or write raw(${text}, "reason") to keep it.`
        }
      }
    }
    issue('T2101', 'error', start, message, hint, fix)
  }

  function checkDecl(decl: CssDecl): void {
    const prop = decl.prop.toLowerCase()
    const accepts = config.governed[prop]
    const colorProp = accepts?.some((a) => a.type === 'color') || COLOR_BEARING.has(prop)
    const atoms = tokenizeValue(decl.value, decl.valueStart)
    stats.declarations++
    let hasToken = false
    let hasRawValue = false

    for (const atom of atoms) {
      switch (atom.kind) {
        case 'token':
          hasToken = true
          edits.push({ start: atom.start, end: atom.end, text: `var(${cssVarOf(atom.path)})` })
          checkToken(atom, prop, accepts)
          break
        case 'raw':
          hasRawValue = true
          checkRaw(atom)
          break
        case 'length':
        case 'duration':
        case 'number':
          if (atom.value !== 0) hasRawValue = true
          checkNumeric(atom, prop, accepts)
          break
        case 'color':
          hasRawValue = true
          checkColor(atom.text, atom.start, atom.end, prop, accepts)
          break
        case 'ident':
          if (colorProp && NAMED_COLORS[atom.text.toLowerCase()]) {
            hasRawValue = true
            checkColor(atom.text, atom.start, atom.end, prop, accepts)
          }
          break
      }
    }
    if (hasToken) stats.tokenized++
    if (hasRawValue) stats.rawValues++
  }

  function checkVariantSelectors(rule: CssRule): void {
    if (!contract) return
    const variants = new Map(
      Object.entries(contract.variants).map(([k, v]) => [k.toLowerCase(), { name: k, values: v }]),
    )
    for (const m of rule.selector.matchAll(
      /\[\s*data-([\w-]+)\s*=\s*(["']?)([^"'\]\s]+)\2\s*\]/g,
    )) {
      const variant = variants.get(m[1]!.toLowerCase())
      if (!variant || variant.values.includes(m[3]!)) continue
      const close = nearest(m[3]!, variant.values)
      issue(
        'T2114',
        'error',
        rule.selectorStart + m.index + m[0].lastIndexOf(m[3]!),
        `${contract.name}.${variant.name} has no value ${q(m[3]!)}.`,
        close
          ? `Did you mean ${q(close)}?`
          : `Allowed values: ${variant.values.map(q).join(', ')}.`,
      )
    }
  }

  function walk(nodes: CssNode[], inFontFace: boolean): void {
    for (const node of nodes) {
      if (node.type === 'decl') {
        if (!inFontFace) checkDecl(node)
      } else if (node.type === 'rule') {
        for (const c of selectorClasses(node.selector, node.selectorStart)) {
          edits.push({ start: c.start, end: c.start, text: prefix })
        }
        checkVariantSelectors(node)
        walk(node.children, inFontFace)
      } else if (node.children) {
        walk(node.children, inFontFace || node.name === 'font-face')
      }
    }
  }
  walk(parsed.nodes, false)

  // Apply the rewrites to the original text, last to first so offsets stay valid.
  let out = css
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    out = out.slice(0, edit.start - base) + edit.text + out.slice(edit.end - base)
  }
  const body = out.trim()
  return {
    css: body ? `@layer tessera.components {\n${out.replace(/^\n+|\s+$/g, '')}\n}\n` : '',
    issues,
    stats,
    nodes: parsed.nodes,
  }
}

function levenshtein(a: string, b: string): number {
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
