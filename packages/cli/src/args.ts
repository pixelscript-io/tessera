export interface Args {
  positional: string[]
  flags: Map<string, string | true>
}

/** Flags that take a value; every other `--flag` is a switch. */
const WITH_VALUE = new Set([
  'out',
  'root',
  'link',
  'port',
  'preset',
  'prefix',
  'format',
  'to',
  'version',
  'stdin-filepath',
])

/** `tessera check --fix --root app` becomes positional `[]` and flags `fix`, `root=app`. */
export function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined]
      if (inline !== undefined) flags.set(name, inline)
      else if (WITH_VALUE.has(name) && i + 1 < argv.length) flags.set(name, argv[++i]!)
      else flags.set(name, true)
    } else positional.push(arg)
  }
  return { positional, flags }
}

export const flag = (args: Args, name: string): string | true | undefined => args.flags.get(name)
export const has = (args: Args, name: string): boolean => args.flags.has(name)
