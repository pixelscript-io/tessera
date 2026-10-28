import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { applyBaseline, applySeverity, type Baseline, type BaselineResult } from './accountability'
import { apisOf, buildAgentManifest, stateOf, type AgentManifest } from './agent-manifest'
import { compile, kindFromPath, type CompileResult, type FileKind } from './compile'
import { componentProps } from './props'
import { activeSystemFolder, type TesseraConfig } from './config'
import type { CompilerDiagnostic } from './diagnostics'
import {
  findUp,
  systemTokensDir,
  loadComponentRegistry,
  loadDesignTokens,
  loadProjectApis,
  loadProjectRoutes,
  loadProjectState,
  resolveImportedComponents,
  scanComponentFiles,
  type DesignTokens,
  type ProjectApis,
  type ProjectComponents,
  type ProjectRoutes,
  type ProjectStates,
} from './node'

export interface ProjectOptions {
  /** Set to `optional` to let `app/components` skip contracts. */
  contracts?: 'required' | 'optional'
  config?: TesseraConfig
  /** Folder of `*.tokens.json` files. Defaults to the active system's `system/<name>/tokens` (see `defaultSystem`), or `system/tokens`. */
  tokens?: string
  /** Baseline file. Defaults to `tessera.baseline.json` in the project root, if it exists. */
  baseline?: string
  /** Today's date as `YYYY-MM-DD`, for expiry checks. Defaults to the current date. */
  today?: string
  /** Components that exist only in memory, such as the ones a documentation page defines. Absolute, forward-slash paths. */
  extraComponents?: Array<{ file: string; source: string }>
}

export interface ProjectFileResult {
  /** Path relative to the project root, forward slashes. */
  file: string
  kind: FileKind
  result: CompileResult
  /** Diagnostics before severity and the baseline: what the rules found. */
  raw: CompilerDiagnostic[]
  /** Diagnostics after per-path severity (but before the baseline), for writing a baseline. */
  adjusted: CompilerDiagnostic[]
  /** What is left to fix after severity and the baseline. */
  diagnostics: CompilerDiagnostic[]
  baseline: BaselineResult
  /** Component files read to check explicit imports, so hosts can watch them. */
  imports: string[]
}

/**
 * Everything the compiler needs to know about a project on disk (tokens, components, routes, config,
 * baseline), and one place that compiles a file with all of it. The Vite plugin and the CLI both use it, so
 * `tessera check` reports what a build would.
 */
export class Project {
  private tokenCache: DesignTokens | null | undefined
  private componentCache: ProjectComponents | undefined
  private routeCache: ProjectRoutes | undefined
  private apiCache: ProjectApis | undefined
  private stateCache: ProjectStates | undefined

  constructor(
    readonly root: string,
    readonly options: ProjectOptions = {},
  ) {}

  get today(): string {
    return this.options.today ?? new Date().toISOString().slice(0, 10)
  }

  get config(): TesseraConfig {
    return this.options.config ?? {}
  }

  tokensDir(): string | undefined {
    return this.options.tokens ?? systemTokensDir(this.root, activeSystemFolder(this.config))
  }

  /** Where the tokens are, or where they would go in a project that has none yet: the active system's folder. */
  tokensDirOrDefault(): string {
    const folder = activeSystemFolder(this.config)
    return (
      this.tokensDir() ??
      join(this.root, 'system', ...(folder ? [...folder.split('/'), 'tokens'] : ['tokens']))
    )
  }

  tokens(): DesignTokens | null {
    if (this.tokenCache === undefined) {
      const dir = this.tokensDir()
      this.tokenCache = dir ? loadDesignTokens(dir) : null
    }
    return this.tokenCache
  }

  components(): ProjectComponents {
    return (this.componentCache ??= loadComponentRegistry(this.root, {
      extraFiles: this.options.extraComponents,
    }))
  }

  routes(): ProjectRoutes {
    return (this.routeCache ??= loadProjectRoutes(this.root))
  }

  /** The apis of the project: the script files in `app/apis`, each named after its file. */
  apis(): ProjectApis {
    return (this.apiCache ??= loadProjectApis(this.root))
  }

  /** The shared state of the project: the script files in `app/state`, each named after its file. */
  state(): ProjectStates {
    return (this.stateCache ??= loadProjectState(
      this.root,
      this.apis().apis.map((a) => a.name),
    ))
  }

