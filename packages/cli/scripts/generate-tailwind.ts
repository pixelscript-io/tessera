/**
 * Regenerates `templates/tailwind/system/tailwind/tokens/` from `tailwind/theme.css`. Run with
 * `pnpm --filter @tessera/cli generate:tailwind` after updating that file.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTailwindTokens } from './tailwind'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'tailwind', 'theme.css'), 'utf8')

for (const [file, content] of Object.entries(buildTailwindTokens(css))) {
  const path = join(root, 'templates', 'tailwind', 'system', 'tailwind', 'tokens', file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(content, null, 2) + '\n')
}
console.log('Generated the Tailwind preset tokens.')
