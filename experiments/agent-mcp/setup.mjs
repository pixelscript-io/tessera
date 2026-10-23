import process from 'node:process'
// Makes the clean working copies the experiment's models write into:
//   node experiments/agent-mcp/setup.mjs
// work/<arm>/<prompt id>/ holds a copy of the kitchen-sink app (pages, layouts, components, main.ts, data) and
// nothing generated: no .tessera folder, AGENTS.md or llms.txt. Tokens and system components are found by walking
// up to the repository's system/ folder, as in the real app.
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..', '..', 'examples', 'kitchen-sink', 'app')
const prompts = JSON.parse(readFileSync(join(here, 'prompts.json'), 'utf8'))
rmSync(join(here, 'work'), { recursive: true, force: true })
for (const arm of ['without', 'with']) {
  for (const { id } of prompts) {
    const dest = join(here, 'work', arm, id, 'app')
    mkdirSync(dest, { recursive: true })
    for (const dir of ['components', 'layouts', 'pages', 'data'])
      cpSync(join(app, dir), join(dest, dir), { recursive: true })
    cpSync(join(app, 'main.ts'), join(dest, 'main.ts'))
  }
}
process.stdout.write(
  `Made ${prompts.length * 2} working copies in experiments/agent-mcp/work.` + '\n',
)
