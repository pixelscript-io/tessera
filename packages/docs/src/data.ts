import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { activeSystemFolder, type AgentManifest } from '@tessera/compiler'
import { Project } from '@tessera/compiler/project'
import {
  contrastPairs,
  exportTokens,
  type ContrastRow,
  type InterchangeFile,
  type InterchangeFormat,
} from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import { renderMarkdown } from './markdown'

/** Everything the docs app shows, as plain JSON. The app reads this at runtime; nothing here is hand-written. */
export interface DocsData {
  project: { name: string }
  manifest: AgentManifest
  components: DocsComponent[]
  tokens: DocsTokens
  /** `tessera report` as it would print with `--json`, when the host provides it. */
  report?: unknown
  hasTokens: boolean
  /** The tokens as files a design tool reads, by format. Present when the project has tokens. */
  exports?: Partial<Record<InterchangeFormat, InterchangeFile[]>>
  /** Whether the system manager (write mode) is on. Set by the plugin, not by the builder. */
  edit?: boolean
  /** The design systems of a project that has more than one, so the page can switch between them. */
  systems?: DocsSystem[]
  /** The name of the system `tokens` and `manifest` describe: the one the app builds with. */
  activeSystem?: string
}

/** What changes when the components are shown with another design system's tokens. */
export interface DocsSystem {
  name: string
  /** The style sheet of the system's tokens, with its themes. */
  css: string
  tokens: DocsTokens
  /** The themes and densities the system defines, which the switchers offer. */
  themes: AgentManifest['tokens']['themes']
  hasTokens: boolean
  /** For each component, the tokens its styles use that this system does not define. Components that are fine are left out. */
  missing: Record<string, string[]>
}

export interface DocsComponent {
  name: string
  /** Where the component is defined, relative to the project. */
  file: string
  /** `system` (the design system), `app` (this project) or `router` (ships with Tessera). */
  origin: 'system' | 'app' | 'router'
  /** The source of the component, shown in full on its page. */
  source: string
  /** Tokens the component's styles use, as written in a style (`$space.4`). */
  usedTokens: string[]
  /** How many `$token` references its styles contain, whether or not the project has such tokens. */
  tokenRefs: number
  /** `raw()` escapes in the component's styles. */
  rawEscapes: number
  /** Whether a generated accessibility suite covers it. Undefined when the host gave no report. */
  a11yGenerated?: boolean
  /** Prose from `Name.docs.md`, if the file exists. */
  prose?: { html: string; file: string; live: Array<{ source: string; module: string }> }
}

export interface DocsTokens {
  /** The scopes values are given in: `base`, then `theme=dark` and so on. */
  scopes: string[]
  /** Every token with its value in every scope after aliases are followed, and the alias it came from. */
  entries: Array<{
    path: string
    type: string
    tier: string
    description?: string
    values: Record<string, { resolved: string; alias?: string }>
  }>
  contrast: ContrastRow[]
}

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g
const TOKEN_REF = /\$([A-Za-z][\w-]*(?:\.[\w-]+)+)/g

function styleOf(source: string): string {
  return [...source.matchAll(STYLE_BLOCK)].map((m) => m[1]).join('\n')
}

export interface BuildOptions {
  /** `tessera report` output, if the host can make it. */
  report?: unknown
  /** Where a `tess live` block's generated page can be imported from, by index: `(component, n) => '/…/Name-0.tess'`. */
  liveModule(component: string, index: number): string
}

