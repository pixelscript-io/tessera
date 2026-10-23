import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { lineTable } from '@tessera/contract'
import type { Baseline } from '@tessera/compiler'
import type { Project } from '@tessera/compiler/project'
import type { Args } from '../args'
import { has } from '../args'
import type { Io } from '../io'
import { openProject } from '../project'

interface DirectoryStats {
  declarations: number
  tokenized: number
  raw: number
  /** Share of declarations that use a token; null when there are none. */
  ratio: number | null
}

export interface Report {
  today: string
  styles: DirectoryStats & { byDirectory: Record<string, DirectoryStats> }
  rawEscapes: Array<{
    file: string
    line: number
    value: string
    reason: string
    expires?: string
    expired: boolean
  }>
  exemptions: Array<{
    files: string[]
    rules: string[]
    level: string
    reason?: string
    expires?: string
    expired: boolean
  }>
  baseline: { violations: number; files: number; byRule: Record<string, number> }
  contracts: {
    components: number
    withContract: number
    withoutContract: string[]
    coverage: number | null
  }
  a11y: {
    /** Components that sit in a folder with generated accessibility suites. This does not say whether they pass. */
    generated: string[]
    notGenerated: string[]
  }
  deprecated: Array<{
    component: string
    message: string
    usages: Array<{ file: string; count: number }>
  }>
  /** Variant values the contracts deprecate, and who still sets them. */
  deprecatedValues: Array<{
    component: string
    variant: string
    value: string
    message: string
    usages: Array<{ file: string; count: number }>
  }>
  /** Tokens marked deprecated, and the styles that still use them. */
  deprecatedTokens: Array<{
    token: string
    message: string
    usages: Array<{ file: string; count: number }>
  }>
  /** Renames the design system declares that this project has not applied yet: `tessera codemod` updates them. */
  pendingRenames: Array<{
    kind: 'component' | 'value' | 'token'
    from: string
    to: string
    usages: Array<{ file: string; count: number }>
  }>
}

const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A static use of a variant value: `<Card tone="loud"`. */
const valueUse = (component: string, variant: string, value: string) =>
  new RegExp(String.raw`<${component}(?=[\s/>])[^>]*\s${variant}=(["'])${escapeRe(value)}\1`, 'g')

/** A use of a token in a style: `$space.4`, but not `$space.40`. */
const tokenUse = (path: string) => new RegExp(String.raw`\$${escapeRe(path)}(?![\w.-])`, 'g')

function usagesOf(
  sources: Map<string, string>,
  pattern: RegExp,
  exceptFile?: string,
): Array<{ file: string; count: number }> {
  return [...sources]
    .filter(([file]) => file !== exceptFile)
    .map(([file, source]) => ({ file, count: source.match(pattern)?.length ?? 0 }))
    .filter((u) => u.count > 0)
}

const stats = (declarations: number, tokenized: number, raw: number): DirectoryStats => ({
  declarations,
  tokenized,
  raw,
  ratio: ratio(tokenized, declarations),
})

/** Every `*.tokens.json` under a folder. */
function tokenJsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? tokenJsonFiles(join(dir, e.name))
        : e.name.endsWith('.tokens.json')
          ? [join(dir, e.name)]
          : [],
    )
  } catch {
    return []
  }
}

/** Collect `deprecated` and `renamedFrom` from the `$extensions.tessera` of every token in a document. */
function collectLifecycle(
  node: unknown,
  segments: string[],
  out: {
    deprecated: Array<{ path: string; message: string }>
    renamed: Array<{ from: string; to: string }>
  },
): void {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return
  const doc = node as Record<string, unknown>
  if ('$value' in doc) {
    const own = (
      doc.$extensions as { tessera?: { deprecated?: unknown; renamedFrom?: unknown } } | undefined
    )?.tessera
    const path = segments.join('.')
    if (typeof own?.deprecated === 'string') out.deprecated.push({ path, message: own.deprecated })
    if (typeof own?.renamedFrom === 'string') out.renamed.push({ from: own.renamedFrom, to: path })
    return
  }
  for (const [key, child] of Object.entries(doc)) {
    if (!key.startsWith('$') || key === '$root') collectLifecycle(child, [...segments, key], out)
  }
}

/** Does a folder hold a test file that generates accessibility suites for the components beside it? */
function hasA11ySuites(dir: string): boolean {
  if (!existsSync(dir)) return false
  return readdirSync(dir).some(
    (name) =>
      /\.test\.ts$/.test(name) && /@tessera\/a11y/.test(readFileSync(join(dir, name), 'utf8')),
  )
}

