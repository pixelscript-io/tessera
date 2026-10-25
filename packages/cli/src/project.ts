import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { loadConfigFile, Project, type ProjectOptions } from '@tessera/compiler/project'
import { flag, type Args } from './args'
import { CliError } from './io'

const MARKERS = [
  'tessera.config.ts',
  'tessera.config.mjs',
  'tessera.config.js',
  join('app', 'pages'),
  join('app', 'components'),
  join('system', 'components'),
]

/** The project a command runs in: `--root`, else the nearest folder above the current one that looks like one. */
export function findProjectRoot(cwd: string, args: Args): string {
  const given = flag(args, 'root')
  if (typeof given === 'string') return resolve(cwd, given)
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (MARKERS.some((m) => existsSync(join(dir, m)))) return dir
    if (dirname(dir) === dir) break
  }
  throw new CliError(
    'This does not look like a Tessera project.',
    'Run this in a folder with app/ or system/, or pass --root <folder>. To start a new project, run: tessera init',
  )
}

/** Open the project in a folder, with its `tessera.config.ts` if it has one. */
export async function openProjectAt(
  root: string,
  overrides: ProjectOptions = {},
): Promise<Project> {
  const loaded = await loadConfigFile(root)
  return new Project(root, { ...loaded?.options, ...overrides })
}

/** Open a project with its `tessera.config.ts`, if it has one. */
export async function openProject(
  cwd: string,
  args: Args,
  overrides: ProjectOptions = {},
): Promise<Project> {
  return openProjectAt(findProjectRoot(cwd, args), overrides)
}
