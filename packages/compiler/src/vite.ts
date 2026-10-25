import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { transformWithEsbuild, type Plugin } from 'vite'
import { formatDiagnostic } from '@tessera/contract'
import { formatDiagnostic as formatTokenDiagnostic } from '@tessera/tokens'
import { checkPlainScriptAutoImports } from './autoimport-ts'
import { loadConfigFile } from './config-file'
import { Project } from './project'
import { validateConfig, type TesseraConfig } from './config'
import { generateComponentsDts } from './dts'
import { generateRoutesDts, generateRoutesModule, routeDiagnostics } from './routes'
import { type DesignTokens, type ProjectComponents, type ProjectRoutes } from './node'

export interface TesseraOptions {
  /** Set to `optional` to let `app/components` skip contracts. */
  contracts?: 'required' | 'optional'
  /** Style rules, exemptions and `autoImports`. A `tessera.config.ts` loader arrives with the CLI. */
  config?: TesseraConfig
  /** Folder of `*.tokens.json` files. Defaults to the nearest `system/tokens` above the project root. */
  tokens?: string
  /** Baseline file. Defaults to `tessera.baseline.json` in the project root, if it exists. */
  baseline?: string
  /** Today's date as `YYYY-MM-DD`, for expiry checks. Defaults to the current date. */
  today?: string
}

const TOKENS_ID = 'virtual:tessera/tokens.css'
const RESOLVED_TOKENS_ID = '\0virtual:tessera/tokens.css'
const ROUTES_ID = 'virtual:tessera/routes'
const RESOLVED_ROUTES_ID = '\0virtual:tessera/routes'
/**
 * The one global rule Tessera adds: the page itself has no margin, and takes the surface and text colors when the
 * design system has them. In the `reset` layer, so any other rule overrides it.
 */
const PAGE_RESET = `
@layer tessera.reset {
  body {
    margin: 0;
    background: var(--t-color-surface-default, transparent);
    color: var(--t-color-text-default, inherit);
  }
}
`

const STYLE_QUERY = 'tess&type=style&lang.css'

/** Every `*.tokens.json` under a folder, so Vite rebuilds the token CSS when one changes. */
function tokenFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tokenFiles(path))
    else if (entry.name.endsWith('.tokens.json')) out.push(path)
  }
  return out
}

/** What a registry looks like to its users: names, files and contracts. If this is unchanged, nothing needs recompiling. */
function signature(components: ProjectComponents): string {
  return JSON.stringify([
    [...components.registry.entries.values()].map((e) => [e.name, e.file, e.contract]),
    components.registry.diagnostics,
  ])
}

