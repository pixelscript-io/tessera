import { parseArgs, type Args } from './args'
import { a11y } from './commands/a11y'
import { add } from './commands/add'
import { agentFiles, manifest, mcp } from './commands/agent'
import { baseline } from './commands/baseline'
import { check } from './commands/check'
import { codemod } from './commands/codemod'
import { diff } from './commands/diff'
import { docs } from './commands/docs'
import { elements } from './commands/elements'
import { format } from './commands/format'
import { explain } from './commands/explain'
import { init } from './commands/init'
import { lint } from './commands/lint'
import { newCommand } from './commands/new'
import { report } from './commands/report'
import { build, dev, preview } from './commands/serve'
import { api } from './commands/api'
import { tokens } from './commands/tokens'
import { renderCommandHelp, renderHelp } from './help'
import { Cancelled, CliError, processIo, type Io } from './io'
import { createUi } from './ui'
import { VERSION } from './version'

type Command = (args: Args, io: Io) => Promise<number>

const COMMANDS: Record<string, Command> = {
  init,
  add,
  dev,
  build,
  preview,
  check,
  lint,
  a11y,
  baseline,
  report,
  tokens,
  api,
  new: newCommand,
  explain,
  docs,
  elements,
  diff,
  codemod,
  format,
  manifest,
  mcp,
  'agent-files': agentFiles,
}

export { COMMANDS_DOC, GLOBAL_OPTIONS, helpText, type CommandDoc } from './commands-doc'

const suggest = (word: string): string | undefined => {
  const distance = (x: string, y: string): number => {
    const row = Array.from({ length: y.length + 1 }, (_, i) => i)
    for (let i = 1; i <= x.length; i++) {
      let diagonal = row[0]!
      row[0] = i
      for (let j = 1; j <= y.length; j++) {
        const above = row[j]!
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (x[i - 1] === y[j - 1] ? 0 : 1))
        diagonal = above
      }
    }
    return row[y.length]!
  }
  const names = Object.keys(COMMANDS)
  const best = names.map((n) => [n, distance(word, n)] as const).sort((x, y) => x[1] - y[1])[0]
  return best && best[1] <= Math.max(2, Math.floor(word.length / 3)) ? best[0] : undefined
}

/** Run the CLI. Returns the exit code instead of exiting, so tests can call it. */
export async function main(argv: string[], io: Io = processIo()): Promise<number> {
  // `--no-color` keeps the layout of a terminal and drops the color.
  if (argv.includes('--no-color')) {
    argv = argv.filter((a) => a !== '--no-color')
    if (io.ui)
      io = { ...io, ui: createUi({ color: false, unicode: io.ui.unicode, width: io.ui.width }) }
  }
  const [command, ...rest] = argv
  if (command === '--version' || command === '-v') {
    io.out(VERSION)
    return 0
  }
  if (!command) {
    io.out(renderHelp(io.ui))
    return 1
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    const words = rest.filter((a) => !a.startsWith('-'))
    const about = words.join(' ')
    if (about) {
      const text = helpFor(words, io)
      if (!text) {
        io.err(failure(io, `There is no command "${about}".`, suggestion(about)))
        return 1
      }
      io.out(text)
      return 0
    }
    io.out(renderHelp(io.ui))
    return 0
  }
  const run = COMMANDS[command]
  if (!run) {
    io.err(
      failure(io, `Unknown command "${command}".`, suggestion(command)) +
        '\n\n' +
        renderHelp(io.ui),
    )
    return 1
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.out(helpFor([command, ...rest.filter((a) => !a.startsWith('-'))], io) ?? renderHelp(io.ui))
    return 0
  }
  try {
    return await run(parseArgs(rest), io)
  } catch (error) {
    if (error instanceof Cancelled) {
      io.err(io.ui ? io.ui.dim('Cancelled.') : 'Cancelled.')
      return 130
    }
    if (error instanceof CliError) {
      io.err(failure(io, error.message, error.hint))
      return 1
    }
    throw error
  }
}

/** Help for `tokens import` when that is a command of its own, else for `tokens`: the longest name that exists. */
function helpFor(words: string[], io: Io): string | undefined {
  for (let n = Math.min(words.length, 2); n >= 1; n--) {
    const text = renderCommandHelp(words.slice(0, n).join(' '), io.ui)
    if (text) return text
  }
  return undefined
}

const suggestion = (word: string): string | undefined => {
  const near = suggest(word)
  return near ? `Did you mean "${near}"?` : undefined
}

/** An error as a person reads it: a red mark, the message, and what to do about it. Plain without a terminal. */
function failure(io: Io, message: string, hint?: string): string {
  if (!io.ui) return message + (hint ? `\n  ${hint}` : '')
  const lines = [io.ui.fail(io.ui.bold(message))]
  if (hint) lines.push(`  ${io.ui.dim(hint)}`)
  return lines.join('\n')
}
