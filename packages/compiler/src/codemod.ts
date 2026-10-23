import type { ManifestComponent } from './agent-manifest'

/**
 * Renames a design system declares (`renamedFrom` on a component, `renamedValues` on a contract,
 * `$extensions.tessera.renamedFrom` on a token), and the text edits that bring a project's files up to date. It
 * is lexical on purpose: it reads the blocks of a `.tess` file it can find by name, edits only what a rename names,
 * and reports what it cannot be sure of instead of guessing.
 */
export interface Renames {
  components: Array<{ from: string; to: string }>
  /** Variant values: on the component `component` (its current name), `variant` had `from`, now `to`. */
  values: Array<{ component: string; variant: string; from: string; to: string }>
  /** Token paths, such as `space.medium` to `space.3`. */
  tokens: Array<{ from: string; to: string }>
}

export interface CodemodEdit {
  /** `component`, `value` or `token`. */
  kind: 'component' | 'value' | 'token'
  from: string
  to: string
  /** 1-based line in the file. */
  line: number
}

export interface CodemodResult {
  source: string
  edits: CodemodEdit[]
  /** Uses it could not rewrite safely: a computed value that mentions an old one. */
  manual: Array<{ line: number; message: string }>
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Collect the renames the project's components and tokens declare. */
export function collectRenames(
  components: ManifestComponent[],
  tokens: Array<{ path: string; extensions?: Record<string, unknown> }>,
): Renames {
  const out: Renames = { components: [], values: [], tokens: [] }
  for (const c of components) {
    if (c.renamedFrom && c.renamedFrom !== c.name)
      out.components.push({ from: c.renamedFrom, to: c.name })
    for (const [variant, map] of Object.entries(c.renamedValues ?? {})) {
      for (const [from, to] of Object.entries(map)) {
        out.values.push({ component: c.name, variant, from, to })
      }
    }
  }
  for (const t of tokens) {
    const from = (t.extensions?.tessera as { renamedFrom?: unknown } | undefined)?.renamedFrom
    if (typeof from === 'string' && from !== t.path) out.tokens.push({ from, to: t.path })
  }
  return out
}

export const hasRenames = (r: Renames): boolean =>
  r.components.length + r.values.length + r.tokens.length > 0

const lineOf = (source: string, offset: number) => source.slice(0, offset).split('\n').length

/** A block of a `.tess` file: the range of its content in the source. */
function blocks(source: string, tag: 'template' | 'script' | 'style' | 'contract') {
  const out: Array<{ start: number; end: number }> = []
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g')
  for (let m = open.exec(source); m; m = open.exec(source)) {
    const start = m.index + m[0].length
    const end = source.indexOf(`</${tag}>`, start)
    if (end >= 0) out.push({ start, end })
  }
  return out
}

/** Replace inside the given ranges only, recording every change. */
function replaceIn(
  source: string,
  ranges: Array<{ start: number; end: number }>,
  pattern: RegExp,
  replacement: (m: RegExpExecArray) => string | undefined,
  record: (offset: number, from: string, to: string) => void,
  describe?: (m: RegExpExecArray, next: string) => [string, string] | undefined,
): string {
  let out = ''
  let cursor = 0
  for (const { start, end } of ranges) {
    out += source.slice(cursor, start)
    const text = source.slice(start, end)
    let last = 0
    let piece = ''
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      const next = replacement(m)
      if (next === undefined || next === m[0]) continue
      piece += text.slice(last, m.index) + next
      last = m.index + m[0].length
      const shown = describe ? describe(m, next) : ([m[0], next] as [string, string])
      if (shown) record(start + m.index, shown[0], shown[1])
    }
    out += piece + text.slice(last)
    cursor = end
  }
  return out + source.slice(cursor)
}

/**
 * Apply renames to a `.tess` file. Components are renamed in the template (`<Old>`, `</Old>`) and in explicit
 * imports; variant values in the static attributes of the component's tags and in the selectors of its own style;
 * tokens in `$old.path` references in styles.
 */
