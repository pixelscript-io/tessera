import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildTokens, formatDiagnostic } from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import type { Args } from '../args'
import { flag } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import { openProject } from '../project'

/**
 * `tessera tokens build`: resolve the design tokens and write what other tools read: the CSS (custom
 * properties in layers, with the themes), a `.d.ts` of the token paths, and the manifest (every token with
 * its type, tier and value in each theme). Exit 1 if the tokens do not build.
 */
export async function tokens(args: Args, io: Io): Promise<number> {
  const [sub] = args.positional
  if (sub !== 'build') {
    throw new CliError(
      sub ? `Unknown tokens command "${sub}".` : 'Say what to do with the tokens.',
      'Available: tessera tokens build [--out <folder>]',
    )
  }
  const project = await openProject(io.cwd, args)
  const dir = project.tokensDir()
  if (!dir) {
    throw new CliError(
      'No design tokens found.',
      'Put *.tokens.json files in a "system/tokens" folder, or set "tokens" in tessera.config.ts.',
    )
  }
  const result = buildTokens(loadTokenDir(dir))
  if (!result.ok) {
    io.err(result.diagnostics.map(formatDiagnostic).join('\n\n'))
    return 1
  }
  const given = flag(args, 'out')
  const out =
    typeof given === 'string' ? resolve(io.cwd, given) : join(project.root, '.tessera', 'tokens')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'tokens.css'), result.css)
  writeFileSync(join(out, 'tokens.d.ts'), result.dts)
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n')
  const count = result.manifest!.tokens.length
  io.out(
    `Built ${count} tokens into ${project.display(out) || '.'}: tokens.css, tokens.d.ts, manifest.json.`,
  )
  return 0
}
