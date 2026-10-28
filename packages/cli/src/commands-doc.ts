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
    usage: 'tessera init [folder] [--starter todo|page|blank] [--tokens tailwind|none]',
    summary: 'Start a project, in an empty folder or beside an existing package.json',
    details:
      'Writes `main.ts`, a Button and a Card in `system/components`, `tessera.config.ts` naming the design system, and the starter app you choose: `todo` (a to-do list that adds, ticks off, filters and removes, kept in the browser and the address, with its state in `app/state/todos.ts`), `page` (a layout, and an index page with a button that counts and a list from an API call, to show what Tessera does) or `blank` (one empty page and no layout). It also writes the tokens you choose, in `system/<name>/tokens`: `tailwind` is built from the default theme of Tailwind (every color, the spacing scale, radii, type, shadows, easing and more, with light and dark themes), and `none` has the same token names with plain values (black on white, square corners, no shadows) for making the design yourself. In a terminal it asks the two questions, the starter app first; `--starter` and `--tokens` answer them, and with neither and no terminal it uses `page` and `tailwind` and says so. `--preset tailwind|unstyled` is the older spelling of `--tokens`. It adds the scripts (`dev`, `build`, `preview`, `check`) and the dependency to an existing `package.json`, never overwrites a file, and lists what it left alone. It also writes the files an AI coding tool reads: `AGENTS.md` (the rules and how a Tessera app is written), `llms.txt`, `CLAUDE.md` (which imports `AGENTS.md`) and `.mcp.json` (which starts `tessera mcp`).',
    options: [
      { flag: '--starter <name>', description: 'todo, page or blank. Skips the question.' },
      { flag: '--tokens <name>', description: 'tailwind or none. Skips the question.' },
      {
        flag: '--preset <name>',
        description: 'The older spelling of --tokens: tailwind, unstyled or none.',
      },
      {
        flag: '--link <folder>',
        description:
          'For working on Tessera itself: depend on this checkout of the package instead of the published version.',
      },
    ],
  },
  {
    name: 'add',
    usage:
      'tessera add <Name...> [--as <Name>] [--replace] [--diff] [--fit add|set|skip] [--map a=b] [--install] [--from <source>]',
    summary: 'Copy a component or a set of tokens from Tessera UI into the project',
    details:
      'Copies what you name into your project, where it is yours to edit: a component goes to `system/components` (with its docs file), a token set (`tokens:tailwind`, `tokens:unstyled`, `tokens:tessera`) to `system/<name>/tokens`. Components it needs (an Accordion needs AccordionItem) come with it, unless your project already has one with that name, which is kept. If the name is taken, in a terminal it asks whether to replace yours, keep yours and add the new one under another name, or cancel, naming which is yours and which is new; without a terminal it stops and says to use `--replace` or `--as`. A component that imports an npm package (Icon needs `lucide`) is told what to install, or installed with `--install`. It refuses a component that needs a newer `@pixelscriptio/tessera` than the project has. What it installed is recorded in `tessera.lock.json`. Only `.tess`, `.docs.md` and `.ts` files in `system/components`, and token files in `system/<name>/tokens`, are ever written; nothing from a registry can write anywhere else. `tessera add --list` shows what the registry has (`--json` for tools). Nothing is run from what it downloads. Before a component is written, it compares the tokens the new components use with each design system in the project, and reports which are missing and which have the wrong type (a radius that is a color); in a terminal it asks how to fix it, otherwise it names the flags. Afterwards it runs the check on the new components.',
    options: [
      {
        flag: '--as <Name>',
        description:
          'Install under this name (a folder name for a token set). Works with one item.',
      },
      {
        flag: '--replace',
        description: 'Overwrite your component or token files of the same name.',
      },
      {
        flag: '--diff',
        description: 'Write nothing: show how your copy differs from the registry’s.',
      },
      {
        flag: '--fit <add|set|skip>',
        description:
          'Token fit. add: put the missing tokens, with the reference set’s values, in tessera-ui.tokens.json in each design system (the dark values go in its dark theme). set: install the whole reference set (tokens:tailwind) as another design system. skip: do not compare.',
      },
      {
        flag: '--map <from=to>',
        description:
          'Use your token in place of one the component uses, for example color.action.primary.bg=color.brand.bg. Repeat it, or separate pairs with commas.',
      },
      { flag: '--install', description: 'Run npm install for the packages the component needs.' },
      {
        flag: '--yes',
        description:
          'Never ask: a name that is taken stops the command unless --replace or --as says what to do.',
      },
      { flag: '--list', description: 'List what the registry has, and which of it is installed.' },
      { flag: '--json', description: 'With --list, print JSON.' },
      {
        flag: '--from <source>',
        description:
          'Where to read from: an address, a folder of a published registry (has index.json), or a folder of components such as packages/ui. Default https://tessera-ui.pixelscript.io.',
      },
    ],
  },
  {
    name: 'dev',
    usage: 'tessera dev [--port <n>] [--docs-port <n>] [--mock]',
    summary: 'Run the app and its design system docs with hot updates',
    details:
      "Starts two servers, each on its own port, and prints both addresses: the app, and the docs of the design system (a page for every component and token, generated from your contracts and tokens). The docs update by themselves when a component in `system/` or `app/` or a token changes, including a file you add while it runs. Set `docs: false` in `tessera.config.ts` to start only the app. With the CLI's own setup there are no configuration files: it supplies the Vite config (with the Tessera plugin) and the HTML page. A project that has its own `vite.config.ts` or `index.html` uses them instead.",
    options: [
      {
        flag: '--port <n>',
        description: 'The port for the app. Default 5173, or the next free one.',
      },
      {
        flag: '--docs-port <n>',
        description:
          'The port for the docs. Default: the one after the app’s, or the next free one.',
      },
      {
        flag: '--mock',
        description:
          'Answer every API that has a description (app/apis/<name>.api.json) from that description, with made-up data, so a page can be built before the server exists. Add ?mock=error, ?mock=empty, ?mock=loading or ?mock=slow to a page’s address to see those states. Only in the dev server; a build never mocks.',
      },
    ],
  },
  {
    name: 'build',
    usage: 'tessera build [--prerender]',
    summary: 'Build the app for production into dist/',
    details:
      'Builds with the same zero-configuration setup as `tessera dev`. Each page is its own chunk. With `--prerender`, every page that has no parameters is also rendered to HTML after the build: `/` is `index.html`, `/about` is `about/index.html`, and the not-found page is `404.html`, each with its content, styles and title, so it shows at once and a search engine reads it. A page that names the data it needs (`data` in its `<page>` block) is written with that data in it, and when the script loads the page is hydrated: the elements that are there are kept, so what the person did while it loaded is not lost. A page whose declared data could not be fetched is not written, and is named with the reason. A route with a parameter (`/blog/[slug]`) is skipped, and so is a page that cannot be rendered outside a browser (its script reads `window`); each is named with the reason and still works as before.',
    options: [
      {
        flag: '--prerender',
        description: 'Render the pages that have no parameters to HTML after the build.',
      },
    ],
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
    name: 'lint',
    usage: 'tessera lint [paths...] [--tokens <folder>] [--fix] [--json]',
    summary: 'Check the CSS of any project against your design tokens',
    details:
      "The style rules of `tessera check`, on the CSS of any project, with or without Tessera components. It reads `.css` files and the `<style>` of `.vue`, `.svelte`, `.astro` and `.html` files (not Sass, Less or Stylus), with design tokens as custom properties such as `var(--t-space-4)`, and reports raw values that are off the token scale (with the nearest token), colors that are not tokens, `var()` names that are not tokens (with the one meant), tokens of the wrong kind for a property, primitive tokens used directly, deprecated tokens, and text and background token pairs that fail contrast in any theme. Tokens come from DTCG files: `--tokens <folder>`, the `tokens` of `tessera.config.ts`, or `system/tokens`. The config's `governed`, `contrast`, `primitives` and per-path `severity` (with a reason and an expiry) apply, `--fix` applies the unambiguous fixes, and `--baseline` records today's violations in `tessera.lint-baseline.json` so existing code can adopt the rules and only new violations fail. With no paths it lints the project folder, skipping `node_modules`, build output and dot folders. Exits 1 if there is any error.",
    options: [
      { flag: '--tokens <folder>', description: 'The DTCG token files to check against.' },
      {
        flag: '--var-prefix <prefix>',
        description:
          'The prefix of the custom properties that are tokens, if your build names them differently. Default `--t-`.',
      },
      { flag: '--fix', description: 'Apply the fixes that are unambiguous.' },
      { flag: '--baseline', description: "Record today's violations, so only new ones fail." },
      {
        flag: '--prune',
        description: 'Lower the baseline to what files have now. Never raises it.',
      },
      { flag: '--json', description: 'Print the result as JSON.' },
    ],
  },
  {
    name: 'a11y',
    usage: 'tessera a11y [--system <name|all>]',
    summary: 'Set up the generated accessibility tests',
    details:
      'Sets up the accessibility tests Tessera generates from your contracts: a test file in each components folder (`system/components`, `app/components`) that asks for them, a Vitest browser-mode configuration if the project has none, the dev dependencies (`vitest` 4 or newer, `@vitest/browser-playwright`, `playwright`, `axe-core`) and a `test:a11y` script in `package.json`. Components that need data to be shown, such as a combobox, get example options. It never overwrites a file, and it does not install anything: it ends with the commands to run. The tests run in a real browser. Set `TESSERA_A11Y_CHANNEL=msedge` (or `chrome`) to use one that is already installed. With several design systems in `tessera.config`, the tests run in the active one; `--system all` writes them to run in every system (each axe run once per system, named after it), and `--system <name>` in one. A test file that is already there is not changed: delete it and run this again.',
    options: [
      {
        flag: '--system <name|all>',
        description:
          'Run the tests in this design system, or in every system in `tessera.config`. Default: the active system.',
      },
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
    usage: 'tessera docs [--port <n>] [--edit] [--static [--out <folder>]]',
    summary: 'Documentation for your design system, generated from its contracts and tokens',
    details:
      'Runs a documentation app for the project: a page for every component (description, a live preview with a control for each variant, the variant, part, state, slot and event tables, usage examples, the tokens its styles use and the source), a page for every token group (the value in every theme after aliases are followed, with swatches and specimens), a contrast table, and an overview with the coverage report that `tessera report` prints (also downloadable as JSON). Theme and density switchers are always visible. Nothing is written by hand: add a component with a valid contract and it appears, with its controls, without a restart. A `Name.docs.md` beside a component adds guidance prose, and a fenced `tess live` block in it runs as a real example. `--static` writes a folder of plain files (default `docs-dist`) that any file server can host. An Export page offers the tokens as DTCG or Tokens Studio files, as a zip or one by one. `--edit` adds a page to bring in a token export, each change validated by the compiler first, on this computer only.',
    options: [
      { flag: '--port <n>', description: 'The port to serve on.' },
      {
        flag: '--edit',
        description:
          'Let the docs bring in a token export (the Export page needs no flag): the change is previewed and checked by the compiler first. Local only, behind a key printed at startup.',
      },
      { flag: '--static', description: 'Write static files instead of serving.' },
      {
        flag: '--out <folder>',
        description: 'With --static, where to write. Default `docs-dist`.',
      },
    ],
  },
  {
    name: 'elements',
    usage: 'tessera elements [--out <folder>] [--prefix <p>] [--all]',
    summary: 'Build the design system as custom elements, with React wrappers',
    details:
      "Builds the design system's components (the ones in `system/components`) as standard custom elements, so teams that do not use Tessera can use the system from any framework or from plain HTML. The folder is self-contained: `elements.js` has the elements and the runtime they need, `elements.css` has the design tokens (with their themes) and the components' styles, `react.js` and `react.d.ts` wrap each element as a React component (no JSX, no build step), `elements.d.ts` has the types, `custom-elements.json` is the manifest editors and docs tools read, and `README.md` says how to use it. Variants and props are attributes and properties, what a component emits is a DOM event with its payload in `detail`, and slots are children. Tags are `<t-button>`, `<t-accordion-item>`: the prefix, a hyphen and the name in kebab case.",
    options: [
      { flag: '--out <folder>', description: 'Where to write. Default `dist-elements`.' },
      {
        flag: '--prefix <p>',
        description: 'The tag prefix: lowercase letters and digits. Default `t`, so `<t-button>`.',
      },
      { flag: '--all', description: 'Build the components in app/components too.' },
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
    name: 'api import',
    usage: 'tessera api import <file or web address> [--name <name>] [--force]',
    summary: 'Describe an API from its OpenAPI file, so calls on it are checked',
    details:
      'Reads an OpenAPI 3 description (JSON, from a file or a web address) and writes the small description the compiler checks calls against, `app/apis/<name>.api.json`: the endpoints with their parameters, body and answer, and the named types. It also writes `app/apis/<name>.ts` (the API itself, with its base URL) if there is not one. After that a call on it in a `.tess` script, such as `name.get("/path")`, is checked: an endpoint the description does not have (T5006), a parameter it does not take (T5007), and in a template a field the answer does not have (T5008). What the importer does not read (`oneOf`, `anyOf`, a body that is not JSON) is listed and typed as unknown. It never overwrites a description without `--force`, and it says what a new import changes: what is removed or now needs a value (breaking), and what is new (additive). YAML is not read: convert it to JSON first.',
    options: [
      {
        flag: '--name <name>',
        description: 'The name of the API in scripts. Default: made from the title in the file.',
      },
      { flag: '--force', description: 'Replace a description that already exists.' },
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
  {
    flag: '--no-color',
    description:
      'Print without color. The color is off anyway when the output is not a terminal, and when NO_COLOR is set.',
  },
  { flag: '--help, -h', description: 'Say what a command does and what its options are.' },
  { flag: '--version, -v', description: 'Print the version.' },
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
