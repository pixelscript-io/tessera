import { parseArgs, type Args } from './args'
import { agentFiles, manifest, mcp } from './commands/agent'
import { baseline } from './commands/baseline'
import { check } from './commands/check'
import { codemod } from './commands/codemod'
import { diff } from './commands/diff'
import { docs } from './commands/docs'
import { eject } from './commands/eject'
import { explain } from './commands/explain'
import { init } from './commands/init'
import { newCommand } from './commands/new'
import { report } from './commands/report'
import { build, dev, preview } from './commands/serve'
import { tokens } from './commands/tokens'
import { helpText } from './commands-doc'
import { CliError, processIo, type Io } from './io'

type Command = (args: Args, io: Io) => Promise<number>

const COMMANDS: Record<string, Command> = {
  init,
  dev,
  build,
  preview,
  check,
  baseline,
  report,
  tokens,
  new: newCommand,
  eject,
  explain,
  docs,
  diff,
  codemod,
  manifest,
  mcp,
  'agent-files': agentFiles,
}

export { COMMANDS_DOC, GLOBAL_OPTIONS, helpText, type CommandDoc } from './commands-doc'

/** Run the CLI. Returns the exit code instead of exiting, so tests can call it. */
export async function main(argv: string[], io: Io = processIo()): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.out(helpText())
    return command ? 0 : 1
  }
  const run = COMMANDS[command]
  if (!run) {
    io.err(`Unknown command "${command}".\n\n${helpText()}`)
    return 1
  }
  try {
    return await run(parseArgs(rest), io)
  } catch (error) {
    if (error instanceof CliError) {
      io.err(error.message + (error.hint ? `\n  ${error.hint}` : ''))
      return 1
    }
    throw error
  }
}
