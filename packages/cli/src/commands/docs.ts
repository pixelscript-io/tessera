import { exportDocs, serveDocs } from '@tessera/docs'
import type { Args } from '../args'
import { flag, has } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import { findProjectRoot, openProject } from '../project'
import { buildReport } from './report'

/**
 * `tessera docs`: the design system's documentation, generated from the project's own contracts and tokens.
 * In dev it reads them live; `--static` writes a folder any file server can host.
 */
export async function docs(args: Args, io: Io): Promise<number> {
  const root = findProjectRoot(io.cwd, args)
  const report = (project: Parameters<typeof buildReport>[0]) => buildReport(project)
  if (has(args, 'static')) {
    const given = flag(args, 'out')
    const out = typeof given === 'string' ? given : 'docs-dist'
    await openProject(io.cwd, args)
    const { files } = await exportDocs(root, out, { report })
    io.out(
      `Exported the docs to ${out}: ${files.join(', ')}. Serve the folder with any file server.`,
    )
    return 0
  }
  const port = flag(args, 'port')
  if (port !== undefined && (typeof port !== 'string' || !/^\d+$/.test(port))) {
    throw new CliError(`"--port" needs a number, got ${String(port)}.`)
  }
  const edit = has(args, 'edit')
  const server = await serveDocs(root, {
    report,
    edit,
    ...(port ? { port: Number(port) } : {}),
  })
  if (edit && server.editUrl) {
    io.out('Editing is on. Open this address (it carries a key that is new each run):')
    io.out(`  ${server.editUrl}`)
    io.out(
      'Anyone who can open it on this computer can change the project files. The docs listen on this computer only.',
    )
  } else server.printUrls()
  await new Promise<void>((done) => server.httpServer?.on('close', done))
  return 0
}
