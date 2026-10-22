/**
 * Turning a folder of pages into routes, and matching a path against them. Pure and dependency-free, so the
 * compiler, the dev server and the browser runtime all use the same rules.
 */

export type Segment = { kind: 'static'; value: string } | { kind: 'param'; name: string }

export interface RouteRecord {
  /** Pattern with `:param` segments, such as `/blog/:slug`. */
  path: string
  /** Page file, relative to the pages folder, with forward slashes. */
  file: string
  segments: Segment[]
  params: string[]
}

export interface RouteDiagnostic {
  code: 'T6001' | 'T6002'
  message: string
  hint?: string
  /** The files involved, relative to the pages folder. */
  files: string[]
}

export interface RouteManifest {
  /** In matching order: more specific routes first. */
  routes: RouteRecord[]
  /** The top-level `404.tess`, shown when nothing matches. */
  notFound?: { file: string }
  diagnostics: RouteDiagnostic[]
}

const STATIC = /^[A-Za-z0-9_-]+$/
const PARAM = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/

/** Where in the pages folder is this file, as a route? Returns a problem if its name cannot be a route. */
function parseFile(file: string): { segments: Segment[] } | { problem: string; hint?: string } {
  const parts = file.replace(/\.tess$/, '').split('/')
  if (parts[parts.length - 1] === 'index') parts.pop()
  const segments: Segment[] = []
  const names = new Set<string>()
  for (const part of parts) {
    if (part.startsWith('[...')) {
      return {
        problem: `"${part}" is a catch-all route, which is not supported yet.`,
        hint: 'Use a named parameter such as [slug], or a page for each path.',
      }
    }
    const param = PARAM.exec(part)
    if (param) {
      if (names.has(param[1]!))
        return { problem: `The parameter "${param[1]}" appears twice in this path.` }
      names.add(param[1]!)
      segments.push({ kind: 'param', name: param[1]! })
    } else if (STATIC.test(part)) {
      segments.push({ kind: 'static', value: part })
    } else {
      return {
        problem: `"${part}" is not a valid route segment.`,
        hint: 'Use letters, numbers, "-" and "_", or [name] for a parameter.',
      }
    }
  }
  return { segments }
}

export const patternOf = (segments: Segment[]) =>
  '/' + segments.map((s) => (s.kind === 'param' ? `:${s.name}` : s.value)).join('/')

/** Static segments before parameters, position by position; otherwise shorter paths first. */
function compareSpecificity(a: Segment[], b: Segment[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i]!.kind !== b[i]!.kind) return a[i]!.kind === 'static' ? -1 : 1
  }
  return a.length - b.length
}

/**
 * Build the routes for a pages folder from the paths of its `.tess` files (relative to it, forward slashes).
 *
 * `index.tess` is its folder's default, `[name].tess` is a parameter, and a top-level `404.tess` is the
 * not-found page. Two files that map to the same route (even if their parameters are named differently) are
 * an error that names both, because it is not clear which one should win.
 */
export function buildRouteManifest(files: string[]): RouteManifest {
  const diagnostics: RouteDiagnostic[] = []
  const routes: RouteRecord[] = []
  let notFound: { file: string } | undefined

  for (const file of [...files].sort()) {
    if (!file.endsWith('.tess')) continue
    if (file.split('/').pop() === '404.tess') {
      if (file === '404.tess') notFound = { file }
      else {
        diagnostics.push({
          code: 'T6002',
          message: `${file}: 404.tess is only used at the top of the pages folder.`,
          hint: 'Move it to pages/404.tess.',
          files: [file],
        })
      }
      continue
    }
    const parsed = parseFile(file)
    if ('problem' in parsed) {
      diagnostics.push({
        code: 'T6002',
        message: `${file}: ${parsed.problem}`,
        hint: parsed.hint,
        files: [file],
      })
      continue
    }
    routes.push({
      path: patternOf(parsed.segments),
      file,
      segments: parsed.segments,
      params: parsed.segments.flatMap((s) => (s.kind === 'param' ? [s.name] : [])),
    })
  }

  // Conflicts compare shapes, so `[id].tess` and `[slug].tess` clash.
  const byShape = new Map<string, RouteRecord[]>()
  for (const route of routes) {
    const shape = route.segments.map((s) => (s.kind === 'param' ? ':' : s.value)).join('/')
    byShape.set(shape, [...(byShape.get(shape) ?? []), route])
  }
  const conflicted = new Set<RouteRecord>()
  for (const group of byShape.values()) {
    if (group.length < 2) continue
    group.forEach((r) => conflicted.add(r))
    const files = group.map((r) => r.file)
    diagnostics.push({
      code: 'T6001',
      message: `Route conflict: ${files.join(' and ')} both map to "${group[0]!.path}".`,
      hint: 'Keep one of them. A folder default is index.tess, so blog.tess and blog/index.tess clash.',
      files,
    })
  }

  return {
    routes: routes
      .filter((r) => !conflicted.has(r))
      .sort((a, b) => compareSpecificity(a.segments, b.segments) || a.path.localeCompare(b.path)),
    notFound,
    diagnostics,
  }
}

export interface RouteMatch<T extends { segments: Segment[] }> {
  route: T
  params: Record<string, string>
}

/** Split a path into decoded segments; undefined if an escape sequence is malformed. */
function splitPath(pathname: string): string[] | undefined {
  const trimmed = pathname.replace(/\/+$/, '').replace(/^\/+/, '')
  if (trimmed === '') return []
  try {
    return trimmed.split('/').map(decodeURIComponent)
  } catch {
    return undefined
  }
}

/** The first route that matches `pathname`, with the parameters it captured. A trailing slash is ignored. */
export function matchRoute<T extends { segments: Segment[] }>(
  routes: readonly T[],
  pathname: string,
): RouteMatch<T> | undefined {
  const parts = splitPath(pathname)
  if (!parts) return undefined
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (const [i, segment] of route.segments.entries()) {
      if (segment.kind === 'static') {
        if (segment.value !== parts[i]) {
          ok = false
          break
        }
      } else params[segment.name] = parts[i]!
    }
    if (ok) return { route, params }
  }
  return undefined
}

/** Segments for a route pattern such as `/blog/:slug`. */
export function parsePattern(path: string): Segment[] {
  return path
    .split('/')
    .filter(Boolean)
    .map((part): Segment =>
      part.startsWith(':')
        ? { kind: 'param', name: part.slice(1) }
        : { kind: 'static', value: part },
    )
}

/** Turn the keys of `import.meta.glob('./pages/**\/*.tess')` into a manifest, given the pages folder prefix. */
export function pagePaths(globKeys: string[], pagesPrefix: string): string[] {
  const prefix = pagesPrefix.replace(/\/?$/, '/')
  return globKeys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
}

/** Parse the path, query and hash of a link target, such as `/blog/hello?draft=1#top`. */
export function splitTarget(to: string): { path: string; query: string; hash: string } {
  const hashAt = to.indexOf('#')
  const hash = hashAt === -1 ? '' : to.slice(hashAt)
  const rest = hashAt === -1 ? to : to.slice(0, hashAt)
  const queryAt = rest.indexOf('?')
  return {
    path: queryAt === -1 ? rest : rest.slice(0, queryAt),
    query: queryAt === -1 ? '' : rest.slice(queryAt),
    hash,
  }
}
