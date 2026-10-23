import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Project } from '@tessera/compiler/project'
import { scoreFiles, sumScores, type Score } from '../src'

// Scores the experiment in experiments/agent-mcp: for each arm (a folder of runs), each run holds the files a
// model wrote under app/, and every .tess file is checked as if it lived in the kitchen-sink app.
//
//   pnpm --filter @tessera/agent score
//
// runs/<arm>/<prompt id>/app/**/*.tess

const repo = fileURLToPath(new URL('../../..', import.meta.url))
const runsDir = process.argv[2]
  ? resolve(process.argv[2])
  : join(repo, 'experiments', 'agent-mcp', 'runs')
const fallback = join(repo, 'examples', 'kitchen-sink')

function tessFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return tessFiles(path)
    return name.endsWith('.tess') ? [path] : []
  })
}

if (!existsSync(runsDir)) {
  console.error(`No runs at ${runsDir}.`)
  process.exit(1)
}

const report: Record<string, { total: Score; prompts: Record<string, Score> }> = {}
for (const arm of readdirSync(runsDir)) {
  const prompts: Record<string, Score> = {}
  for (const run of readdirSync(join(runsDir, arm))) {
    const base = join(runsDir, arm, run)
    // A run is checked inside its own working copy (the app plus everything the model added), so its pages find
    // its components and its links find its pages. Without a working copy, the kitchen-sink app stands in.
    const work = join(runsDir, '..', 'work', arm, run)
    const project = new Project(existsSync(work) ? work : fallback, {})
    const files = tessFiles(base).map((path) => ({
      path: join(project.root, relative(base, path)).replaceAll('\\', '/'),
      source: readFileSync(path, 'utf8'),
    }))
    prompts[run] = scoreFiles(project, files)
  }
  report[arm] = { total: sumScores(Object.values(prompts)), prompts }
}
console.log(JSON.stringify(report, null, 2))
