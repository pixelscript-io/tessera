import { emitKeypressEvents } from 'node:readline'
import { createInterface as createPromptInterface } from 'node:readline/promises'
import process from 'node:process'
import type { Readable, Writable } from 'node:stream'
import { detectUi, type Ui } from './ui'

/** Where a command reads and writes, so tests can run commands without a terminal. */
export interface Io {
  cwd: string
  /** Raw streams, for the one command (`mcp`) that talks to another program instead of a person. */
  stdin?: Readable
  stdout?: Writable
  out(text: string): void
  err(text: string): void
  /**
   * How to look when a person is watching: color, symbols, aligned columns. Present only when the output is a terminal;
   * without it every command prints the plain text it always did.
   */
  ui?: Ui
  /**
   * Ask the person to pick one of `choices` (the first is the default). Only present when there is a terminal
   * to ask in; a command that needs an answer takes a flag for it and falls back to its default without one.
   */
  choose?(question: string, choices: Array<{ value: string; label: string }>): Promise<string>
  /** Ask for a line of text. Only present when there is a terminal to ask in. */
  ask?(question: string): Promise<string>
}

/** A stdin that can be read key by key. */
export type KeyInput = Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown }

/** A command was stopped by the person (Ctrl+C at a question). */
export class Cancelled extends Error {}

/** The question as numbered lines, for a terminal that cannot be read key by key. */
async function chooseByNumber(
  question: string,
  choices: Array<{ value: string; label: string }>,
  stdin: Readable,
  stdout: Writable,
): Promise<string> {
  const rl = createPromptInterface({ input: stdin, output: stdout })
  try {
    const lines = choices.map((c, i) => `  ${i + 1}. ${c.label}${i === 0 ? ' (default)' : ''}`)
    for (;;) {
      const answer = (await rl.question(`${question}\n${lines.join('\n')}\n> `)).trim()
      if (answer === '') return choices[0]!.value
      const byNumber = choices[Number(answer) - 1]
      if (byNumber) return byNumber.value
      const byName = choices.find((c) => c.value === answer.toLowerCase())
      if (byName) return byName.value
      stdout.write(`Please enter 1 to ${choices.length}, or a name from the list.\n`)
    }
  } finally {
    rl.close()
  }
}

/** `name: what it is` becomes the name in color and the rest dim. */
function styleChoice(ui: Ui, label: string): string {
  const split = label.indexOf(': ')
  return split < 0
    ? label
    : `${ui.accent(label.slice(0, split))}  ${ui.dim(label.slice(split + 2))}`
}

/**
 * Pick one of the choices with the arrow keys (or j and k, or a number), and Enter. The list is redrawn in place and
 * collapses to the answer when chosen. Ctrl+C stops with `Cancelled`.
 */
export function chooseByKeys(
  question: string,
  choices: Array<{ value: string; label: string }>,
  ui: Ui,
  stdin: KeyInput,
  stdout: Writable,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let index = 0
    let drawn = 0
    const draw = () => {
      if (drawn) stdout.write(`\u001b[${drawn}A\u001b[J`)
      const lines = [
        `${ui.accent('?')} ${ui.bold(question)} ${ui.dim('(arrow keys, then Enter)')}`,
        ...choices.map((c, i) =>
          i === index
            ? `  ${ui.accent(ui.unicode ? '❯' : '>')} ${styleChoice(ui, c.label)}`
            : `    ${ui.dim(c.label.split(': ')[0]!)}`,
        ),
      ]
      stdout.write(lines.join('\n') + '\n')
      drawn = lines.length
    }
    const finish = (value: string | undefined) => {
      stdin.off('keypress', onKey)
      stdin.setRawMode?.(false)
      stdin.pause()
      if (drawn) stdout.write(`\u001b[${drawn}A\u001b[J`)
      if (value === undefined) {
        reject(new Cancelled('Cancelled.'))
        return
      }
      const chosen = choices.find((c) => c.value === value)!
      stdout.write(`${ui.ok(ui.bold(question))} ${ui.accent(chosen.value)}\n`)
      resolve(value)
    }
    const onKey = (_text: string | undefined, key: { name?: string; ctrl?: boolean } = {}) => {
      if (key.ctrl && key.name === 'c') return finish(undefined)
      if (key.name === 'up' || key.name === 'k')
        index = (index + choices.length - 1) % choices.length
      else if (key.name === 'down' || key.name === 'j') index = (index + 1) % choices.length
      else if (key.name === 'return' || key.name === 'enter') return finish(choices[index]!.value)
      else if (/^[1-9]$/.test(_text ?? '') && choices[Number(_text) - 1]) index = Number(_text) - 1
      else return
      draw()
    }
    emitKeypressEvents(stdin)
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.on('keypress', onKey)
    draw()
  })
}

export const processIo = (): Io => {
  const interactive = !!(process.stdin.isTTY && process.stdout.isTTY)
  const ui = detectUi(process.env, process.stdout)
  return {
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
    out: (text) => void process.stdout.write(text + '\n'),
    err: (text) => void process.stderr.write(text + '\n'),
    ...(ui ? { ui } : {}),
    ...(interactive
      ? {
          choose: (question, choices) =>
            ui && typeof process.stdin.setRawMode === 'function'
              ? chooseByKeys(question, choices, ui, process.stdin, process.stdout)
              : chooseByNumber(question, choices, process.stdin, process.stdout),
          ask: async (question) => {
            const rl = createPromptInterface({ input: process.stdin, output: process.stdout })
            try {
              return await rl.question(`${question}
> `)
            } finally {
              rl.close()
            }
          },
        }
      : {}),
  }
}

/** A command failed in a way the user should read; the message is printed and the exit code is 1. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
  }
}
