// What both registry scripts build from: the components in packages/ui and the token sets the CLI ships.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuildOptions } from '../src/registry/build'

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>

export function registryOptions(repo: string): BuildOptions {
  const ui = join(repo, 'packages', 'ui')
  return {
    uiDir: ui,
    minTessera: read(join(repo, 'packages', 'tessera', 'package.json')).version as string,
    npmVersions: { lucide: read(join(ui, 'package.json')).dependencies.lucide as string },
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
  }
}
