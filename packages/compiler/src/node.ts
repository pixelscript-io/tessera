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
    /** The Tessera UI library's components (`@pixelscriptio/tessera-ui`); null for none. */
    uiDir?: string | null
    /** Components that exist only in memory (documentation samples); one with the same file replaces the disk copy. */
    extraFiles?: RegistryFile[]
  } = {},
): ProjectComponents {
  const systemDir = options.systemDir ?? findUp(root, join('system', 'components'))
  const appDir = options.appDir ?? join(root, 'app', 'components')
  const routerDir = options.routerDir === undefined ? routerComponentsDir(root) : options.routerDir
  const uiDir = options.uiDir === undefined ? projectLibraryDir(root) : options.uiDir
  const exists = (d: string | null | undefined): d is string => !!d && existsSync(d)
  // The library comes first; a project component with the same name replaces it (see ComponentRegistry).
  const dirs = [uiDir, systemDir, routerDir, appDir].filter(exists)
  const extra = options.extraFiles ?? []
  const extraPaths = new Set(extra.map((f) => f.file))
  const files = [
    ...dirs
      .flatMap((dir) =>
        scanComponentFiles(dir).map((f) => (dir === uiDir ? { ...f, library: true } : f)),
      )
      .filter((f) => !extraPaths.has(f.file)),
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
 * The components of the Tessera UI library, found through the installed package
 * (`@pixelscriptio/tessera-ui`, which ships them as source in `components`). Null when it is not installed.
 */
export function uiComponentsDir(root: string): string | null {
  try {
    const require = createRequire(resolve(root, 'package.json'))
    const dir = join(
      dirname(require.resolve('@pixelscriptio/tessera-ui/package.json')),
      'components',
    )
    return existsSync(dir) ? dir : null
  } catch {
    return null
  }
}

/**
 * The library components a project builds: the installed library's, when the project has a design system
 * (`system/tokens`) for them to be styled by. Without one they are left out, so `--preset none` stays empty.
 */
export function projectLibraryDir(root: string): string | null {
  const tokens = findUp(root, join('system', 'tokens'))
  const has = tokens && readdirSync(tokens).some((n) => n.endsWith('.tokens.json'))
  return has ? uiComponentsDir(root) : null
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
