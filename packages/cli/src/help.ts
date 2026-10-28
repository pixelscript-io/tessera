import { COMMANDS_DOC, GLOBAL_OPTIONS, helpText, type CommandDoc } from './commands-doc'
import { plainUi, type Ui } from './ui'
import { VERSION } from './version'

/** The commands, in the order a person meets them. */
const GROUPS: Array<{ title: string; commands: string[] }> = [
  { title: 'Start', commands: ['init', 'dev', 'build', 'preview'] },
  {
    title: 'Check',
    commands: ['check', 'lint', 'a11y', 'baseline', 'report', 'explain', 'diff', 'codemod'],
  },
  {
    title: 'Tokens and components',
    commands: [
      'tokens build',
      'tokens import',
      'tokens export',
      'new component',
      'new page',
      'format',
    ],
  },
  { title: 'Data', commands: ['api import'] },
  { title: 'Docs and AI tools', commands: ['docs', 'elements', 'manifest', 'mcp', 'agent-files'] },
]

const nameOf = (c: CommandDoc) => c.usage.replace(/^tessera /, '')

/** What a command is called in a list: its name, then its arguments dimmed if they are short. The rest is in its own help. */
function label(ui: Ui, command: CommandDoc): string {
  const words = nameOf(command).split(' ')
  const nameWords = command.name.split(' ').length
  const name = words.slice(0, nameWords).join(' ')
  const tail = words.slice(nameWords).join(' ')
  return ui.accent(name) + (tail && tail.length <= 18 ? ' ' + ui.dim(tail) : '')
}

/** `tessera help`: the commands, grouped. Plain when there is no terminal. */
export function renderHelp(ui: Ui | undefined): string {
  if (!ui) return helpText()
  const docs = new Map(COMMANDS_DOC.map((c) => [c.name, c]))
  const out: string[] = [
    ui.banner(`Tessera ${VERSION}`, 'The design-system-first frontend framework'),
    '',
    ui.heading('Usage'),
    `  ${ui.bold('tessera')} <command> [options]`,
  ]
  const shown = new Set<string>()
  for (const group of GROUPS) {
    const rows = group.commands
      .map((n) => docs.get(n))
      .filter((c): c is CommandDoc => !!c)
      .map((c) => {
        shown.add(c.name)
        // `tokens` has three subcommands: name them all on its row.
        return [label(ui, c), c.summary]
      })
    out.push('', ui.heading(group.title), ui.columns(rows))
  }
  const rest = COMMANDS_DOC.filter((c) => !shown.has(c.name))
  if (rest.length)
    out.push('', ui.heading('More'), ui.columns(rest.map((c) => [label(ui, c), c.summary])))
  out.push(
    '',
    ui.heading('Options'),
    ui.columns(GLOBAL_OPTIONS.map((o) => [ui.cyan(o.flag), o.description])),
    '',
    ui.dim(`Run ${ui.bold('tessera <command> --help')} for what a command does and its options.`),
    '',
  )
  return out.join('\n')
}

/** `tessera help <command>` and `tessera <command> --help`. Undefined if there is no such command. */
export function renderCommandHelp(name: string, ui: Ui | undefined): string | undefined {
  const command = COMMANDS_DOC.find((c) => c.name === name)
  if (!command) return undefined
  const u = ui ?? plainUi
  const out: string[] = [
    ui
      ? `${u.accent(u.bold('tessera ' + command.name))}  ${u.dim(command.summary)}`
      : `tessera ${command.name}: ${command.summary}`,
    '',
    u.heading('Usage'),
    `  ${command.usage}`,
    '',
    u.heading('What it does'),
    u.wrap(command.details.replaceAll('`', ''), 2),
  ]
  if (command.options?.length) {
    out.push(
      '',
      u.heading('Options'),
      u.columns(command.options.map((o) => [u.cyan(o.flag), o.description])),
    )
  }
  if (command.exit) out.push('', u.heading('Exit codes'), u.wrap(command.exit, 2))
  out.push('')
  return out.join('\n')
}