/** Measure what styles actually contain, not what is imported: that is what `tessera report` is for. */
export function buildReport(project: Project): Report {
  const today = project.today
  const config = project.config
  const byDir = new Map<string, { declarations: number; tokenized: number; raw: number }>()
  const rawEscapes: Report['rawEscapes'] = []
  const components: Array<{
    name: string
    file: string
    dir: string
    hasContract: boolean
    deprecated?: string
    deprecatedValues?: Record<string, Record<string, string>>
    renamedValues?: Record<string, Record<string, string>>
    renamedFrom?: string
  }> = []
  const sources = new Map<string, string>()

  for (const path of project.files()) {
    const source = readFileSync(path, 'utf8')
    const checked = project.compileFile(path, source, { baseline: null })
    sources.set(checked.file, source)
    const style = checked.result.style
    if (style) {
      const dir = dirname(checked.file)
      const entry = byDir.get(dir) ?? { declarations: 0, tokenized: 0, raw: 0 }
      entry.declarations += style.declarations
      entry.tokenized += style.tokenized
      entry.raw += style.rawValues
      byDir.set(dir, entry)
      const position = lineTable(source)
      for (const e of style.escapes) {
        rawEscapes.push({
          file: checked.file,
          line: position(e.offset).line,
          value: e.value,
          reason: e.reason,
          ...(e.expires ? { expires: e.expires } : {}),
          expired: !!e.expires && e.expires < today,
        })
      }
    }
    if (checked.kind === 'component') {
      const name = checked.file
        .split('/')
        .pop()!
        .replace(/\.tess$/, '')
      const contract = checked.result.contract
      components.push({
        name: contract?.name ?? name,
        file: checked.file,
        dir: dirname(path),
        hasContract: !!contract,
        ...(contract?.deprecated !== undefined ? { deprecated: contract.deprecated } : {}),
        ...(contract?.deprecatedValues ? { deprecatedValues: contract.deprecatedValues } : {}),
        ...(contract?.renamedValues ? { renamedValues: contract.renamedValues } : {}),
        ...(contract?.renamedFrom ? { renamedFrom: contract.renamedFrom } : {}),
      })
    }
  }

  const total = [...byDir.values()].reduce(
    (t, d) => ({
      declarations: t.declarations + d.declarations,
      tokenized: t.tokenized + d.tokenized,
      raw: t.raw + d.raw,
    }),
    { declarations: 0, tokenized: 0, raw: 0 },
  )

  const baseline = project.baseline() ?? ({ version: 1, files: {} } as Baseline)
  const byRule: Record<string, number> = {}
  for (const codes of Object.values(baseline.files)) {
    for (const [code, n] of Object.entries(codes)) byRule[code] = (byRule[code] ?? 0) + n
  }

  // Token lifecycle, read from the token files so it works while the tokens do not build (a rename leaves aliases behind).
  const tokenLifecycle = {
    deprecated: [] as Array<{ path: string; message: string }>,
    renamed: [] as Array<{ from: string; to: string }>,
  }
  const dir = project.tokensDir()
  if (dir) {
    for (const file of tokenJsonFiles(dir)) {
      try {
        collectLifecycle(JSON.parse(readFileSync(file, 'utf8')), [], tokenLifecycle)
      } catch {
        // A file that is not JSON is the tokens build's to report.
      }
    }
  }

  const withContract = components.filter((c) => c.hasContract)
  const suites = new Map<string, boolean>()
  const covered = (dir: string) => {
    if (!suites.has(dir)) suites.set(dir, hasA11ySuites(dir))
    return suites.get(dir)!
  }

  return {
    today,
    styles: {
      ...stats(total.declarations, total.tokenized, total.raw),
      byDirectory: Object.fromEntries(
        [...byDir.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([dir, d]) => [dir, stats(d.declarations, d.tokenized, d.raw)]),
      ),
    },
    rawEscapes,
    exemptions: (config.severity ?? []).map((rule) => ({
      files: [rule.files].flat(),
      rules: [rule.rules].flat(),
      level: rule.level,
      ...(rule.reason ? { reason: rule.reason } : {}),
      ...(rule.expires ? { expires: rule.expires } : {}),
      expired: !!rule.expires && rule.expires < today,
    })),
    baseline: {
      violations: Object.values(byRule).reduce((a, b) => a + b, 0),
      files: Object.keys(baseline.files).length,
      byRule,
    },
    contracts: {
      components: components.length,
      withContract: withContract.length,
      withoutContract: components.filter((c) => !c.hasContract).map((c) => c.file),
      coverage: ratio(withContract.length, components.length),
    },
    a11y: {
      generated: withContract.filter((c) => covered(c.dir)).map((c) => c.name),
      notGenerated: withContract.filter((c) => !covered(c.dir)).map((c) => c.name),
    },
    deprecated: components
      .filter((c) => c.deprecated !== undefined)
      .map((c) => {
        const tag = new RegExp(String.raw`<${c.name}(?=[\s/>])`, 'g')
        return { component: c.name, message: c.deprecated!, usages: usagesOf(sources, tag, c.file) }
      }),
    deprecatedValues: components.flatMap((c) =>
      Object.entries(c.deprecatedValues ?? {}).flatMap(([variant, values]) =>
        Object.entries(values).map(([value, message]) => ({
          component: c.name,
          variant,
          value,
          message,
          usages: usagesOf(sources, valueUse(c.name, variant, value), c.file),
        })),
      ),
    ),
    deprecatedTokens: tokenLifecycle.deprecated.map((t) => ({
      token: t.path,
      message: t.message,
      usages: usagesOf(sources, tokenUse(t.path)),
    })),
    pendingRenames: [
      ...components
        .filter((c) => c.renamedFrom)
        .map((c) => ({
          kind: 'component' as const,
          from: c.renamedFrom!,
          to: c.name,
          usages: usagesOf(sources, new RegExp(String.raw`<${c.renamedFrom}(?=[\s/>])`, 'g')),
        })),
      ...components.flatMap((c) =>
        Object.entries(c.renamedValues ?? {}).flatMap(([variant, values]) =>
          Object.keys(values).map((from) => ({
            kind: 'value' as const,
            from: `${c.name}.${variant}="${from}"`,
            to: `${c.name}.${variant}="${values[from]}"`,
            usages: usagesOf(sources, valueUse(c.name, variant, from)),
          })),
        ),
      ),
      ...tokenLifecycle.renamed.map((t) => ({
        kind: 'token' as const,
        from: t.from,
        to: t.to,
        usages: usagesOf(sources, tokenUse(t.from)),
      })),
    ].filter((r) => r.usages.length > 0),
  }
}

