import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { VERSION } from '../version'
import { buildRegistry, type TokenSetSource } from './build'
import {
  itemFile,
  RegistryError,
  validateIndex,
  validateItem,
  type RegistryIndex,
  type RegistryItem,
} from './schema'

/** Where `tessera add` looks when `--from` is not given. */
export const DEFAULT_REGISTRY = 'https://tessera-ui.pixelscript.io'

/** Somewhere items can be read from: a published registry, a folder of one, or a catalogue of components. */
export interface RegistrySource {
  /** How to name it to the person: the address or the folder. */
  label: string
  index(): Promise<RegistryIndex>
  /** One item, checked: nothing it says is trusted until `validateItem` has passed it. */
  item(name: string): Promise<RegistryItem>
}

const TIMEOUT_MS = 15_000
const MAX_RESPONSE = 20 * 1024 * 1024

/** Whether a registry may be fetched from this address: https, or http only on this computer. */
function allowed(url: URL): boolean {
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

function httpSource(address: string): RegistrySource {
  let base: URL
  try {
    base = new URL(address.endsWith('/') ? address : `${address}/`)
  } catch {
    throw new RegistryError(`"${address}" is not an address.`)
  }
  if (!allowed(base))
    throw new RegistryError(
      `A registry must be served over https (or http on this computer), not "${base.protocol}".`,
    )
  const get = async (path: string): Promise<unknown> => {
    const url = new URL(path, base)
    let response: Response
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' })
    } catch {
      throw new RegistryError(
        `Could not reach ${url.origin}. Check the connection, or give --from a folder.`,
      )
    }
    // A redirect to somewhere else is not the registry that was asked for.
    if (new URL(response.url).origin !== base.origin)
      throw new RegistryError(
        `${base.origin} sent the request to ${new URL(response.url).origin}, which is not the registry.`,
      )
    if (!response.ok) throw new RegistryError(`${url.href} answered ${response.status}.`)
    const text = await response.text()
    if (text.length > MAX_RESPONSE) throw new RegistryError(`${url.href} is too large.`)
    try {
      return JSON.parse(text)
    } catch {
      throw new RegistryError(`${url.href} is not JSON.`)
    }
  }
  return {
    label: base.origin,
    index: async () => validateIndex(await get('index.json')),
    item: async (name) => validateItem(await get(itemFile(name)), name),
  }
}

function folderSource(dir: string): RegistrySource {
  const read = (path: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(dir, path), 'utf8'))
    } catch {
      throw new RegistryError(`${join(dir, path)} could not be read as JSON.`)
    }
  }
  return {
    label: dir,
    index: async () => validateIndex(read('index.json')),
    item: async (name) => validateItem(read(itemFile(name)), name),
  }
}

/** A folder of components (like `packages/ui`): the registry is built from it each time, so there is nothing to publish first. */
function catalogueSource(dir: string): RegistrySource {
  const manifest = join(dir, 'package.json')
  const dependencies = existsSync(manifest)
    ? ((JSON.parse(readFileSync(manifest, 'utf8')) as { dependencies?: Record<string, string> })
        .dependencies ?? {})
    : {}
  const systems = join(dir, 'systems')
  const tokenSets: TokenSetSource[] = []
  if (existsSync(systems)) {
    for (const name of ['tessera']) {
      const tokens = join(systems, name, 'tokens')
      if (existsSync(tokens))
        tokenSets.push({ name, description: `The ${name} design system.`, dir: tokens })
    }
  }
  let built: ReturnType<typeof buildRegistry> | undefined
  const build = () =>
    (built ??= buildRegistry({
      uiDir: dir,
      tokenSets,
      minTessera: VERSION,
      npmVersions: dependencies,
    }))
  return {
    label: dir,
    index: async () => build().index,
    item: async (name) => {
      const found = build().items.find((i) => i.name === name)
      if (!found) throw new RegistryError(`${dir} has no "${name}".`)
      return found
    },
  }
}

/** Open the registry `--from` names (an address, a registry folder, or a folder of components), or the default one. */
export function openSource(from: string | undefined, cwd: string): RegistrySource {
  if (from === undefined) return httpSource(DEFAULT_REGISTRY)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(from)) return httpSource(from)
  const dir = resolve(cwd, from)
  if (existsSync(join(dir, 'index.json'))) return folderSource(dir)
  if (existsSync(join(dir, 'components'))) return catalogueSource(dir)
  throw new RegistryError(
    `${dir} is not a registry: it has no index.json, and no components folder to build one from.`,
  )
}
