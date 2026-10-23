import { main as tessera } from '@pixelscriptio/tessera/cli'

/** `npm create @pixelscriptio/tessera my-app` is `tessera init my-app`, so newcomers need no prior install. */
export function main(argv: string[]): Promise<number> {
  return tessera(['init', ...argv])
}
