// Builds the Tessera UI registry: `index.json` and `r/<item>.json`, the files `tessera add` reads, from the
// components in packages/ui and the token sets in the CLI's templates. Usage: build-registry [out-folder]
// (default `registry-dist` at the repository root). Host the folder anywhere that serves static files.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRegistry, writeRegistry } from '../src/registry/build'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const ui = join(repo, 'packages', 'ui')
const out = resolve(process.argv[2] ?? join(repo, 'registry-dist'))

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>
const framework = read(join(repo, 'packages', 'tessera', 'package.json')).version as string
const lucide = read(join(ui, 'package.json')).dependencies.lucide as string

const registry = buildRegistry({
  uiDir: ui,
  minTessera: framework,
  npmVersions: { lucide },
  tokenSets: [
    {
      name: 'tailwind',
      description:
        'The default theme of Tailwind CSS (every color, the spacing scale, radii, type, shadows) as Tessera tokens, with a light and a dark semantic layer.',
      dir: join(repo, 'packages', 'cli', 'templates', 'tailwind', 'system', 'tailwind', 'tokens'),
    },
    {
      name: 'unstyled',
      description:
        'The token names the components use, with plain values: black on white, square corners, no shadows. A blank page to design on.',
      dir: join(repo, 'packages', 'cli', 'templates', 'unstyled', 'system', 'unstyled', 'tokens'),
    },
    {
      name: 'tessera',
      description:
        'The Tessera look: warm neutrals and a green accent, with a light and a dark theme.',
      dir: join(ui, 'systems', 'tessera', 'tokens'),
    },
  ],
})
writeRegistry(registry, out)
console.log(`Wrote ${registry.items.length} items to ${out}`)
