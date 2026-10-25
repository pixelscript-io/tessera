import process from 'node:process'
// The documentation ships inside the package, as plain Markdown, so an AI tool in a project can read it offline:
// `node_modules/@pixelscriptio/tessera/dist/docs/llms-full.txt`. `tessera init` points AGENTS.md at it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLlms } from '../../../website/scripts/llms.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
const built = buildLlms({
  contentDir: join(here, '..', '..', '..', 'website', 'content'),
  version,
})
const to = join(here, '..', 'dist', 'docs')
mkdirSync(to, { recursive: true })
writeFileSync(join(to, 'llms-full.txt'), built.full)
writeFileSync(join(to, 'llms.txt'), built.index)
process.stdout.write(`Wrote the documentation for AI tools (${built.pages.length} pages).\n`)
