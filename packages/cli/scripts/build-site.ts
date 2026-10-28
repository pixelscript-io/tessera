// Builds the Tessera UI site: the registry and a page for each component, into packages/ui/dist (what
// packages/ui/wrangler.jsonc deploys). Usage: build-site [out-folder]
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRegistry } from '../src/registry/build'
import { buildSite, writeSite } from '../src/site/build'
import { registryOptions } from './registry-options'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const out = resolve(process.argv[2] ?? join(repo, 'packages', 'ui', 'dist'))

const files = buildSite(buildRegistry(registryOptions(repo)))
writeSite(files, out)
console.log(`Wrote ${files.length} files to ${out}`)
