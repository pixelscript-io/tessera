/**
 * Fails the docs build when a code sample is wrong or a link is broken. Every fenced block needs a language;
 * `xml tess` blocks are compiled against the kitchen-sink project (and must produce `error=CODE` if tagged),
 * `ts` blocks must parse and `json` blocks must be valid. Run by `pnpm --filter website build`.
 */
import process from 'node:process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Project } from '@tessera/compiler/project'
import { checkContent, formatProblems } from './checker'

const here = fileURLToPath(new URL('.', import.meta.url))
const content = join(here, '..', 'content')
const project = new Project(join(here, '..', '..', 'examples', 'kitchen-sink'), {
  today: '2026-10-22',
})

const problems = checkContent(content, { project })
if (problems.length) {
  console.error(
    `${problems.length} problem${problems.length === 1 ? '' : 's'} in the docs:\n\n${formatProblems(problems)}`,
  )
  process.exit(1)
}
console.log('Docs checked: every sample compiles and every link resolves.')
