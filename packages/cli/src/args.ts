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
  'docs-port',
  'as',
  'from',
  'fit',
  'map',
  'system',
  'preset',
  'starter',
  'prefix',
  'tokens',
  'var-prefix',
  'name',
  'format',
  'to',
  'version',
  'stdin-filepath',
  'url',
  'component',
  'file',
  'node',
  'from-json',
])

/** `tessera check --fix --root app` becomes positional `[]` and flags `fix`, `root=app`. */
export function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined]
      const value =
        inline !== undefined
          ? inline
          : WITH_VALUE.has(name) && i + 1 < argv.length
            ? argv[++i]!
            : true
      // `--map a=b --map c=d` is the same as `--map a=b,c=d`.
      const before = flags.get(name)
      flags.set(
        name,
        name === 'map' && typeof before === 'string' && typeof value === 'string'
          ? `${before},${value}`
          : value,
      )
    } else positional.push(arg)
  }
  return { positional, flags }
}

export const flag = (args: Args, name: string): string | true | undefined => args.flags.get(name)
export const has = (args: Args, name: string): boolean => args.flags.has(name)
