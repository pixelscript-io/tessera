import { resolveConfig, type TesseraConfig } from './config'
import { Reporter, type CompilerDiagnostic } from './diagnostics'
import { checkContrast } from './style/contrast'
import { processStyle } from './style/enforce'
import type { StyleTokens } from './style/tokens'

/** The style rules, for any project: they read plain CSS, with design tokens as custom properties. */

/** What a file is, as far as style checking goes. Undefined for a file with no styles to check. */
export function lintKind(file: string): 'css' | 'markup' | 'unsupported' | undefined {
  if (/\.(css|pcss|postcss)$/i.test(file)) return 'css'
  if (/\.(vue|svelte|astro|html?)$/i.test(file)) return 'markup'
  // Languages that compile to CSS, with syntax the checks do not read (variables, nesting that is not CSS's own).
  if (/\.(scss|sass|less|styl|stylus)$/i.test(file)) return 'unsupported'
  return undefined
}

/** A piece of a file that is CSS: the whole of a `.css` file, or the inside of a `<style>` element. */
export interface StyleBlock {
  content: string
  /** Where the content starts in the file. */
  start: number
}

/**
 * The CSS in a file. A `<style>` that says it is another language (`lang="scss"`) is not CSS and is counted in
 * `skipped`, not read.
 */
export function styleBlocks(
  file: string,
  source: string,
): { blocks: StyleBlock[]; skipped: number } {
  const kind = lintKind(file)
  if (kind === 'css') return { blocks: [{ content: source, start: 0 }], skipped: 0 }
  if (kind !== 'markup') return { blocks: [], skipped: kind === 'unsupported' ? 1 : 0 }
  const blocks: StyleBlock[] = []
  let skipped = 0
  for (const match of source.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)) {
    const lang = /\blang\s*=\s*["']?([\w-]+)/i.exec(match[1]!)?.[1]?.toLowerCase()
    if (lang && !['css', 'postcss', 'pcss'].includes(lang)) {
      skipped++
      continue
    }
    blocks.push({ content: match[2]!, start: match.index! + match[0].indexOf('>') + 1 })
  }
  return { blocks, skipped }
}

export interface LintOptions {
  /** The design tokens, as the style checks read them. */
  tokens: StyleTokens
  config?: TesseraConfig
  /** ISO date, for exemptions that expire. */
  today?: string
  /**
   * The prefix of the custom properties that are tokens, such as `--ds-`. The tokens keep the names the token build gave
   * them (`--t-`) unless this says otherwise; a `var()` that starts with it and names no token is a typo.
   */
  varPrefix?: string
}

export interface LintResult {
  /** What the rules found, before per-path severity and the baseline. */
  diagnostics: CompilerDiagnostic[]
  /** `<style>` elements in another language, which were not read. */
  skipped: number
  stats: { declarations: number; tokenized: number }
}

/**
 * Check the styles in one file: raw values off the token scale, colors that are not tokens, `var()` names that are not
 * tokens, tokens of the wrong kind for a property, primitives used directly, deprecated tokens, and text and
 * background token pairs that fail contrast in a theme. It is the rules `tessera check` applies to a `.tess` file,
 * on plain CSS.
 */
export function lintSource(file: string, source: string, options: LintOptions): LintResult {
  const config = resolveConfig(options.config)
  const prefix = options.varPrefix ?? '--t-'
  const tokens = options.varPrefix ? options.tokens.withVarPrefix(prefix) : options.tokens
  const { blocks, skipped } = styleBlocks(file, source)
  const report = new Reporter(file, source)
  const stats = { declarations: 0, tokenized: 0 }
  const resolveVar = (name: string): string | undefined =>
    tokens.byCssVar(name)?.path ??
    (name.startsWith(prefix) ? name.slice(prefix.length).replaceAll('-', '.') : undefined)

  for (const block of blocks) {
    const processed = processStyle({
      css: block.content,
      base: block.start,
      tokens,
      config,
      prefix: '',
      today: options.today ?? new Date().toISOString().slice(0, 10),
      syntax: 'css',
      varPrefix: prefix,
    })
    const contrast = checkContrast({
      nodes: processed.nodes,
      tokens,
      minimum: config.contrast.minimum,
      styleStart: block.start,
      resolveVar,
      showVar: true,
    })
    for (const issue of [...processed.issues, ...contrast])
      report.add(issue.code, issue.severity, issue.offset, issue.message, issue.hint, issue.fix)
    stats.declarations += processed.stats.declarations
    stats.tokenized += processed.stats.tokenized
  }
  return { diagnostics: report.diagnostics, skipped, stats }
}
