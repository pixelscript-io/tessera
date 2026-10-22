/** Where a command reads and writes, so tests can run commands without a terminal. */
export interface Io {
  cwd: string
  out(text: string): void
  err(text: string): void
}

export const processIo = (): Io => ({
  cwd: process.cwd(),
  out: (text) => void process.stdout.write(text + '\n'),
  err: (text) => void process.stderr.write(text + '\n'),
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
