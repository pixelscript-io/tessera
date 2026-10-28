import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfigFile, Project } from '@tessera/compiler/project'
import type { InlineConfig, Plugin, ViteDevServer } from 'vite'
import type { Args } from '../args'
import { flag, has } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import { prerender } from '../prerender'
import { themeOverrideNotes } from '../theme-notes'
import { findProjectRoot, openProject } from '../project'
import { buildReport } from './report'

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts']

const shell = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/app/main.ts"></script>
  </body>
</html>
`

/** The page's title before a page sets its own: the project's package name. */
function projectTitle(root: string): string {
  try {
    const name = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string })
      .name
    return name ?? 'Tessera app'
  } catch {
    return 'Tessera app'
  }
}

/**
 * The HTML page for a project that has no `index.html` of its own. It exists only to Vite: the dev server answers
 * page requests with it, and a build treats it as the entry, so a project needs no file for it. Put an
 * `index.html` in the project root and that is used instead.
 */
function htmlShell(root: string): Plugin {
  const file = resolve(root, 'index.html').replaceAll('\\', '/')
  const html = shell(projectTitle(root))
  return {
    name: 'tessera:html-shell',
    enforce: 'pre',
    config: () => ({ build: { rollupOptions: { input: file } } }),
    resolveId: (id) => (id.replaceAll('\\', '/') === file ? file : undefined),
    load: (id) => (id.replaceAll('\\', '/') === file ? html : undefined),
    configureServer(server) {
      // Before Vite's own middleware, which looks for the file on disk.
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '/'
        const wantsPage =
          (req.method === 'GET' || req.method === 'HEAD') &&
          !/\.[a-z0-9]+(\?|$)/i.test(url) &&
          !url.startsWith('/@') &&
          !url.startsWith('/__')
        if (!wantsPage || !(req.headers.accept ?? '').includes('text/html')) return next()
        try {
          res.setHeader('Content-Type', 'text/html')
          res.end(await server.transformIndexHtml(url, html))
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

/**
 * Vite's config for a project with none of its own: the Tessera plugin and the HTML shell. A project with a
 * `vite.config.ts` uses it as it is (it registers the plugin itself), and only gets the shell if it has no
 * `index.html`.
 */
export async function projectConfig(root: string, args: Args): Promise<InlineConfig> {
  // Loaded here, not at the top: every other command starts without Vite.
  const { tessera } = await import('@tessera/compiler/vite')
  const own = VITE_CONFIGS.some((name) => existsSync(join(root, name)))
  const hasHtml = existsSync(join(root, 'index.html'))
  const port = flag(args, 'port')
  // `tessera dev --mock`: the plugin answers every API that has a description. A project with its own Vite config reads
  // the same switch from the environment.
  const mock = has(args, 'mock')
  if (mock) process.env.TESSERA_MOCK = '1'
  return {
    root,
    ...(own ? {} : { configFile: false as const }),
    plugins: [
      ...(own ? [] : [tessera(mock ? { mock } : {})]),
      ...(hasHtml ? [] : [htmlShell(root)]),
    ],
    ...(typeof port === 'string'
      ? { server: { port: Number(port) }, preview: { port: Number(port) } }
      : {}),
  }
}

/**
 * Say so when a token changed in the base is one that a theme sets for itself: the theme keeps its own value, which looks
 * like the change did not work. Reads the tokens after each change to a token file and compares them with before.
 */
async function watchThemeOverrides(
  root: string,
  server: ViteDevServer,
  note: (line: string) => void,
): Promise<void> {
  const read = async () => {
    try {
      const loaded = await loadConfigFile(root)
      const tokens = new Project(root, { ...loaded?.options }).tokens()
      return tokens?.ok ? tokens.manifest : undefined
    } catch {
      return undefined
    }
  }
  let before = await read()
  let timer: ReturnType<typeof setTimeout> | undefined
  const changed = (file: string) => {
    const f = file.replaceAll('\\', '/')
    if (!f.endsWith('.tokens.json') || f.includes('/node_modules/') || f.includes('/.tessera/'))
      return
    clearTimeout(timer)
    timer = setTimeout(() => {
      void read().then((after) => {
        if (before && after) for (const line of themeOverrideNotes(before, after, root)) note(line)
        if (after) before = after
      })
    }, 200)
  }
  server.watcher.on('change', changed)
  server.watcher.on('add', changed)
  server.watcher.on('unlink', changed)
}

/** The two servers of `tessera dev`. `docs` is absent when the project's config says `docs: false`. */
export interface DevServers {
  app: ViteDevServer
  docs?: ViteDevServer
}

/**
 * Start the app, and beside it the docs of the design system, each on its own port: the app on `--port` (default
 * 5173) and the docs on `--docs-port`, or the next free port. `docs: false` in `tessera.config` starts only the app.
 */
export async function startDev(
  root: string,
  args: Args,
  options: { note?: (line: string) => void } = {},
): Promise<DevServers> {
  const { createServer } = await import('vite')
  const app = await createServer(await projectConfig(root, args))
  await app.listen()
  if (options.note) void watchThemeOverrides(root, app, options.note)
  const config = (await loadConfigFile(root))?.options.config
  if (config?.docs === false) return { app }
  const given = flag(args, 'docs-port')
  if (given !== undefined && (typeof given !== 'string' || !/^\d+$/.test(given))) {
    await app.close()
    throw new CliError(`"--docs-port" needs a number, got ${String(given)}.`)
  }
  // Loaded here, not at the top: the docs app brings in its own plugins, which no other command needs.
  const { serveDocs } = await import('@tessera/docs')
  try {
    const docs = await serveDocs(root, {
      report: (project) => buildReport(project),
      // The app holds its port, so the docs' search for a free one starts above it.
      port: given ? Number(given) : (app.config.server.port ?? 5173) + 1,
    })
    return { app, docs }
  } catch (error) {
    await app.close()
    throw error
  }
}

/** `tessera dev`: the app with hot updates, and the design system's docs beside it. */
export async function dev(args: Args, io: Io): Promise<number> {
  const root = findProjectRoot(io.cwd, args)
  const ui = io.ui
  const { app, docs } = await startDev(root, args, {
    note: (line) => io.out(ui ? `  ${ui.bold('Note')}  ${line}` : `  Note  ${line}`),
  })
  const address = (server: ViteDevServer) => server.resolvedUrls?.local[0] ?? ''
  const line = (label: string, server: ViteDevServer) =>
    ui
      ? `  ${ui.bold(label.padEnd(5))} ${ui.accent(ui.underline(address(server)))}`
      : `  ${label.padEnd(5)} ${address(server)}`
  io.out(line('App', app))
  if (docs) io.out(line('Docs', docs))
  else
    io.out(
      ui
        ? ui.dim('  Docs  off (docs: false in tessera.config)')
        : '  Docs  off (docs: false in tessera.config)',
    )
  // Closing either server ends the command; the docs only exist while the app does.
  await new Promise<void>((done) => app.httpServer?.on('close', done))
  await docs?.close()
  return 0
}

/**
 * `tessera build`: a production build into `dist/`. With `--prerender`, every page that has no parameters is also
 * rendered to HTML, so it shows at once and a search engine reads it.
 */
export async function build(args: Args, io: Io): Promise<number> {
  const root = findProjectRoot(io.cwd, args)
  const { build: viteBuild } = await import('vite')
  const config = await projectConfig(root, args)
  const prerendering = has(args, 'prerender')
  // The manifest says which stylesheets each page needs; the prerendered HTML links them.
  const hadManifest = !!config.build?.manifest
  await viteBuild(prerendering ? { ...config, build: { ...config.build, manifest: true } } : config)
  if (!prerendering) return 0

  const project = await openProject(io.cwd, args)
  const manifest = project.routes().manifest
  const outDir = resolve(root, config.build?.outDir ?? 'dist')
  const result = await prerender(
    root,
    outDir,
    manifest.routes.map((r) => ({ path: r.path, file: r.file, params: r.params })),
  )
  // The manifest was only for this step, unless the project asked for it.
  if (!hadManifest) rmSync(join(outDir, '.vite'), { recursive: true, force: true })
  const ui = io.ui
  const list = (files: string[]) =>
    files
      .map((f) =>
        f === 'index.html' ? '/' : f.endsWith('/index.html') ? `/${f.slice(0, -11)}` : f,
      )
      .join(', ')
  if (ui) {
    io.out(
      result.written.length
        ? ui.ok(
            ui.bold(
              `Prerendered ${result.written.length} ${result.written.length === 1 ? 'page' : 'pages'}`,
            ),
          ) + ui.dim(`  ${list(result.written)}`)
        : ui.warn('No pages were prerendered.'),
    )
    for (const s of result.skipped) io.out(ui.warn(`${s.path} was not prerendered: ${s.reason}.`))
  } else {
    io.out(
      result.written.length
        ? `Prerendered ${result.written.length} ${result.written.length === 1 ? 'page' : 'pages'}: ${list(result.written)}`
        : 'No pages were prerendered.',
    )
    for (const s of result.skipped) io.out(`${s.path} was not prerendered: ${s.reason}.`)
  }
  return 0
}

/** `tessera preview`: serve the production build. */
export async function preview(args: Args, io: Io): Promise<number> {
  const { preview: vitePreview } = await import('vite')
  const server = await vitePreview(await projectConfig(findProjectRoot(io.cwd, args), args))
  server.printUrls()
  await new Promise<void>((done) => server.httpServer.on('close', done))
  return 0
}
