import { ALL_CODES, explainText } from '@tessera/compiler'
import { nearest } from '@tessera/contract'
import type { Args } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import type { Ui } from '../ui'

/** `tessera explain <code>`: the cause, an example and the fix for an error or warning code. Works offline. */
export async function explain(args: Args, io: Io): Promise<number> {
  const [code] = args.positional
  if (!code) {
    throw new CliError('Say which code to explain.', 'tessera explain T2102')
  }
  const text = explainText(code)
  if (!text) {
    const close = nearest(code.toUpperCase(), Object.keys(ALL_CODES))
    throw new CliError(
      `There is no error or warning code "${code}".`,
      close ? `Did you mean ${close}?` : 'Codes look like T2102 or W4101.',
    )
  }
  io.out(io.ui ? render(io.ui, text) : text)
  return 0
}

/** An explanation as a person reads it: the code and title first, then each section under a heading. */
function render(ui: Ui, text: string): string {
  const lines = text.split('\n')
  let section = ''
  return lines
    .map((line, i) => {
      if (i === 0) {
        const [code, ...title] = line.split(/\s{2,}/)
        return `${ui.accent(ui.bold(code!))}  ${ui.bold(title.join('  '))}`
      }
      if (/^[A-Z][a-z]+$/.test(line)) {
        section = line
        return ui.heading(line)
      }
      if (section === 'Example') return ui.dim(line)
      if (section === 'Fixed') return ui.green(line)
      return line
    })
    .join('\n')
}
