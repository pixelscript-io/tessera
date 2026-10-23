import process from 'node:process'
// Copies the .tess files a model added or changed (compared with the kitchen-sink app) from work/ to runs/,
// where the scorer reads them:   node experiments/agent-mcp/extract.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const original = join(here, '..', '..', 'examples', 'kitchen-sink', 'app')
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : n.endsWith('.tess') ? [p] : []
  })
rmSync(join(here, 'runs'), { recursive: true, force: true })
for (const arm of readdirSync(join(here, 'work'))) {
  for (const id of readdirSync(join(here, 'work', arm))) {
    const app = join(here, 'work', arm, id, 'app')
    for (const file of walk(app)) {
      const rel = relative(app, file)
      const before = join(original, rel)
      if (existsSync(before) && readFileSync(before, 'utf8') === readFileSync(file, 'utf8'))
        continue
      const dest = join(here, 'runs', arm, id, 'app', rel)
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(file, dest)
      process.stdout.write(`${arm}/${id}: ${rel}` + '\n')
    }
  }
}
