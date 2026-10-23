import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Args } from '../args'
import { flag, has } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import { openProject } from '../project'

/** The project's own Prettier: it is the user's dependency, so a project without it is told how to get it. */
async function projectPrettier(root: string): Promise<any> {
  try {
    const found = createRequire(join(root, 'package.json')).resolve('prettier')
    const loaded = await import(pathToFileURL(found).href)
    // A CommonJS entry arrives with its API on `default`; an ES module entry has it on the namespace.
    return typeof loaded.format === 'function' ? loaded : loaded.default
  } catch {
    throw new CliError(
      'Prettier is not installed in this project.',
      'Install it with: npm install --save-dev prettier',
    )
  }
}

/**
 * `tessera format`: format `.tess` files with Prettier and the Tessera plugin, in any editor or in CI. It uses
 * the project's own Prettier and its Prettier configuration; with `--check` it changes nothing and exits 1 if a
 * file is not formatted.
 */
export async function format(args: Args, io: Io): Promise<number> {
  const project = await openProject(io.cwd, args)
  const prettier = await projectPrettier(project.root)
  // Loaded on demand: the plugin needs Prettier at import time, and no other command should.
  const plugin = await import('@tessera/editor/prettier')

  const pluginOptions = {
    parser: 'tess',
    plugins: [{ languages: plugin.languages, parsers: plugin.parsers, printers: plugin.printers }],
  }

  // `--stdin-filepath <file>`: read the file from standard input and write the result to standard output, which is
  // how an editor with an external-formatter setting (Zed, Helix, Vim) formats a buffer.
  const stdinPath = flag(args, 'stdin-filepath')
  if (typeof stdinPath === 'string') {
    if (!io.stdin || !io.stdout)
      throw new CliError('--stdin-filepath needs standard input and output.')
    let source = ''
    io.stdin.setEncoding('utf8')
    for await (const chunk of io.stdin) source += chunk
    // Only `.tess` is ours: any other file passes through unchanged, so an editor can point a whole language here.
    if (!stdinPath.endsWith('.tess')) {
      io.stdout.write(source)
      return 0
    }
    const file = resolve(io.cwd, stdinPath).replaceAll('\\', '/')
    const config = (await prettier.resolveConfig(file)) ?? {}
    try {
      io.stdout.write(
        await prettier.format(source, { ...config, filepath: file, ...pluginOptions }),
      )
    } catch (error) {
      throw new CliError(
        `Could not format ${stdinPath}.`,
        error instanceof Error ? error.message : String(error),
      )
    }
    return 0
  }

  const given = args.positional.map((p) => resolve(io.cwd, p).replaceAll('\\', '/'))
  const files = given.length ? given : project.files()
  const check = has(args, 'check')
  const unformatted: string[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const config = (await prettier.resolveConfig(file)) ?? {}
    let formatted: string
    try {
      formatted = await prettier.format(source, {
        ...config,
        filepath: file,
        ...pluginOptions,
      })
    } catch (error) {
      throw new CliError(
        `Could not format ${project.display(file)}.`,
        error instanceof Error ? error.message : String(error),
      )
    }
    if (formatted === source) continue
    unformatted.push(project.display(file))
    if (!check) writeFileSync(file, formatted)
  }

  for (const file of unformatted) io.out(file)
  if (check) {
    io.out(
      unformatted.length
        ? `\n${unformatted.length} ${unformatted.length === 1 ? 'file is' : 'files are'} not formatted. Run tessera format.`
        : `All ${files.length} files are formatted.`,
    )
    return unformatted.length ? 1 : 0
  }
  io.out(
    unformatted.length
      ? `\nFormatted ${unformatted.length} of ${files.length} files.`
      : `All ${files.length} files were already formatted.`,
  )
  return 0
}
