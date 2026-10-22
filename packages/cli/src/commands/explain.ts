import { ALL_CODES, explainText } from '@tessera/compiler'
import { nearest } from '@tessera/contract'
import type { Args } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'

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
  io.out(text)
  return 0
}