export function buildDocsData(project: Project, options: BuildOptions): DocsData {
  const manifest = project.agentManifest()
  const tokens = project.tokens()
  const tokenManifest = tokens?.ok ? tokens.manifest : undefined
  const known = new Set(tokenManifest?.tokens.map((t) => t.path))
  const report = options.report as { a11y?: { generated?: string[] } } | undefined
  const generated = report?.a11y?.generated

  const entries = new Map(
    [...project.components().registry.entries.values()].map((e) => [e.name, e]),
  )
  const components: DocsComponent[] = manifest.components.map((m) => {
    const entry = entries.get(m.name)!
    const source = existsSync(entry.file) ? readFileSync(entry.file, 'utf8') : ''
    const style = styleOf(source)
    const used = [...new Set([...style.matchAll(TOKEN_REF)].map((x) => x[1]!))].filter((p) =>
      known.has(p),
    )
    const normalized = entry.file.replaceAll('\\', '/')
    const origin = /\/system\/components\//.test(normalized)
      ? 'system'
      : /\/app\/components\//.test(normalized)
        ? 'app'
        : 'router'
    const docsFile = join(dirname(entry.file), `${basename(entry.file, '.tess')}.docs.md`)
    let prose: DocsComponent['prose']
    if (existsSync(docsFile)) {
      const rendered = renderMarkdown(readFileSync(docsFile, 'utf8'))
      prose = {
        html: rendered.html,
        file: project.display(docsFile),
        live: rendered.live.map((b, i) => ({
          source: b.source,
          module: options.liveModule(m.name, i),
        })),
      }
    }
    return {
      name: m.name,
      file: m.file,
      origin,
      source,
      usedTokens: used,
      tokenRefs: [...style.matchAll(TOKEN_REF)].length,
      rawEscapes: (style.match(/\braw\(/g) ?? []).length,
      ...(generated ? { a11yGenerated: generated.includes(m.name) } : {}),
      ...(prose ? { prose } : {}),
    }
  })

  let name = 'Design system'
  try {
    const pkg = JSON.parse(readFileSync(join(project.root, 'package.json'), 'utf8')) as {
      name?: string
    }
    if (pkg.name) name = pkg.name
  } catch {
    // No package.json: keep the generic name.
  }

  return {
    project: { name },
    manifest,
    components,
    tokens: tokensOf(tokenManifest, manifest.rules.contrastMinimum),
    ...(options.report !== undefined ? { report: options.report } : {}),
    hasTokens: !!tokenManifest && tokenManifest.tokens.length > 0,
    ...exportsOf(project, tokenManifest !== undefined),
    ...systemsOf(project, components, manifest.rules.contrastMinimum),
  }
}

type TokenManifest = NonNullable<ReturnType<Project['tokens']> & { ok: true }>['manifest']

function tokensOf(tokenManifest: TokenManifest | undefined, contrastMinimum: number): DocsTokens {
  return {
    scopes: ['base', ...(tokenManifest?.themes.map((t) => `${t.attribute}=${t.name}`) ?? [])],
    entries: (tokenManifest?.tokens ?? []).map((t) => ({
      path: t.path,
      type: t.type,
      tier: t.tier,
      ...(t.description ? { description: t.description } : {}),
      values: Object.fromEntries(
        Object.entries(t.values).map(([scope, v]) => [
          scope,
          { resolved: v.resolved, ...(v.alias ? { alias: v.alias } : {}) },
        ]),
      ),
    })),
    contrast: contrastPairs(tokenManifest, contrastMinimum),
  }
}

/**
 * Each design system's tokens and style sheet, for a project that lists two or more. A system is read by opening
 * the project again with that system as the default; nothing else about it differs.
 */
function systemsOf(
  project: Project,
  components: DocsComponent[],
  contrastMinimum: number,
): Pick<DocsData, 'systems' | 'activeSystem'> {
  const listed = project.config.systems ?? []
  if (listed.length < 2 || project.options.tokens) return {}
  const systems = listed.map((system): DocsSystem => {
    const other = new Project(project.root, {
      ...project.options,
      config: { ...project.config, defaultSystem: system.name },
    })
    const loaded = other.tokens()
    const tokenManifest = loaded?.ok ? loaded.manifest : undefined
    const known = new Set(tokenManifest?.tokens.map((t) => t.path))
    const missing: Record<string, string[]> = {}
    for (const c of components) {
      const used = [...new Set([...styleOf(c.source).matchAll(TOKEN_REF)].map((x) => x[1]!))]
      const lacking = used.filter((p) => !known.has(p))
      if (lacking.length) missing[c.name] = lacking
    }
    return {
      name: system.name,
      css: loaded?.ok ? loaded.css : '',
      tokens: tokensOf(tokenManifest, contrastMinimum),
      themes: tokenManifest?.themes ?? [],
      hasTokens: !!tokenManifest && tokenManifest.tokens.length > 0,
      missing,
    }
  })
  const folder = activeSystemFolder(project.config)
  const active = listed.find((s) => activeSystemFolder({ systems: [s] }) === folder)
  return { systems, activeSystem: (active ?? listed[0]!).name }
}

/** The tokens exported in both formats, so the docs can offer them (in the static site too). */
function exportsOf(project: Project, built: boolean): Pick<DocsData, 'exports'> {
  const dir = project.tokensDir()
  if (!built || !dir) return {}
  try {
    const input = loadTokenDir(dir)
    const out: NonNullable<DocsData['exports']> = {}
    for (const format of ['dtcg', 'tokens-studio'] as const) {
      const result = exportTokens(input, format)
      if (result.files.length) out[format] = result.files
    }
    return Object.keys(out).length ? { exports: out } : {}
  } catch {
    return {}
  }
}
