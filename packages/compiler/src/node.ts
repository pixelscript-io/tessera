import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { buildRouteManifest, type RouteManifest } from '@tessera/router/manifest'
import { buildTokens, type TokenDiagnostic, type TokenManifest } from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import type { ComponentInfo, ComponentResolver } from './codegen'
import { extractContract, listImports } from './compile'
import { buildApiList, type ApiDiagnostic, type ProjectApi } from './apis'
import { buildStateList, type ProjectState, type StateDiagnostic } from './shared-state'
import { parseApiDescription, type DescriptionDiagnostic } from './api-description'
import { nearest } from '@tessera/contract'
import { ComponentRegistry, type RegistryFile } from './registry'
import { StyleTokens } from './style/tokens'

export interface ImportedComponents {
  resolver: ComponentResolver
  /** Absolute paths of the component files that were read, so hosts can watch them. */
  files: string[]
}

/**
 * Find the components a `.tess` file imports explicitly (`import Button from './Button.tess'`) and read
 * their contracts from disk. Node only; the compiler core takes the resulting resolver as an argument.
 * Until auto-imports (Milestone 8) this is how component usage gets checked.
 */
export function resolveImportedComponents(
  file: string,
  source: string,
  root: string,
): ImportedComponents {
  const infos = new Map<string, ComponentInfo>()
  const files: string[] = []
  for (const entry of listImports(source)) {
    if (entry.imported !== 'default' || !entry.source.endsWith('.tess')) continue
    const target = resolve(dirname(file), entry.source)
    files.push(target)
    try {
      const contract = extractContract(readFileSync(target, 'utf8'), relative(root, target))
      if (contract) infos.set(entry.local, { contract, importPath: entry.source })
    } catch {
      // A missing file surfaces as an unresolved import; the tag then reports as unknown.
    }
  }
  return {
    files,
    resolver: { resolve: (tag) => infos.get(tag), names: () => [...infos.keys()] },
  }
}

