import { main as tessera } from '@tessera/cli'

/** `pnpm create tessera my-app` is `tessera init my-app`, so newcomers need no global install. */
export function main(argv: string[]): Promise<number> {
  return tessera(['init', ...argv])
}
