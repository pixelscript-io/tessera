import process from 'node:process'
// The router's own components (`<Link>`) ship as source next to the built package: the Vite plugin compiles them
// in the user's project, like any component, so they get the user's tokens and themes.
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, '..', '..', 'router', 'components')
const to = join(here, '..', 'dist', 'components')
mkdirSync(to, { recursive: true })
for (const file of readdirSync(from).filter((f) => f.endsWith('.tess')))
  cpSync(join(from, file), join(to, file))
// The docs app's client is plain TypeScript that `tessera docs` serves from the user's project: it ships as source too.
const docsFrom = join(here, '..', '..', 'docs', 'src', 'client')
const docsTo = join(here, '..', 'dist', 'docs-client')
mkdirSync(docsTo, { recursive: true })
for (const file of ['main.ts', 'style.ts']) cpSync(join(docsFrom, file), join(docsTo, file))
process.stdout.write('Copied the router components and the docs app.\n')