/** Walk up from `start` to find a folder containing `relativePath` (for example `system/tokens`). */
export function findUp(start: string, relativePath: string): string | undefined {
  let dir = start
  for (;;) {
    const candidate = join(dir, relativePath)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** The token folders in a `system` folder: `<name>/tokens` for each design system, by name. */
function systemFolders(system: string): string[] {
  return readdirSync(system, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(system, e.name, 'tokens')))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * The design tokens a project builds with, found by walking up from `start` to the nearest `system` folder that has
 * them: `system/<active>/tokens` for the named system; with none named, the earlier layout `system/tokens`, or the
 * first system by name. A named system that is not there is not replaced by another one.
 */
export function systemTokensDir(start: string, active?: string): string | undefined {
  let dir = start
  for (;;) {
    const system = join(dir, 'system')
    if (existsSync(system)) {
      if (active !== undefined) {
        const named = join(system, ...active.split('/'), 'tokens')
        if (existsSync(named)) return named
      }
      const flat = join(system, 'tokens')
      if (existsSync(flat)) return flat
      if (active === undefined) {
        const [first] = systemFolders(system)
        if (first) return join(system, first, 'tokens')
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export type DesignTokens =
  | { ok: true; dir: string; tokens: StyleTokens; css: string; manifest: TokenManifest }
  | { ok: false; dir: string; diagnostics: TokenDiagnostic[] }

/**
 * Build the design tokens in a folder: the lookup that style checks use, and the CSS for the
 * `virtual:tessera/tokens.css` module. Node only.
 */
export function loadDesignTokens(dir: string): DesignTokens {
  const result = buildTokens(loadTokenDir(dir))
  return result.ok
    ? {
        ok: true,
        dir,
        tokens: StyleTokens.fromManifest(result.manifest!),
        css: result.css,
        manifest: result.manifest!,
      }
    : { ok: false, dir, diagnostics: result.diagnostics }
}

/** Every `.tess` file under a folder, in a stable order. */
export function scanComponentFiles(dir: string): RegistryFile[] {
  const out: RegistryFile[] = []
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.tess')) {
        out.push({ file: path.replaceAll('\\', '/'), source: readFileSync(path, 'utf8') })
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

export interface ProjectComponents {
  registry: ComponentRegistry
  /** The folders that were scanned (they exist), for watching. */
  dirs: string[]
}

/**
 * The component registry of a project: `system/components` (found by walking up from the project root, like the
 * tokens) first, then `app/components`. Names are global across both folders.
 */
export function loadComponentRegistry(
  root: string,
  options: {
    systemDir?: string
    appDir?: string
    routerDir?: string | null
    /** Components that exist only in memory (documentation samples); one with the same file replaces the disk copy. */
    extraFiles?: RegistryFile[]
  } = {},
): ProjectComponents {
  const systemDir = options.systemDir ?? findUp(root, join('system', 'components'))
  const appDir = options.appDir ?? join(root, 'app', 'components')
  const routerDir = options.routerDir === undefined ? routerComponentsDir(root) : options.routerDir
  const exists = (d: string | null | undefined): d is string => !!d && existsSync(d)
  const dirs = [systemDir, routerDir, appDir].filter(exists)
  const extra = options.extraFiles ?? []
  const extraPaths = new Set(extra.map((f) => f.file))
  const files = [
    ...dirs.flatMap((dir) => scanComponentFiles(dir)).filter((f) => !extraPaths.has(f.file)),
    ...extra,
  ]
  const display = (file: string) => relative(root, file).replaceAll('\\', '/')
  return { registry: ComponentRegistry.build(files, display), dirs }
}

/**
 * The router's own components (`<Link>`), found through the published package (`@pixelscriptio/tessera`, which
 * ships them as source in `dist/components`) or, inside this repository, the router workspace package.
 */
export function routerComponentsDir(root: string): string | null {
  const require = createRequire(resolve(root, 'package.json'))
  const candidates: Array<() => string> = [
    () =>
      join(dirname(require.resolve('@pixelscriptio/tessera/package.json')), 'dist', 'components'),
    () => join(dirname(require.resolve('@tessera/router')), '..', 'components'),
  ]
  for (const candidate of candidates) {
    try {
      const dir = candidate()
      if (existsSync(dir)) return dir
    } catch {
      /* not installed here */
    }
  }
  return null
}

/**
 * What to tell a project from before 0.9 that still lists `@pixelscriptio/tessera-ui`: that package is gone, its
 * components are copied into the project now. Returns the message, with the `tessera add` line for the components
 * the project's templates use and does not have, or undefined when the project does not list the package.
 */
export function legacyLibraryNotice(root: string): string | undefined {
  let listed: boolean
  try {
    const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >
    listed = ['dependencies', 'devDependencies', 'peerDependencies'].some(
      (field) => json[field]?.['@pixelscriptio/tessera-ui'] !== undefined,
    )
  } catch {
    return undefined
  }
  if (!listed) return undefined
  const defined = new Set(loadComponentRegistry(root).registry.entries.keys())
  const used = new Set<string>()
  for (const dir of [join(root, 'app'), findUp(root, join('system', 'components'))]) {
    if (!dir || !existsSync(dir)) continue
    for (const file of scanTess(dir)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/<([A-Z][A-Za-z0-9]*)/g)) used.add(m[1]!)
    }
  }
  const missing = [...used].filter((n) => !defined.has(n)).sort()
  return [
    '@pixelscriptio/tessera-ui is not a package any more. Since Tessera 0.9 a component is copied into your project, where it is yours to edit.',
    'Remove it from package.json (npm uninstall @pixelscriptio/tessera-ui), then add the components you use:',
    missing.length
      ? `  npx @pixelscriptio/tessera add ${missing.join(' ')}`
      : '  npx @pixelscriptio/tessera add <Name>    (add --list shows what there is)',
  ].join(String.fromCharCode(10))
}

/** Every `.tess` file under a folder. */
function scanTess(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) out.push(...scanTess(full))
    } else if (entry.name.endsWith('.tess')) out.push(full)
  }
  return out
}

export interface ProjectApis {
  apis: ProjectApi[]
  /** Files in the folder that cannot be an api, and descriptions that are wrong, and why. */
  diagnostics: Array<ApiDiagnostic | DescriptionDiagnostic>
  /** The apis folder, which may not exist. */
  dir: string
}

/** The apis of a project: the script files in `app/apis`, each named after its file. */
export function loadProjectApis(root: string, dir = join(root, 'app', 'apis')): ProjectApis {
  const display = (file: string) => relative(root, file).replaceAll('\\', '/')
  const files = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(dir, e.name))
    : []
  const listed = buildApiList(files, display)
  const diagnostics: ProjectApis['diagnostics'] = [...listed.diagnostics]
  const apis = listed.apis.map((api) => {
    const beside = api.file.replace(/\.(?:ts|js|mts|mjs)$/, '.api.json')
    if (!existsSync(beside)) return api
    const parsed = parseApiDescription(readFileSync(beside, 'utf8'), display(beside))
    diagnostics.push(...parsed.diagnostics)
    return parsed.description ? { ...api, description: parsed.description } : api
  })
  // A description with no api beside it: probably a name that is a little different.
  const names = apis.map((a) => a.name)
  for (const file of files) {
    const base = file.replaceAll('\\', '/').split('/').pop()!
    const match = /^(.+)\.api\.json$/.exec(base)
    if (!match || names.includes(match[1]!)) continue
    const close = nearest(match[1]!, names)
    diagnostics.push({
      code: 'T5009',
      severity: 'error',
      file: display(file),
      line: 1,
      column: 1,
      message: `There is no API for this description: app/apis/${match[1]}.ts does not exist.`,
      ...(close ? { hint: `Did you mean "${close}"?` } : {}),
    })
  }
  return { apis, diagnostics, dir: dir.replaceAll('\\', '/') }
}

export interface ProjectStates {
  states: ProjectState[]
  /** Files in the folder that cannot be shared state, and why. */
  diagnostics: StateDiagnostic[]
  /** The state folder, which may not exist. */
  dir: string
}

/** The shared state of a project: the script files in `app/state`, each named after its file. */
export function loadProjectState(
  root: string,
  apis: readonly string[] = [],
  dir = join(root, 'app', 'state'),
): ProjectStates {
  const display = (file: string) => relative(root, file).replaceAll('\\', '/')
  const files = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(dir, e.name))
    : []
  const listed = buildStateList(files, (file) => readFileSync(file, 'utf8'), { apis, display })
  return { ...listed, dir: dir.replaceAll('\\', '/') }
}

export interface ProjectRoutes {
  manifest: RouteManifest
  /** The pages folder, which may not exist. */
  dir: string
  /** Layout names: the `.tess` files directly in `app/layouts`. */
  layouts: string[]
  /** The layouts folder, which may not exist. */
  layoutsDir: string
}

/** Every `.tess` file under `app/pages`, as paths relative to it. */
function pageFiles(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? pageFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
      : entry.name.endsWith('.tess')
        ? [`${prefix}${entry.name}`]
        : [],
  )
}

/** The routes and layouts of a project: its `app/pages` folder as a manifest, and the names in `app/layouts`. */
export function loadProjectRoutes(
  root: string,
  pagesDir = join(root, 'app', 'pages'),
  layoutsDir = join(root, 'app', 'layouts'),
): ProjectRoutes {
  const layouts = existsSync(layoutsDir)
    ? readdirSync(layoutsDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.tess'))
        .map((e) => e.name.slice(0, -'.tess'.length))
        .sort()
    : []
  return { manifest: buildRouteManifest(pageFiles(pagesDir)), dir: pagesDir, layouts, layoutsDir }
}
