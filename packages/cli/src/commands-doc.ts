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
    usage: 'tessera init [folder] [--preset tailwind|none]',
    summary: 'Start a project, in an empty folder or beside an existing package.json',
    details:
      'Writes the app (a layout, an index page, `main.ts`) and, per the preset, the design system. `tailwind` writes a full `system/` built from the default theme of Tailwind (every color, the spacing scale, radii, type, shadows, easing and more as tokens, light and dark themes, three components) and a styled index page. `none` writes no tokens, themes or components, and example files with the examples commented out. In a terminal it asks which preset; `--preset` answers it, and with neither it uses `tailwind`. It adds the scripts (`dev`, `build`, `preview`, `check`) and the dependency to an existing `package.json`, never overwrites a file, and lists what it left alone.',
    options: [
      { flag: '--preset <name>', description: 'tailwind or none. Skips the question.' },
      {
        flag: '--link <folder>',
        description:
          'For working on Tessera itself: depend on this checkout of the package instead of the published version.',
      },
    ],
  },
  {
    name: 'dev',
    usage: 'tessera dev [--port <n>]',
    summary: 'Run the app with hot updates',
    details:
      'Starts the dev server with no configuration files: the CLI supplies the Vite config (with the Tessera plugin) and the HTML page. A project that has its own `vite.config.ts` or `index.html` uses them instead.',
    options: [
      {
        flag: '--port <n>',
        description: 'The port to serve on. Default 5173, or the next free one.',
      },
    ],
  },
  {
    name: 'build',
    usage: 'tessera build',
    summary: 'Build the app for production into dist/',
    details:
      'Builds with the same zero-configuration setup as `tessera dev`. Each page is its own chunk.',
  },
  {
    name: 'preview',
    usage: 'tessera preview [--port <n>]',
    summary: 'Serve the production build',
    details: 'Serves `dist/`, the output of `tessera build`, to check it locally.',
    options: [{ flag: '--port <n>', description: 'The port to serve on.' }],
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
    name: 'docs',
    usage: 'tessera docs [--port <n>] [--static [--out <folder>]]',
    summary: 'Documentation for your design system, generated from its contracts and tokens',
    details:
      'Runs a documentation app for the project: a page for every component (description, a live preview with a control for each variant, the variant, part, state, slot and event tables, usage examples, the tokens its styles use and the source), a page for every token group (the value in every theme after aliases are followed, with swatches and specimens), a contrast table, and an overview with the coverage report that `tessera report` prints (also downloadable as JSON). Theme and density switchers are always visible. Nothing is written by hand: add a component with a valid contract and it appears, with its controls, without a restart. A `Name.docs.md` beside a component adds guidance prose, and a fenced `tess live` block in it runs as a real example. `--static` writes a folder of plain files (default `docs-dist`) that any file server can host.',
    options: [
      { flag: '--port <n>', description: 'The port to serve on.' },
      { flag: '--static', description: 'Write static files instead of serving.' },
      {
        flag: '--out <folder>',
        description: 'With --static, where to write. Default `docs-dist`.',
      },
    ],
  },
  {
    name: 'format',
    usage: 'tessera format [files...] [--check] [--stdin-filepath <file>]',
    summary: 'Format .tess files with Prettier, in any editor or in CI',
    details:
      'Formats the `.tess` files of the project (or the files you name) with Prettier and the Tessera plugin, so formatting does not depend on an editor extension. Each block is formatted with the right tool: the contract as JSONC, the script as TypeScript, the style as CSS; the template is only re-indented. It uses the Prettier installed in the project and its Prettier configuration, and says how to install Prettier if the project has none. With `--check` it changes nothing and exits 1 if any file is not formatted.',
    options: [
      {
        flag: '--check',
        description: 'Report unformatted files and exit 1 instead of changing them.',
      },
      {
        flag: '--stdin-filepath <file>',
        description:
          'Read one file from standard input and write the formatted text to standard output, for an editor that formats a buffer through an external command.',
      },
    ],
  },
  {
    name: 'diff',
    usage:
      'tessera diff <git-ref> [--to <git-ref>] [--changelog [--version <v>]] [--json] [--fail-on-breaking]',
    summary: 'What changed in the design system since a git ref, and what breaks',
    details:
      'Compares the contracts and tokens in the working tree (or at `--to`) with another version, and classifies each change. **Breaking**: a removed or renamed component, variant, value, part, state, slot, event, token or theme; a changed role, behavior or default; a changed token type; a value change that flips a contrast result in any theme; and one that moves a token past its neighbour in a scale. **Additive**: something new, or newly deprecated. **Cosmetic**: any other token value change. A rename a codemod can apply says so. The ref is read without touching the working tree or the index.',
    options: [
      { flag: '--to <ref>', description: 'Compare with this ref instead of the working tree.' },
      { flag: '--changelog', description: 'Print a changelog section in Markdown.' },
      { flag: '--version <v>', description: 'With --changelog, the heading for the section.' },
      { flag: '--json', description: 'Print the changes as JSON.' },
      { flag: '--fail-on-breaking', description: 'Exit 1 if any change is breaking, for CI.' },
    ],
  },
  {
    name: 'codemod',
    usage: 'tessera codemod [--write] [--json]',
    summary: 'Update every use of a component, variant value or token that was renamed',
    details:
      'Reads the renames the design system declares (`renamedFrom` on a component or a token, `renamedValues` on a contract) and rewrites the project to match: component tags and explicit imports, static variant values on the tags of the component and in its own style selectors, and token references in styles and in other token files. Without `--write` it only lists the changes. It reads the lexical blocks it can name and reports, as needing a hand, a computed value that still mentions an old one. The declarations themselves are never changed. A component whose contract is not valid (its name does not match its file, say) is not loaded, so a rename it declares cannot be read: the codemod lists it as skipped and exits 1, never "nothing to do".',
    options: [
      { flag: '--write', description: 'Apply the changes. Without it nothing is written.' },
      { flag: '--json', description: 'Print the changes as JSON.' },
    ],
  },
  {
    name: 'tokens import',
    usage:
      'tessera tokens import <file or folder...> [--format dtcg|tokens-studio] [--out <folder>] [--force]',
    summary: 'Bring in tokens from DTCG, a Resolver document, Tokens Studio or Penpot',
    details:
      'Reads tokens another tool wrote and writes Tessera token files: strict DTCG 2025.10 files, a DTCG Resolver document (its default context becomes the base, its other contexts become themes, and the files it names are read for you), or a Tokens Studio or Penpot export (a single file, or the multi-file layout with `$themes.json`). The format is detected unless `--format` says. Values from earlier drafts and from tools that write strings (`"#ff0000"`, `"16px"`) become the strict forms. Aliases are kept as aliases. What Tessera cannot represent (a gradient, a typography composite, a math expression) is skipped, reported as T1016 and kept under `$extensions.tessera.skipped`, so `export` puts it back. The result is built before anything is written, and nothing is written if it has errors. It never overwrites a file: use `--out` for a new folder, or `--force`.',
    options: [
      { flag: '--format <name>', description: 'dtcg or tokens-studio. Detected when left out.' },
      {
        flag: '--out <folder>',
        description: "Where to write. Default: the project's tokens folder (`system/tokens`).",
      },
      { flag: '--force', description: 'Replace token files that already exist.' },
    ],
  },
  {
    name: 'tokens export',
    usage: 'tessera tokens export [--format dtcg|tokens-studio] [--out <folder>]',
    summary: 'Write the tokens as strict DTCG or as Tokens Studio sets',
    details:
      'Writes the project tokens for other tools. `dtcg` (the default) writes strict DTCG 2025.10 token files and `tessera.resolver.json`, a Resolver document with the base as a set and each attribute (`theme`, `density`) as a modifier with a context per theme. `tokens-studio` writes one file per set, `$themes.json` and `$metadata.json`, with colors and dimensions as the strings that plugin reads. Aliases are never flattened.',
    options: [
      { flag: '--format <name>', description: 'dtcg (default) or tokens-studio.' },
      {
        flag: '--out <folder>',
        description: 'Where to write. Default `.tessera/export/<format>`.',
      },
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
  {
    name: 'manifest',
    usage: 'tessera manifest',
    summary: 'Write the manifest AI tools read: components, tokens, routes, rules',
    details:
      'Writes `.tessera/manifest.json` (every component with its contract and usage examples, every token with its tier and its value in every theme, the routes and the rules the compiler enforces) and `.tessera/custom-elements.json`, the same components in the `custom-elements.json` format that editors and component tooling read. `tessera dev` and `tessera build` keep the manifest current, so this is for CI and for tools that run before a build.',
  },
  {
    name: 'mcp',
    usage: 'tessera mcp',
    summary: 'Run a read-only MCP server so AI tools can look up and check code',
    details:
      'Starts a Model Context Protocol server on standard input and output. A client lists and searches components, fetches a component contract, lists tokens by role, resolves a raw value to the nearest token, and validates a snippet with the compiler, getting the same errors as `tessera check`. It never writes a file. Configure a client with the command `npx tessera mcp`.',
  },
  {
    name: 'agent-files',
    usage: 'tessera agent-files [--force]',
    summary: 'Generate AGENTS.md and llms.txt for AI coding tools',
    details:
      'Writes `AGENTS.md` (the rules for working in this project, and its components) and `llms.txt` from the manifest, and refreshes `.tessera/manifest.json`. A file that exists and was not generated by Tessera is left alone.',
    options: [
      { flag: '--force', description: 'Replace AGENTS.md and llms.txt even if you wrote them.' },
    ],
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
