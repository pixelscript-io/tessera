import { createInterface } from 'node:readline/promises'
import process from 'node:process'

/** Where a command reads and writes, so tests can run commands without a terminal. */
export interface Io {
  cwd: string
  out(text: string): void
  err(text: string): void
  /**
   * Ask the person to pick one of `choices` (the first is the default). Only present when there is a terminal
   * to ask in; a command that needs an answer takes a flag for it and falls back to its default without one.
   */
  choose?(question: string, choices: Array<{ value: string; label: string }>): Promise<string>
}

export const processIo = (): Io => ({
  cwd: process.cwd(),
  out: (text) => void process.stdout.write(text + '\n'),
  err: (text) => void process.stderr.write(text + '\n'),
  ...(process.stdin.isTTY && process.stdout.isTTY
    ? {
        async choose(question, choices) {
          const rl = createInterface({ input: process.stdin, output: process.stdout })
          try {
            const lines = choices.map(
              (c, i) => `  ${i + 1}. ${c.label}${i === 0 ? ' (default)' : ''}`,
            )
            for (;;) {
              const answer = (await rl.question(`${question}\n${lines.join('\n')}\n> `)).trim()
              if (answer === '') return choices[0]!.value
              const byNumber = choices[Number(answer) - 1]
              if (byNumber) return byNumber.value
              const byName = choices.find((c) => c.value === answer.toLowerCase())
              if (byName) return byName.value
              process.stdout.write(
                `Please enter 1 to ${choices.length}, or a name from the list.\n`,
              )
            }
          } finally {
            rl.close()
          }
        },
      }
    : {}),
})

/** A command failed in a way the user should read; the message is printed and the exit code is 1. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
  }
}
