import { createHash } from 'node:crypto'

/** A file of a registry item. The path is relative to where the item is installed, and has no folders beyond `themes/`. */
export interface RegistryFile {
  path: string
  content: string
}

/**
 * One thing `tessera add` can install: a component (into `system/components`) or a set of design tokens (into
 * `system/<folder>/tokens`). The name of a token set is `tokens:<name>`.
 */
export interface RegistryItem {
  name: string
  type: 'component' | 'tokens'
  description: string
  files: RegistryFile[]
  /** Other components of the registry this one's template uses; they are installed with it. */
  components?: string[]
  /** npm packages the component's scripts import, with the version it was tested with. */
  npm?: Record<string, string>
  /** The tokens the component's styles use, as written (`color.surface.default`), for the token-fit check. */
  tokens?: string[]
  /** The oldest `@pixelscriptio/tessera` this item works with. */
  minTessera?: string
  /** SHA-256 of the files, so a corrupted or altered download is refused. */
  sha256: string
}

/** The list a registry serves at `index.json`: every item without its file contents. */
export interface RegistryIndex {
  version: 1
  name: string
  items: Array<Omit<RegistryItem, 'files'> & { files: string[] }>
}

/** A registry that cannot be trusted: the message says why, in words for the person running the command. */
export class RegistryError extends Error {}

const MAX_FILES = 40
const MAX_FILE = 2 * 1024 * 1024
const MAX_TOTAL = 8 * 1024 * 1024

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/
const TOKEN_SET = /^tokens:[a-z][a-z0-9-]*$/
const COMPONENT_FILE = /^[A-Z][A-Za-z0-9]*(\.docs\.md|\.tess)$|^[A-Za-z][A-Za-z0-9-]*\.ts$/
const TOKEN_FILE = /^(themes\/)?[A-Za-z0-9_-]+(\.tokens\.json|\.md)$|^[A-Z][A-Z-]*LICENSE$/
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const NPM_RANGE = /^[0-9A-Za-z.^~<>=*|-]+$/
const VERSION = /^\d+\.\d+\.\d+$/

export const isComponentName = (name: string): boolean => COMPONENT_NAME.test(name)

/** The file an item is served from, beside `index.json`: `r/Button.json`, `r/tokens-tailwind.json`. */
export const itemFile = (name: string): string => `r/${name.replace(':', '-')}.json`

/** The checksum an item carries: its files, in path order. */
export function checksum(files: RegistryFile[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1))
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Whether `path` is one of the few shapes a file of this kind of item may have: never a folder walk, never absolute. */
export function safePath(type: RegistryItem['type'], path: string): boolean {
  return (type === 'component' ? COMPONENT_FILE : TOKEN_FILE).test(path)
}

/**
 * Check something read from a registry (a file or a response) before anything is written from it. The registry may
 * be a stranger's, so every field is checked: names, file paths (only the shapes a component or a token set has,
 * nothing that can leave the folder), sizes, the checksum, and the npm packages named.
 */
export function validateItem(raw: unknown, expectedName?: string): RegistryItem {
  const fail = (why: string): never => {
    throw new RegistryError(`The registry sent an item that cannot be used: ${why}.`)
  }
  if (!isObject(raw)) return fail('it is not an object')
  const { name, type, description, files, components, npm, tokens, minTessera, sha256 } = raw
  if (typeof name !== 'string') return fail('it has no name')
  if (type !== 'component' && type !== 'tokens') return fail(`"${name}" has an unknown type`)
  if (type === 'component' ? !COMPONENT_NAME.test(name) : !TOKEN_SET.test(name))
    return fail(`"${name}" is not a valid name`)
  if (expectedName !== undefined && name !== expectedName)
    return fail(`it is "${name}", not "${expectedName}"`)
  if (typeof description !== 'string') return fail(`"${name}" has no description`)
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES)
    return fail(`"${name}" has no files, or more than ${MAX_FILES}`)
  let total = 0
  const seen = new Set<string>()
  const checked: RegistryFile[] = []
  for (const file of files) {
    if (!isObject(file) || typeof file.path !== 'string' || typeof file.content !== 'string')
      return fail(`a file of "${name}" is malformed`)
    if (!safePath(type, file.path))
      return fail(
        `"${file.path}" is not a file a ${type === 'component' ? 'component' : 'token set'} may have`,
      )
    if (seen.has(file.path)) return fail(`"${file.path}" appears twice in "${name}"`)
    seen.add(file.path)
    if (file.content.length > MAX_FILE) return fail(`"${file.path}" is too large`)
    total += file.content.length
    checked.push({ path: file.path, content: file.content })
  }
  if (total > MAX_TOTAL) return fail(`"${name}" is too large`)
  if (typeof sha256 !== 'string' || sha256 !== checksum(checked))
    return fail(`the files of "${name}" do not match their checksum`)
  const item: RegistryItem = { name, type, description, files: checked, sha256 }
  if (components !== undefined) {
    if (
      !Array.isArray(components) ||
      !components.every((c) => typeof c === 'string' && COMPONENT_NAME.test(c))
    )
      return fail(`the components "${name}" needs are not component names`)
    item.components = components as string[]
  }
  if (npm !== undefined) {
    if (!isObject(npm)) return fail(`the packages "${name}" needs are malformed`)
    for (const [pkg, range] of Object.entries(npm)) {
      if (!NPM_NAME.test(pkg) || typeof range !== 'string' || !NPM_RANGE.test(range))
        return fail(`"${pkg}" is not a package name and version`)
    }
    item.npm = npm as Record<string, string>
  }
  if (tokens !== undefined) {
    if (!Array.isArray(tokens) || !tokens.every((t) => typeof t === 'string'))
      return fail(`the tokens "${name}" uses are malformed`)
    item.tokens = tokens as string[]
  }
  if (minTessera !== undefined) {
    if (typeof minTessera !== 'string' || !VERSION.test(minTessera))
      return fail(`the version "${name}" needs is not a version`)
    item.minTessera = minTessera
  }
  return item
}

/** Check an `index.json`. */
export function validateIndex(raw: unknown): RegistryIndex {
  if (
    !isObject(raw) ||
    raw.version !== 1 ||
    !Array.isArray(raw.items) ||
    typeof raw.name !== 'string'
  )
    throw new RegistryError('The registry sent an index that cannot be used.')
  const items = raw.items.map((entry) => {
    if (!isObject(entry) || typeof entry.name !== 'string' || typeof entry.description !== 'string')
      throw new RegistryError('The registry sent an index with a malformed entry.')
    if (entry.type !== 'component' && entry.type !== 'tokens')
      throw new RegistryError(`The registry lists "${entry.name}" with an unknown type.`)
    if (entry.type === 'component' ? !COMPONENT_NAME.test(entry.name) : !TOKEN_SET.test(entry.name))
      throw new RegistryError(`The registry lists "${entry.name}", which is not a valid name.`)
    return entry as unknown as RegistryIndex['items'][number]
  })
  return { version: 1, name: raw.name, items }
}
