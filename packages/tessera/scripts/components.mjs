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
process.stdout.write('Copied the router components.\n')