/** The Vite plugin: compiles `.tess` files to modules, with styles, design tokens, auto-imports and hot updates. */
export function tessera(options: TesseraOptions = {}): Plugin {
  let root = process.cwd()
  let serving = false
  let project = new Project(root, options)
  /** CSS from each component's last compile, served to its `?tess&type=style` import. */
  const styles = new Map<string, string>()

  const tokensDir = () => project.tokensDir()
  const loadTokens = (): DesignTokens | null => project.tokens()
  const loadComponents = (): ProjectComponents => project.components()

  /** Write `.tessera/components.d.ts`, only when it changed, so editors and watchers are not disturbed. */
  const writeComponentTypes = () => {
    const path = join(root, '.tessera', 'components.d.ts')
    const text = generateComponentsDts(loadComponents().registry)
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }

  /** Write `.tessera/manifest.json`, the project's components, tokens, routes and rules, only when it changed. */
  const writeManifest = () => {
    const path = join(root, '.tessera', 'manifest.json')
    const text = JSON.stringify(project.agentManifest(), null, 2) + String.fromCharCode(10)
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }

  const loadRoutes = (): ProjectRoutes => project.routes()
  const apiErrors = (): string => project.apis().diagnostics.map(formatDiagnostic).join('\n\n')

  const pagesDisplay = () => relative(root, loadRoutes().dir).replaceAll('\\', '/')

  const routeErrors = (): string =>
    routeDiagnostics(loadRoutes().manifest, pagesDisplay()).map(formatDiagnostic).join('\n\n')

  /** Write `.tessera/routes.d.ts`, only when it changed and only for a project that has pages. */
  const writeRouteTypes = () => {
    if (!existsSync(loadRoutes().dir)) return
    const path = join(root, '.tessera', 'routes.d.ts')
    const text = generateRoutesDts(loadRoutes().manifest)
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }

  return {
    name: 'tessera',
    enforce: 'pre',

    config() {
      // The published package is served as it is, not pre-bundled: its router entry imports the virtual routes
      // module, which only this plugin can resolve, and pre-bundling would give each entry its own copy of the
      // runtime instead of one shared one.
      return { optimizeDeps: { exclude: ['@pixelscriptio/tessera'] } }
    },

    async configResolved(config) {
      root = config.root
      serving = config.command === 'serve'
      // Options passed to the plugin win over tessera.config.ts.
      const fromFile = options.config ? undefined : await loadConfigFile(root)
      project = new Project(root, { ...fromFile?.options, ...options })
      const issues = validateConfig(project.config)
      if (issues.length) {
        throw new Error(
          issues.map((i) => `ERROR  ${i.code}  tessera config\n  ${i.message}`).join('\n\n'),
        )
      }
    },

    buildStart() {
      project.resetComponents()
      project.resetRoutes()
      project.resetApis()
      writeComponentTypes()
      writeRouteTypes()
      writeManifest()
      // A build fails on a route conflict even if nothing imports the routes; the dev server shows it on load.
      if (!serving && routeErrors()) this.error(routeErrors())
      if (!serving && apiErrors()) this.error(apiErrors())
    },

    configureServer(server) {
      const dir = tokensDir()
      if (dir) server.watcher.add(dir)
      const componentDirs = loadComponents().dirs
      server.watcher.add(componentDirs)
      // A component folder that does not exist yet still needs watching, so its first file is seen.
      server.watcher.add(join(root, 'app', 'components'))
      server.watcher.add(loadRoutes().dir)
      server.watcher.add(loadRoutes().layoutsDir)
      // The apis folder may not exist yet; its first file still needs to be seen.
      server.watcher.add(project.apis().dir)

      const inPages = (file: string) =>
        file.endsWith('.tess') &&
        [loadRoutes().dir, loadRoutes().layoutsDir].some((d) =>
          file.replaceAll('\\', '/').startsWith(`${d.replaceAll('\\', '/')}/`),
        )

      /** A page was added or removed: new routes, a new route list for link checks, and a fresh `routes.d.ts`. */
      const refreshRoutes = () => {
        const snapshot = () => JSON.stringify([loadRoutes().manifest, loadRoutes().layouts])
        const before = snapshot()
        project.resetRoutes()
        if (snapshot() === before) return
        writeRouteTypes()
        writeManifest()
        const virtual = server.moduleGraph.getModuleById(RESOLVED_ROUTES_ID)
        if (virtual) server.moduleGraph.invalidateModule(virtual)
        for (const module of server.moduleGraph.idToModuleMap.values()) {
          if (module.file?.endsWith('.tess') && !module.id?.includes('type=style'))
            server.moduleGraph.invalidateModule(module)
        }
        server.ws.send({ type: 'full-reload' })
      }

      const inComponents = (file: string) =>
        file.endsWith('.tess') &&
        [...componentDirs, join(root, 'app', 'components')].some((d) =>
          file.replaceAll('\\', '/').startsWith(`${d.replaceAll('\\', '/')}/`),
        )

      /** Rebuild the registry; if what components exist or promise changed, recompile everything that might use them. */
      const refreshComponents = () => {
        const before = signature(loadComponents())
        project.resetComponents()
        const after = signature(loadComponents())
        if (before === after) return
        writeComponentTypes()
        writeManifest()
        for (const module of server.moduleGraph.idToModuleMap.values()) {
          if (module.file?.endsWith('.tess') && !module.id?.includes('type=style')) {
            // Drop the cached compile first: the next request must see the new registry, hot updates or not.
            server.moduleGraph.invalidateModule(module)
            void server.reloadModule(module)
          }
        }
      }

      const inApis = (file: string) =>
        /\.(?:ts|js|mts|mjs)$/.test(file) &&
        file.replaceAll('\\', '/').startsWith(`${project.apis().dir}/`)

      /** An api was added or removed: scripts that name it, or no longer can, must compile again. */
      const refreshApis = () => {
        const names = () => JSON.stringify(project.apis().apis.map((a) => a.name))
        const before = names()
        project.resetApis()
        if (names() === before) return
        for (const module of server.moduleGraph.idToModuleMap.values()) {
          if (module.file?.endsWith('.tess') && !module.id?.includes('type=style')) {
            server.moduleGraph.invalidateModule(module)
            void server.reloadModule(module)
          }
        }
      }

      server.watcher.on('add', (file) => {
        if (inComponents(file)) refreshComponents()
        if (inPages(file)) refreshRoutes()
        if (inApis(file)) refreshApis()
      })
      server.watcher.on('unlink', (file) => {
        if (inComponents(file)) refreshComponents()
        if (inPages(file)) refreshRoutes()
        if (inApis(file)) refreshApis()
      })
      server.watcher.on('change', (file) => {
        if (file.endsWith('.tokens.json')) {
          project.resetTokens()
          writeManifest()
          const module = server.moduleGraph.getModuleById(RESOLVED_TOKENS_ID)
          if (module) void server.reloadModule(module)
        } else if (inComponents(file)) refreshComponents()
      })
    },

    resolveId(id) {
      if (id === ROUTES_ID) return RESOLVED_ROUTES_ID
      return id === TOKENS_ID ? RESOLVED_TOKENS_ID : null
    },

    load(id) {
      if (id === RESOLVED_TOKENS_ID) {
        const loaded = loadTokens()
        if (!loaded)
          this.error('No design tokens found. Put *.tokens.json files in a "system/tokens" folder.')
        if (!loaded.ok) this.error(loaded.diagnostics.map(formatTokenDiagnostic).join('\n\n'))
        for (const file of tokenFiles(loaded.dir)) this.addWatchFile(file)
        return loaded.css + PAGE_RESET
      }
      if (id === RESOLVED_ROUTES_ID) {
        const current = loadRoutes()
        const errors = routeErrors()
        if (errors) this.error(errors)
        // Adding a page changes the list; the dev server's watcher does that, a build reads it once.
        return generateRoutesModule(
          current.manifest,
          `/${pagesDisplay()}`,
          current.layouts,
          `/${relative(root, current.layoutsDir).replaceAll('\\', '/')}`,
        )
      }
      const [path, query] = id.split('?')
      if (path?.endsWith('.tess') && query === STYLE_QUERY) return styles.get(path) ?? ''
      return null
    },

    async transform(code, rawId) {
      const id = rawId.split('?')[0]!
      const normalized = id.replaceAll('\\', '/')

      // Auto-imports only exist inside .tess files. In a plain .ts file of the project, say what to import.
      if (
        rawId === id &&
        /\.ts$/.test(id) &&
        !id.endsWith('.d.ts') &&
        !normalized.includes('/node_modules/') &&
        normalized.startsWith(`${root.replaceAll('\\', '/')}/`)
      ) {
        const file = relative(root, id).replaceAll('\\', '/')
        const problems = checkPlainScriptAutoImports(code, file)
        if (problems.length) {
          this.error({
            message: problems.map(formatDiagnostic).join('\n\n'),
            id,
            loc: { file: id, line: problems[0]!.line, column: problems[0]!.column },
          })
        }
        return null
      }

      if (!id.endsWith('.tess')) return null
      // `?raw`, `?url` and `?inline` imports want the file as text, not a compiled component.
      if (/[?&](raw|url|inline)(&|$)/.test(rawId)) return null
      // The style request carries CSS, which `load` already produced.
      if (rawId.endsWith(`?${STYLE_QUERY}`)) return null

      const file = project.display(id)
      const checked = project.compileFile(id, code, { hmrId: serving ? file : undefined })
      // Components named by explicit imports are watched, so a contract edit recompiles their users.
      for (const target of checked.imports) this.addWatchFile(target)
      const { result, diagnostics } = checked

      for (const d of diagnostics) {
        if (d.severity === 'warning') {
          this.warn({
            message: formatDiagnostic(d),
            id,
            loc: { file: id, line: d.line, column: d.column },
          })
        }
      }
      const errors = diagnostics.filter((d) => d.severity === 'error')
      if (errors.length) {
        const first = errors[0]!
        this.error({
          message: errors.map(formatDiagnostic).join('\n\n'),
          id,
          loc: { file: id, line: first.line, column: first.column },
        })
      }
      // A file that did not compile has no code to run, whatever the exemptions and baseline say.
      if (!result.code) {
        this.error({
          message: `${file} did not compile. Exemptions and the baseline cover style rules, not the errors that stop code generation.`,
          id,
        })
      }

      let output = result.code
      if (result.css) {
        styles.set(id, result.css)
        output = `import ${JSON.stringify(`./${basename(id)}?${STYLE_QUERY}`)}\n${output}`
      } else {
        styles.delete(id)
      }
      const out = await transformWithEsbuild(output, `${id}.ts`, { target: 'esnext' })
      return { code: out.code, map: null }
    },
  }
}