  /** Route patterns for checking `<Link to>`; undefined when the project has no pages folder. */
  routePatterns(): string[] | undefined {
    const routes = this.routes()
    return existsSync(routes.dir) ? routes.manifest.routes.map((r) => r.path) : undefined
  }

  /** Layout names for checking a page's `layout`; undefined when the project has no pages folder. */
  layoutNames(): string[] | undefined {
    const routes = this.routes()
    return existsSync(routes.dir) ? routes.layouts : undefined
  }

  /** The project's components, tokens, routes and rules as one JSON-able object, for tools that read it. */
  agentManifest(): AgentManifest {
    const tokens = this.tokens()
    const routes = this.routes()
    return buildAgentManifest({
      components: [...this.components().registry.entries.values()].map((e) => ({
        name: e.name,
        file: this.display(e.file),
        contract: e.contract,
        props: existsSync(e.file) ? componentProps(readFileSync(e.file, 'utf8')) : [],
      })),
      tokens: tokens?.ok ? tokens.manifest : undefined,
      routes: existsSync(routes.dir) ? routes.manifest : undefined,
      layouts: routes.layouts,
      config: this.options.config,
      apis: apisOf(this.apis().apis, (file) => this.display(file)),
      state: stateOf(this.state().states, (file) => this.display(file)),
    })
  }

  baselinePath(): string {
    return this.options.baseline ?? join(this.root, 'tessera.baseline.json')
  }

  baseline(): Baseline | undefined {
    const path = this.baselinePath()
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Baseline) : undefined
  }

  resetTokens(): void {
    this.tokenCache = undefined
  }

  resetComponents(): void {
    this.componentCache = undefined
  }

  resetRoutes(): void {
    this.routeCache = undefined
  }

  resetApis(): void {
    this.apiCache = undefined
    this.stateCache = undefined
  }

  resetState(): void {
    this.stateCache = undefined
  }

  resetAll(): void {
    this.resetTokens()
    this.resetComponents()
    this.resetRoutes()
    this.resetApis()
  }

  /** The path of a file relative to the project root, as diagnostics and the baseline name it. */
  display(path: string): string {
    return relative(this.root, path).replaceAll('\\', '/')
  }

  /**
   * Every `.tess` file the project owns: its system components (when they are in or above the root), then
   * `app/components`, `app/layouts` and `app/pages`. The router's components are left out: they are not the project's
   * to format, migrate or report on.
   */
  files(): string[] {
    const out: string[] = []
    const systemDir = findUp(this.root, join('system', 'components'))
    for (const dir of [
      systemDir,
      join(this.root, 'app', 'components'),
      join(this.root, 'app', 'layouts'),
      join(this.root, 'app', 'pages'),
    ]) {
      if (dir) out.push(...scanComponentFiles(dir).map((f) => f.file))
    }
    return [...new Set(out)]
  }

  /** Compile one file with the project's tokens, components, routes and config, then apply severity and the baseline. */
  compileFile(
    path: string,
    source: string,
    extra: { hmrId?: string; baseline?: Baseline | null } = {},
  ): ProjectFileResult {
    const normalized = path.replaceAll('\\', '/')
    const file = this.display(path)
    const { resolver, files } = resolveImportedComponents(path, source, this.root)
    const loaded = this.tokens()
    const kind = kindFromPath(path)
    const result = compile(source, {
      file,
      path: normalized,
      kind,
      contract: this.options.contracts,
      components: resolver,
      registry: this.components().registry,
      autoImports: this.options.config?.autoImports,
      routes: this.routePatterns(),
      layouts: this.layoutNames(),
      apis: this.apis().apis,
      state: this.state().states,
      tokens: loaded?.ok ? loaded.tokens : undefined,
      config: this.options.config,
      today: this.today,
      hmrId: extra.hmrId,
    })
    // Exemptions first, then the baseline: a path exempted by severity does not use up its baseline.
    const adjusted = applySeverity(file, result.diagnostics, this.config, this.today)
    const baseline = applyBaseline(
      file,
      adjusted,
      extra.baseline === null ? undefined : (extra.baseline ?? this.baseline()),
    )
    return {
      file,
      kind,
      result,
      raw: result.diagnostics,
      adjusted,
      diagnostics: baseline.diagnostics,
      baseline,
      imports: files,
    }
  }
}