export function applyToTess(source: string, renames: Renames): CodemodResult {
  const edits: CodemodEdit[] = []
  const manual: CodemodResult['manual'] = []
  let text = source

  // Renames never add or remove lines, so a line number in the text as it stands is the line in the file.
  const rerun = (
    tag: 'template' | 'script' | 'style',
    pattern: RegExp,
    replacement: (m: RegExpExecArray) => string | undefined,
    kind: CodemodEdit['kind'],
    describe?: (m: RegExpExecArray, next: string) => [string, string] | undefined,
  ) => {
    text = replaceIn(
      text,
      blocks(text, tag),
      pattern,
      replacement,
      (offset, from, to) => {
        edits.push({ kind, from, to, line: lineOf(text, offset) })
      },
      describe,
    )
  }

  for (const { from, to } of renames.components) {
    rerun(
      'template',
      new RegExp(`<(/?)${from}(?=[\\s/>])`, 'g'),
      (m) => `<${m[1]}${to}`,
      'component',
      // A closing tag follows its opening tag and is not a second use.
      (m) => (m[1] === '' ? [`<${from}>`, `<${to}>`] : undefined),
    )
    rerun(
      'script',
      new RegExp(`import\\s+${from}\\s+from\\s+(["'])([^"']*?)${from}\\.tess\\1`, 'g'),
      (m) => `import ${to} from ${m[1]}${m[2]}${to}.tess${m[1]}`,
      'component',
      () => [`import ${from}`, `import ${to}`],
    )
  }

  // Variant values on a component's own tags. Component names here are the current ones: renamed above.
  for (const r of renames.values) {
    rerun(
      'template',
      new RegExp(`<${r.component}(?=[\\s/>])[^>]*>`, 'g'),
      (m) => {
        const re = new RegExp(`(\\s${r.variant}=)(["'])${escapeRe(r.from)}\\2`)
        return re.test(m[0]) ? m[0].replace(re, `$1$2${r.to}$2`) : undefined
      },
      'value',
      () => [`${r.component}.${r.variant}="${r.from}"`, `${r.component}.${r.variant}="${r.to}"`],
    )
    // A computed value that still mentions the old one cannot be rewritten without knowing the expression.
    for (const { start, end } of blocks(text, 'template')) {
      const body = text.slice(start, end)
      const dynamic = new RegExp(
        `<${r.component}(?=[\\s/>])[^>]*\\s:${r.variant}=["'][^"']*['"]${escapeRe(r.from)}['"][^>]*>`,
        'g',
      )
      for (let m = dynamic.exec(body); m; m = dynamic.exec(body)) {
        manual.push({
          line: lineOf(text, start + m.index),
          message: `<${r.component} :${r.variant}> computes a value that mentions "${r.from}", which was renamed to "${r.to}". Update it by hand.`,
        })
      }
    }
  }

  // In a component's own style: [data-variant="old"] selectors of the component this file defines.
  const own = /<contract>[\s\S]*?"name"\s*:\s*"([A-Za-z0-9]+)"/.exec(text)?.[1]
  for (const r of renames.values.filter((v) => v.component === own)) {
    rerun(
      'style',
      new RegExp(`(\\[data-${r.variant}=)(["']?)${escapeRe(r.from)}\\2(\\])`, 'g'),
      (m) => `${m[1]}${m[2]}${r.to}${m[2]}${m[3]}`,
      'value',
      () => [`[data-${r.variant}=${r.from}]`, `[data-${r.variant}=${r.to}]`],
    )
  }

  for (const { from, to } of renames.tokens) {
    rerun('style', new RegExp(`\\$${escapeRe(from)}(?![\\w.-])`, 'g'), () => `$${to}`, 'token')
  }

  return { source: text, edits, manual }
}

/** Apply token renames to a `*.tokens.json` file: `{old.path}` aliases. The token's own definition is the author's. */
export function applyToTokens(source: string, renames: Renames): CodemodResult {
  const edits: CodemodEdit[] = []
  let text = source
  for (const { from, to } of renames.tokens) {
    const re = new RegExp(`\\{${escapeRe(from)}\\}`, 'g')
    let out = ''
    let last = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      out += text.slice(last, m.index) + `{${to}}`
      last = m.index + m[0].length
      edits.push({ kind: 'token', from, to, line: lineOf(text, m.index) })
    }
    text = out + text.slice(last)
  }
  return { source: text, edits, manual: [] }
}