const percent = (r: number | null) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`)

/** The report as text, for a person. */
export function formatReport(r: Report): string {
  const lines: string[] = ['Tessera report', '']
  lines.push('Styles (what declarations contain, not what is imported)')
  lines.push(
    `  ${r.styles.declarations} declarations: ${r.styles.tokenized} use a token (${percent(r.styles.ratio)}), ${r.styles.raw} write a value by hand`,
  )
  for (const [dir, d] of Object.entries(r.styles.byDirectory)) {
    lines.push(
      `  ${dir.padEnd(28)} ${String(d.tokenized).padStart(4)}/${d.declarations} tokenized (${percent(d.ratio)}), ${d.raw} by hand`,
    )
  }

  lines.push('', `raw() escapes: ${r.rawEscapes.length}`)
  for (const e of r.rawEscapes) {
    lines.push(
      `  ${e.file}:${e.line}  ${e.value}  "${e.reason}"${e.expires ? `  expires ${e.expires}${e.expired ? ' (EXPIRED)' : ''}` : ''}`,
    )
  }

  lines.push('', `Severity exemptions: ${r.exemptions.length}`)
  for (const e of r.exemptions) {
    lines.push(
      `  ${e.files.join(', ')}  ${e.rules.join(', ')}  ${e.level}  "${e.reason ?? ''}"${e.expires ? `  expires ${e.expires}${e.expired ? ' (EXPIRED)' : ''}` : ''}`,
    )
  }

  lines.push(
    '',
    `Baseline debt: ${r.baseline.violations} ${r.baseline.violations === 1 ? 'violation' : 'violations'} in ${r.baseline.files} files`,
  )
  for (const [code, n] of Object.entries(r.baseline.byRule)) lines.push(`  ${code}  ${n}`)

  lines.push(
    '',
    `Contract coverage: ${r.contracts.withContract}/${r.contracts.components} components (${percent(r.contracts.coverage)})`,
  )
  for (const file of r.contracts.withoutContract) lines.push(`  no contract: ${file}`)

  lines.push(
    '',
    `Generated accessibility suites: ${r.a11y.generated.length} of ${r.a11y.generated.length + r.a11y.notGenerated.length} contracted components (present, not run: run your tests for pass or fail)`,
  )
  for (const name of r.a11y.notGenerated) lines.push(`  none: ${name}`)

  lines.push('', `Deprecated components in use: ${r.deprecated.length}`)
  for (const d of r.deprecated) {
    lines.push(`  ${d.component}: ${d.message}`)
    for (const u of d.usages) lines.push(`    ${u.file} (${u.count})`)
  }
  lines.push('', `Deprecated variant values: ${r.deprecatedValues.length}`)
  for (const d of r.deprecatedValues) {
    lines.push(`  ${d.component}.${d.variant} "${d.value}": ${d.message || 'deprecated'}`)
    if (!d.usages.length) lines.push('    no remaining uses')
    for (const u of d.usages) lines.push(`    ${u.file} (${u.count})`)
  }
  lines.push('', `Deprecated tokens: ${r.deprecatedTokens.length}`)
  for (const d of r.deprecatedTokens) {
    lines.push(`  $${d.token}: ${d.message || 'deprecated'}`)
    if (!d.usages.length) lines.push('    no remaining uses')
    for (const u of d.usages) lines.push(`    ${u.file} (${u.count})`)
  }
  if (r.pendingRenames.length) {
    lines.push(
      '',
      `Renames not applied yet: ${r.pendingRenames.length} (run tessera codemod --write)`,
    )
    for (const p of r.pendingRenames) {
      lines.push(`  ${p.from} -> ${p.to}`)
      for (const u of p.usages) lines.push(`    ${u.file} (${u.count})`)
    }
  }
  return lines.join('\n') + '\n'
}

/** `tessera report`: a summary for people, and `--json` for CI. */
export async function report(args: Args, io: Io): Promise<number> {
  const project = await openProject(io.cwd, args)
  const result = buildReport(project)
  io.out(has(args, 'json') ? JSON.stringify(result, null, 2) : formatReport(result))
  return 0
}
