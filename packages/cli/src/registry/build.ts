import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { extractContract } from '@tessera/compiler'
import {
  checksum,
  isComponentName,
  itemFile,
  RegistryError,
  validateItem,
  type RegistryFile,
  type RegistryIndex,
  type RegistryItem,
} from './schema'

export interface TokenSetSource {
  /** `tailwind`, which becomes the item `tokens:tailwind`. */
  name: string
  description: string
  /** The folder of `*.tokens.json` files (and `themes/`, README). */
  dir: string
}

export interface BuildOptions {
  /** A folder with a `components` folder of `.tess` files (like `packages/ui`). */
  uiDir: string
  tokenSets?: TokenSetSource[]
  /** The framework version the components are written for. */
  minTessera: string
  /** Versions for the npm packages components import (`{ lucide: '1.62.0' }`). */
  npmVersions?: Record<string, string>
  /** What the registry calls itself. */
  name?: string
}

export interface Registry {
  index: RegistryIndex
  items: RegistryItem[]
}

const TAG = /<([A-Z][A-Za-z0-9]*)/g
/** A component named in a contract's `preview` (`"component": "AccordionItem"`) is needed to show this one. */
const PREVIEW_COMPONENT = /"component"\s*:\s*"([A-Z][A-Za-z0-9]*)"/g
const TOKEN_REF = /\$([A-Za-z][\w-]*(?:\.[\w-]+)+)/g
const IMPORT = /\bfrom\s+['"]([^'"]+)['"]/g
const STYLE = /<style[^>]*>([\s\S]*?)<\/style>/g

/** The package a module specifier names: `lucide` for `lucide/icons`, `@a/b` for `@a/b/c`; undefined for a relative path. */
function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:'))
    return undefined
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function readTree(dir: string, base = ''): RegistryFile[] {
  const out: RegistryFile[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...readTree(full, `${base}${name}/`))
    else out.push({ path: `${base}${name}`, content: readFileSync(full, 'utf8') })
  }
  return out
}

/**
 * Build a registry from a folder of components and folders of tokens. Which other components a component needs is
 * read from its template (a tag with a catalogue name), which npm packages from what its scripts import, and which
 * tokens from its styles: nothing is declared by hand, so it cannot drift from the code.
 */
export function buildRegistry(options: BuildOptions): Registry {
  const dir = join(options.uiDir, 'components')
  const names = readdirSync(dir)
    .filter((f) => f.endsWith('.tess'))
    .map((f) => f.slice(0, -'.tess'.length))
    .sort()
  const known = new Set(names)
  const supporting = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('.browser.'),
  )
  const items: RegistryItem[] = []

  for (const name of names) {
    if (!isComponentName(name)) throw new RegistryError(`"${name}" is not a valid component name.`)
    const source = readFileSync(join(dir, `${name}.tess`), 'utf8')
    const contract = extractContract(source, `${name}.tess`)
    if (!contract || contract.name !== name)
      throw new RegistryError(`${name}.tess must have a contract named "${name}".`)
    const files: RegistryFile[] = [{ path: `${name}.tess`, content: source }]
    const docs = join(dir, `${name}.docs.md`)
    if (existsSync(docs))
      files.push({ path: `${name}.docs.md`, content: readFileSync(docs, 'utf8') })

    // Sibling scripts the component imports by relative path (the icon set), with what they import in turn.
    const npm = new Set<string>()
    const scan = (text: string) => {
      for (const m of text.matchAll(IMPORT)) {
        const pkg = packageOf(m[1]!)
        if (pkg) npm.add(pkg)
      }
    }
    scan(source)
    for (const file of supporting) {
      const stem = file.replace(/\.ts$/, '')
      if (new RegExp(`from\\s+['"]\\./${stem}(\\.ts)?['"]`).test(source)) {
        const text = readFileSync(join(dir, file), 'utf8')
        files.push({ path: file, content: text })
        scan(text)
      }
    }

    const components = [
      ...new Set(
        [...source.matchAll(TAG), ...source.matchAll(PREVIEW_COMPONENT)].map((m) => m[1]!),
      ),
    ]
      .filter((c) => c !== name && known.has(c))
      .sort()
    const style = [...source.matchAll(STYLE)].map((m) => m[1]).join('\n')
    const tokens = [...new Set([...style.matchAll(TOKEN_REF)].map((m) => m[1]!))].sort()
    const versions = options.npmVersions ?? {}
    const missing = [...npm].filter((p) => !versions[p])
    if (missing.length)
      throw new RegistryError(
        `${name} imports ${missing.join(', ')}, which has no version to install.`,
      )

    items.push(
      validateItem({
        name,
        type: 'component',
        description: contract.description,
        files,
        ...(components.length ? { components } : {}),
        ...(npm.size
          ? { npm: Object.fromEntries([...npm].sort().map((p) => [p, versions[p]!])) }
          : {}),
        ...(tokens.length ? { tokens } : {}),
        minTessera: options.minTessera,
        sha256: checksum(files),
      }),
    )
  }

  for (const set of options.tokenSets ?? []) {
    const files = readTree(set.dir)
    items.push(
      validateItem({
        name: `tokens:${set.name}`,
        type: 'tokens',
        description: set.description,
        files,
        minTessera: options.minTessera,
        sha256: checksum(files),
      }),
    )
  }

  const index: RegistryIndex = {
    version: 1,
    name: options.name ?? 'Tessera UI',
    items: items.map(({ files, ...rest }) => ({ ...rest, files: files.map((f) => f.path) })),
  }
  return { index, items }
}

/** Write a registry as the files a static host serves: `index.json` and `r/<item>.json`. */
export function writeRegistry(registry: Registry, out: string): void {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(join(out, 'r'), { recursive: true })
  writeFileSync(join(out, 'index.json'), JSON.stringify(registry.index, null, 2) + '\n')
  for (const item of registry.items) {
    const path = join(out, itemFile(item.name))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(item, null, 2) + '\n')
  }
}
