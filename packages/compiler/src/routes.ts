import { nearest } from '@tessera/contract'
import { matchRoute, parsePattern, splitTarget, type RouteManifest } from '@tessera/router/manifest'
import type { PageMeta } from './compile'
import type { CompilerDiagnostic } from './diagnostics'
import { PUBLIC_PACKAGES } from './packages'

/**
 * Is a literal link target one of the app's routes? Returns the problem to report, or undefined when it is
 * fine. Only targets that start with "/" are app routes; a query string or hash is ignored.
 */
export function unknownRoute(
  to: string,
  routes: readonly string[],
): { message: string; hint?: string } | undefined {
  if (!to.startsWith('/')) return undefined
  const { path } = splitTarget(to)
  const compiled = routes.map((pattern) => ({ pattern, segments: parsePattern(pattern) }))
  if (matchRoute(compiled, path)) return undefined
  const close = nearest(
    path,
    routes.filter((r) => !r.includes(':')),
  )
  return {
    message: `Unknown route "${path}".`,
    hint: close
      ? `Did you mean "${close}"?`
      : `Known routes: ${routes.map((r) => `"${r}"`).join(', ') || 'none'}.`,
  }
}

/** The part of a page's path that makes its scoped class prefix unique: `blog/[slug].tess` becomes `blog-slug`. */
export function pageSlug(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const at = normalized.lastIndexOf('/pages/')
  const relative =
    at === -1 ? (normalized.split('/').pop() ?? normalized) : normalized.slice(at + 7)
  return (
    relative
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'index'
  )
}

export interface RoutesModuleOptions {
  /** The `<page>` block of each page, by its file in the pages folder. */
  pages?: ReadonlyMap<string, PageMeta>
  /** The APIs of the project and how a module imports each. `default` is the one a page's data uses when it names none. */
  apis?: ReadonlyArray<{ name: string; importPath: string }>
}

/**
 * The `virtual:tessera/routes` module: every page behind a dynamic import, so a bundler gives each its own
 * chunk. `pagesImportBase` is how the pages folder is addressed from the project root, such as `/app/pages`.
 *
 * A page whose `<page>` block declares `data` gets a `prefetch` that starts those reads when the person navigates,
 * with the parameters of the route that each path names (and only those: another one would become part of the query,
 * and the read the page makes would no longer be the same one), and `wait` when the page waits for them.
 */
export function generateRoutesModule(
  manifest: RouteManifest,
  pagesImportBase: string,
  layouts: readonly string[] = [],
  layoutsImportBase = '/app/layouts',
  options: RoutesModuleOptions = {},
): string {
  const load = (file: string) => `() => import(${JSON.stringify(`${pagesImportBase}/${file}`)})`
  const apis = new Map((options.apis ?? []).map((api) => [api.name, api.importPath]))
  const imports = new Set<string>()
  let usesShared = false

  /** The call that starts one read: on the api the page names, the project's default one, or the shared one. */
  const prefetchCall = (entry: NonNullable<PageMeta['data']>[number]): string => {
    const name = entry.api ?? 'default'
    let target: string
    if (apis.has(name)) {
      target = `__tessera_api_${name}`
      imports.add(`import ${target} from ${JSON.stringify(apis.get(name))}`)
    } else {
      usesShared = true
      target = '__tessera_prefetch'
    }
    const pairs = [
      ...[...entry.path.matchAll(/\/:([A-Za-z_]\w*)/g)].map(
        (m) => `${JSON.stringify(m[1])}: params[${JSON.stringify(m[1])}]`,
      ),
      ...Object.entries(entry.query ?? {}).map(
        ([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`,
      ),
    ]
    const hasParams = pairs.some((p) => p.includes('params['))
    const values = hasParams ? `{ ${pairs.join(', ')} }` : JSON.stringify(entry.query ?? {})
    const call = target === '__tessera_prefetch' ? target : `${target}.prefetch`
    return `${call}(${JSON.stringify(entry.path)}, ${values})`
  }

  const route = (r: RouteManifest['routes'][number]): string => {
    const meta = options.pages?.get(r.file)
    const data = meta?.data ?? []
    if (!data.length && !meta?.wait) {
      return `  { path: ${JSON.stringify(r.path)}, load: ${load(r.file)} },`
    }
    const fields = [`path: ${JSON.stringify(r.path)}`, `load: ${load(r.file)}`]
    if (meta?.wait) fields.push('wait: true')
    if (data.length) fields.push(`prefetch: (params) => [${data.map(prefetchCall).join(', ')}]`)
    return `  { ${fields.join(', ')} },`
  }
  const routeLines = manifest.routes.map(route)

  const lines = [
    ...(usesShared
      ? [`import { prefetch as __tessera_prefetch } from '${PUBLIC_PACKAGES.core}'`]
      : []),
    ...imports,
    'export const routes = [',
    ...routeLines,
    ']',
    `export const notFound = ${manifest.notFound ? load(manifest.notFound.file) : 'undefined'}`,
    'export const layouts = {',
    ...layouts.map(
      (name) =>
        `  ${JSON.stringify(name)}: () => import(${JSON.stringify(`${layoutsImportBase}/${name}.tess`)}),`,
    ),
    '}',
  ]
  return lines.join('\n') + '\n'
}

/** `.tessera/routes.d.ts`: the route patterns and their parameters, for typing links and `navigate()`. */
export function generateRoutesDts(manifest: RouteManifest): string {
  const entries = manifest.routes.map((r) => {
    const params = r.params.map((p) => `${p}: string`).join('; ')
    return `    ${JSON.stringify(r.path)}: { ${params} }`
  })
  return [
    '// Generated by Tessera from app/pages. Do not edit; add it to .gitignore.',
    "import '@pixelscriptio/tessera/router'",
    '',
    "declare module '@pixelscriptio/tessera/router' {",
    '  interface RouteTypes {',
    ...entries,
    '  }',
    '}',
    '',
  ].join('\n')
}

/** Route problems (conflicts, bad file names) as compiler diagnostics, pointing at the first file involved. */
export function routeDiagnostics(
  manifest: RouteManifest,
  pagesDisplay: string,
): CompilerDiagnostic[] {
  return manifest.diagnostics.map((d) => ({
    code: d.code,
    severity: 'error' as const,
    message: d.message,
    hint: d.hint,
    file: `${pagesDisplay}/${d.files[0]}`,
    line: 1,
    column: 1,
  }))
}
