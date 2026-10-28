// Builds the Tessera UI site: the registry, a page for each component, and the script that runs the previews, into
// packages/ui/dist (what packages/ui/wrangler.jsonc deploys). Usage: build-site [out-folder]
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRegistry } from '../src/registry/build'
import { buildSite, writeSite } from '../src/site/build'
import { buildLive } from '../src/site/live'
import { registryOptions } from './registry-options'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const ui = join(repo, 'packages', 'ui')
const out = resolve(process.argv[2] ?? join(ui, 'dist'))

const registry = buildRegistry(registryOptions(repo))
const files = buildSite(registry, {
  assets: { script: '/assets/site.js', css: '/assets/site.css' },
})
writeSite(files, out)
// The previews are styled with the Tessera look, which is also what the site's own examples were written for.
await buildLive(registry, {
  workDir: join(ui, '.site'),
  outDir: join(out, 'assets'),
  tokensDir: join(ui, 'systems', 'tessera', 'tokens'),
})
console.log(`Wrote ${files.length} files and the previews' bundle to ${out}`)
