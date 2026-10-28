// Builds the Tessera UI registry: `index.json` and `r/<item>.json`, the files `tessera add` reads, from the
// components in packages/ui and the token sets in the CLI's templates. Usage: build-registry [out-folder]
// (default `registry-dist` at the repository root). Host the folder anywhere that serves static files.
// `build-site` writes the same registry together with the Tessera UI site.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRegistry, writeRegistry } from '../src/registry/build'
import { registryOptions } from './registry-options'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const out = resolve(process.argv[2] ?? join(repo, 'registry-dist'))

const registry = buildRegistry(registryOptions(repo))
writeRegistry(registry, out)
console.log(`Wrote ${registry.items.length} items to ${out}`)
