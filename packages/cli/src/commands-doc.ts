/** What each command is, written once: the help text and the generated CLI reference both read this. */
export interface CommandDoc {
  name: string
  usage: string
  summary: string
  details: string
  options?: Array<{ flag: string; description: string }>
  /** The exit codes that mean something beyond 0 and 1. */
  exit?: string
}

export const COMMANDS_DOC: CommandDoc[] = [
  {
    name: 'init',
    usage: 'tessera init [folder]',
    summary: 'Scaffold a project',
    details:
      'Writes a project that runs: a Vite config, `system/` with the base tokens and the light, dark and compact themes, one `Button`, and an `app/` with `main.ts`, a default layout and `pages/index.tess`. It refuses a folder that already has a `package.json`, `app/`, `system/` or `vite.config.ts`, and changes nothing. Until packages are published, dependencies are `link:` paths to the checkout the CLI came from.',
    options: [
      {
        flag: '--link <folder>',
        description:
          'Link dependencies to this checkout of Tessera instead of the one the CLI runs from.',
      },
    ],
  },
  {
    name: 'check',
    usage: 'tessera check [--fix] [--json]',
    summary: 'Run every validation; exit 1 on errors',
    details:
      'Runs what a build runs, without bundling: the tokens build, every `.tess` file (contract, template, style rules, contrast, links, layouts), route conflicts, and auto-imports used in plain `.ts` files. Per-path severity and the baseline are applied. Exits 1 if there is any error; warnings never fail.',
    options: [
      {
        flag: '--fix',
        description:
          'Apply the fixes that are unambiguous (an exact match to one token, or a typo with one candidate). Never changes how the default theme renders.',
      },
      { flag: '--json', description: 'Print the result as JSON.' },
    ],
  },
  {
    name: 'baseline',
    usage: 'tessera baseline [--prune]',
    summary: 'Record (or lower) existing violations so old code can adopt Tessera',
    details:
      "Records today's violations per file and per rule in `tessera.baseline.json`. With a baseline, `check` and builds fail only on violations beyond the recorded counts. Contract errors are never baselined.",
    options: [
      {
        flag: '--prune',
        description: 'Lower the recorded counts to what files have now. Never raises a count.',
      },
    ],
  },
  {
    name: 'report',
    usage: 'tessera report [--json]',
    summary: 'Tokenized/raw ratio, raw() uses, exemptions, baseline debt, coverage',
    details:
      'Measures what styles contain: the tokenized versus hand-written declaration ratio in total and per directory, every `raw()` with its reason and expiry, severity exemptions, remaining baseline debt, contract coverage, where generated accessibility suites exist, and usage of deprecated components.',
    options: [{ flag: '--json', description: 'Print the report as JSON, for CI.' }],
  },
  {
    name: 'tokens build',
    usage: 'tessera tokens build [--out <folder>]',
    summary: 'Resolve tokens and write CSS, types and a manifest',
    details:
      'Resolves the design tokens and writes `tokens.css`, `tokens.d.ts` and `manifest.json`. Exits 1 with the diagnostics if the tokens do not build.',
    options: [
      { flag: '--out <folder>', description: 'Where to write. Default `.tessera/tokens`.' },
    ],
  },
  {
    name: 'new component',
    usage: 'tessera new component <Name>',
    summary: 'Scaffold a component with a starter contract',
    details:
      'Writes `app/components/<Name>.tess` with a valid contract. Names are PascalCase and global, so a name another component has is refused.',
  },
  {
    name: 'new page',
    usage: 'tessera new page <path>',
    summary: 'Scaffold a page, such as blog/[slug]',
    details:
      'Writes `app/pages/<path>.tess`. It refuses a path that would conflict with an existing route (naming both files) or that cannot be a route.',
  },
  {
    name: 'eject',
    usage: 'tessera eject <Name> <NewName>',
    summary: 'Copy a system component into app/components as your own',
    details:
      'Copies a system component under a new name and records `forkedFrom` (the component and the version) in its contract, so owning a copy never means silent drift.',
  },
  {
    name: 'explain',
    usage: 'tessera explain <code>',
    summary: 'The cause, an example and the fix for an error or warning code',
    details:
      'Prints the same explanation as the error reference, from the error registry. Works offline.',
  },
]

export const GLOBAL_OPTIONS = [
  {
    flag: '--root <folder>',
    description: 'Run in this project instead of the nearest one above the current folder.',
  },
]

/** The text `tessera help` prints. */
export function helpText(): string {
  const width = Math.max(...COMMANDS_DOC.map((c) => c.usage.length)) + 2
  return [
    'tessera: the Tessera command line',
    '',
    'Usage: tessera <command> [options]',
    '',
    'Commands:',
    ...COMMANDS_DOC.map(
      (c) => `  ${c.usage.replace(/^tessera /, '').padEnd(width - 8)}${c.summary}`,
    ),
    '',
    'Options:',
    ...GLOBAL_OPTIONS.map((o) => `  ${o.flag.padEnd(width - 8)}${o.description}`),
    '',
  ].join('\n')
}
