import { buildRouteManifest, pagePaths } from './manifest'
import type { LayoutModule, PageModule, RouteDefinition } from './router'

/**
 * Build routes from `import.meta.glob('./pages/**\/*.tess')`, the way the generated route module does, so a
 * test or a custom setup gets exactly the routes the build would.
 */
export function routesFromModules(
  modules: Record<string, () => Promise<unknown>>,
  pagesPrefix: string,
): { routes: RouteDefinition[]; notFound?: () => Promise<PageModule> } {
  const prefix = pagesPrefix.replace(/\/?$/, '/')
  const manifest = buildRouteManifest(pagePaths(Object.keys(modules), pagesPrefix))
  if (manifest.diagnostics.length) {
    throw new Error(manifest.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'))
  }
  const loader = (file: string) => modules[prefix + file] as () => Promise<PageModule>
  return {
    routes: manifest.routes.map((r) => ({ path: r.path, load: loader(r.file) })),
    notFound: manifest.notFound ? loader(manifest.notFound.file) : undefined,
  }
}

/** Layouts by name from `import.meta.glob('./layouts/*.tess')`, the way the generated route module does. */
export function layoutsFromModules(
  modules: Record<string, () => Promise<unknown>>,
  layoutsPrefix: string,
): Record<string, () => Promise<LayoutModule>> {
  const prefix = layoutsPrefix.replace(/\/?$/, '/')
  const out: Record<string, () => Promise<LayoutModule>> = {}
  for (const [key, load] of Object.entries(modules)) {
    if (!key.startsWith(prefix) || !key.endsWith('.tess')) continue
    const name = key.slice(prefix.length, -'.tess'.length)
    if (!name.includes('/')) out[name] = load as () => Promise<LayoutModule>
  }
  return out
}
