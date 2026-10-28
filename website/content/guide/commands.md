# Every command

The `tessera` command comes with the `@pixelscriptio/tessera` package. This page names every command, says what it is for and when to reach for it, and shows the one form you will use most. For the complete list of options of a command, see the [command reference](/reference/cli), which is generated from the same text as `tessera help`. The [command line guide](/guide/cli) explains how the commands fit together on a day of work.

## How to run a command

In a project that has Tessera installed, `npm run dev`, `npm run build`, `npm run preview` and `npm run check` are set up for you, and any other command is `npx tessera <command>`. Where Tessera is not installed yet, write `npx @pixelscriptio/tessera <command>`: a bare `npx tessera` can download an unrelated package of that name.

Every command:

- runs in the nearest folder above the current one that looks like a project (it has `app/`, `system/components/` or a `tessera.config.ts`); `--root <folder>` names a project instead;
- exits with `0` when it worked and `1` when it found an error or could not do what you asked, so it can stop a script or a CI job;
- takes `--no-color` (the color is off anyway when the output is not a terminal, and when `NO_COLOR` is set), `--help` or `-h` (what the command does and its options), and `--version` or `-v` (the version, for `tessera` itself).

`tessera help` lists every command, and `tessera help <command>` explains one.

## At a glance

| Command                                           | What it is for                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`tessera init`](#tessera-init)                   | Start a project, in an empty folder or beside an existing `package.json`.      |
| [`tessera add`](#tessera-add)                     | Copy a component, or a set of tokens, from Tessera UI into the project.        |
| [`tessera dev`](#tessera-dev)                     | Run the app and the docs of its design system, with hot updates.               |
| [`tessera build`](#tessera-build)                 | Build the app for production, and optionally render its pages to HTML.         |
| [`tessera preview`](#tessera-preview)             | Serve the production build to check it locally.                                |
| [`tessera check`](#tessera-check)                 | Run every validation the build runs, without bundling.                         |
| [`tessera lint`](#tessera-lint)                   | Check the CSS of any project against your design tokens.                       |
| [`tessera baseline`](#tessera-baseline)           | Record today's violations so old code can adopt Tessera.                       |
| [`tessera report`](#tessera-report)               | Measure how much of the styling uses tokens, and what is exempted.             |
| [`tessera explain`](#tessera-explain)             | The cause, an example and the fix for an error or warning code.                |
| [`tessera format`](#tessera-format)               | Format `.tess` files with Prettier.                                            |
| [`tessera a11y`](#tessera-a11y)                   | Set up the accessibility tests generated from your contracts.                  |
| [`tessera tokens build`](#tessera-tokens-build)   | Resolve the tokens and write CSS, types and a manifest.                        |
| [`tessera tokens import`](#tessera-tokens-import) | Bring in tokens from DTCG, Tokens Studio or Penpot.                            |
| [`tessera tokens export`](#tessera-tokens-export) | Write the tokens as strict DTCG or as Tokens Studio sets.                      |
| [`tessera docs`](#tessera-docs)                   | Documentation for your design system, generated from its contracts and tokens. |
| [`tessera elements`](#tessera-elements)           | Build the design system as custom elements, with React wrappers.               |
| [`tessera diff`](#tessera-diff)                   | What changed in the design system since a git ref, and what breaks.            |
| [`tessera codemod`](#tessera-codemod)             | Update every use of something that was renamed.                                |
| [`tessera new component`](#tessera-new-component) | Scaffold a component with a starter contract.                                  |
| [`tessera new page`](#tessera-new-page)           | Scaffold a page, such as `blog/[slug]`.                                        |
| [`tessera api import`](#tessera-api-import)       | Describe an API from its OpenAPI file, so calls on it are checked.             |
| [`tessera manifest`](#tessera-manifest)           | Write the manifest AI tools read.                                              |
| [`tessera mcp`](#tessera-mcp)                     | Run a read-only MCP server so AI tools can look up and check code.             |
| [`tessera agent-files`](#tessera-agent-files)     | Generate `AGENTS.md` and `llms.txt` for AI coding tools.                       |

## Start and run a project

### `tessera init`

Starts a project. In an empty folder, or beside an existing `package.json`, it writes the app (`main.ts`, a layout, an index page, an API and a piece of shared state), `tessera.config.ts`, a Button and a Card in `system/components`, a design system in `system/<name>/tokens`, and the files an AI tool reads (`AGENTS.md`, `llms.txt`, `CLAUDE.md`, `.mcp.json`). It adds the scripts (`dev`, `build`, `preview`, `check`) and the dependency to an existing `package.json`, never overwrites a file, and lists what it left alone.

```bash
npx tessera init --preset tailwind
```

`--preset` is `tailwind` (every color, the spacing scale, radii, type and shadows of Tailwind's default theme, with a light and a dark theme) or `unstyled` (the same token names with plain values, for making the design yourself). In a terminal it asks. `npm create @pixelscriptio/tessera@latest my-app` runs it in a new folder with no prior install.

### `tessera add`

Copies a component, or a set of tokens, from the Tessera UI catalogue into your project, where it is yours to edit. A component goes to `system/components` with its docs file, and the components it uses come with it. Before it writes, it compares the tokens the component uses with your design systems and reports the ones that are missing or of the wrong type, and afterwards it runs the check on what it wrote. What it installed is recorded in `tessera.lock.json`, and the generated `AGENTS.md` and `llms.txt` are updated, if Tessera wrote them.

```bash
npx tessera add Button Dialog
npx tessera add tokens:tailwind
npx tessera add --list
```

If a name is taken, `--replace` replaces your copy and `--as <Name>` adds the new one under another name; `--diff` shows what would change. `--fit add`, `--fit set` and `--map from=to` decide how missing tokens are fixed. `--install` installs the npm packages a component needs, and `--from` reads a registry from a folder or another address. See [Tessera UI](/guide/tessera-ui) for all of it.

### `tessera dev`

Runs two servers, each on its own address, and prints both: the app, with hot updates, and the docs of the design system, which update by themselves when a component or a token changes. The port moves when one is busy, so use the address it prints.

```bash
npm run dev
```

`--port` sets the app's port and `--docs-port` the docs'. `docs: false` in `tessera.config.ts` starts only the app. When you change a token in the base that a theme sets for itself, it says so, because the theme keeps its own value. A project with its own `vite.config.ts` or `index.html` uses them.

### `tessera build`

Builds the app for production into `dist/`, with the same setup as `dev`. Each page is its own chunk.

```bash
npm run build
npx tessera build --prerender
```

With `--prerender`, every page that has no parameters is also rendered to HTML, so it shows at once and a search engine reads it. A page that names its data (`data` in its `<page>` block) is written with that data in it, and every prerendered page is hydrated when the script loads. See [Pages and routing](/guide/pages-and-routing) for what it does and does not render.

### `tessera preview`

Serves `dist/`, the output of `tessera build`, to check it locally. `--port` sets the port.

```bash
npm run preview
```

## Check and enforce

### `tessera check`

Runs what a build runs, without bundling: the tokens build, every `.tess` file (contract, template, style rules, contrast, links, layouts), route conflicts, and the names used in plain `.ts` files. Severity rules and the baseline are applied. It exits `1` if there is any error; warnings never fail. Run it after every change, and in CI.

```bash
npm run check
npx tessera check --fix
```

`--fix` applies the fixes that cannot change how the page looks. `--json` prints the result for a tool to read.

### `tessera lint`

The style rules of `check`, on the CSS of any project, with or without Tessera components. It reads `.css` files and the `<style>` of `.vue`, `.svelte`, `.astro` and `.html` files, with tokens as custom properties such as `var(--t-space-4)`, and reports raw values off the scale (with the nearest token), colors that are not tokens, tokens of the wrong kind for a property, and text and background pairs that fail contrast in any theme. See [Linting any project](/guide/lint).

```bash
npx tessera lint src --tokens design/tokens
```

### `tessera baseline`

Records today's violations, per file and per rule, in `tessera.baseline.json`. After that, `check` and builds fail only on violations beyond the recorded counts, so an old app can adopt Tessera and then improve. Contract errors are never baselined. `--prune` lowers the counts to what is left.

```bash
npx tessera baseline
```

### `tessera report`

Measures what the styles contain: the share of declarations that use tokens, in total and by directory, every `raw()` with its reason and expiry, severity exemptions, the baseline debt that remains, contract coverage, where accessibility suites exist, and uses of deprecated components. `--json` is for a dashboard or a CI step.

```bash
npx tessera report
```

### `tessera explain`

Prints the cause, an example and the fix for an error or warning code, the same text as the [error reference](/reference/errors/), from the compiler itself, so it works offline.

```bash
npx tessera explain T2107
```

### `tessera format`

Formats the `.tess` files of the project, or the files you name, with Prettier and the Tessera plugin, so formatting does not depend on an editor. The contract is formatted as JSONC, the script as TypeScript and the style as CSS; the template is re-indented. It uses the Prettier installed in the project. With `--check` it changes nothing and exits `1` if a file is not formatted, which is what CI wants; `--stdin-filepath` is for editors that call an external formatter.

```bash
npx tessera format
npx tessera format --check
```

### `tessera a11y`

Sets up the accessibility tests Tessera generates from your contracts: a test file in each components folder, a Vitest browser-mode configuration if there is none, the dev dependencies and a `test:a11y` script. It never overwrites a file and does not install anything: it ends with the commands to run. `--system all` runs them against every design system the project has. See [Accessibility](/tutorial/10-accessibility).

```bash
npx tessera a11y --system all
npm run test:a11y
```

## The design system

### `tessera tokens build`

Resolves the design tokens and writes `tokens.css`, `tokens.d.ts` and `manifest.json`, into the folder `--out` names. It exits `1` with the diagnostics if the tokens do not build. It is for a build step outside Tessera that needs the CSS.

```bash
npx tessera tokens build --out public/tokens
```

### `tessera tokens import`

Brings in tokens another tool wrote and writes Tessera token files: strict DTCG, a DTCG Resolver document, or a Tokens Studio or Penpot export. The format is detected unless `--format` says. Values from earlier drafts and from tools that write strings (`"#ff0000"`, `"16px"`) become the strict forms, and aliases stay aliases. What Tessera cannot represent (a gradient, a typography composite, a math expression) is skipped and reported. It writes nothing if the result does not build, and does not overwrite files without `--force`. See [Importing and exporting tokens](/guide/interchange).

```bash
npx tessera tokens import tokens-export.json --out system/brand/tokens
```

### `tessera tokens export`

Writes the project's tokens for other tools. `dtcg`, the default, writes strict DTCG files and a Resolver document; `tokens-studio` writes one file for each set with the strings that plugin reads. Aliases are never flattened.

```bash
npx tessera tokens export --format tokens-studio --out exports
```

### `tessera docs`

Runs a documentation app for your design system, generated from its contracts and tokens: a page for every component with a live preview and a control for each variant, a page for every token group with its value in every theme, a contrast table, and the coverage report. `tessera dev` runs it for you beside the app; this command runs it on its own. `--static` writes files any server can host, into `--out`. `--edit` adds a way to bring in tokens from a design tool (it listens on this computer only and needs a key). See [The design system docs](/guide/docs-app).

```bash
npx tessera docs --static --out docs-site
```

### `tessera elements`

Builds the components of `system/components` as standard custom elements, so teams that do not use Tessera can use your design system from any framework or from plain HTML. The folder it writes is self-contained: the elements and their runtime, the CSS with the tokens and themes, React wrappers, the types, a `custom-elements.json` and a README. `--prefix` sets the tag prefix and `--all` includes the components of `app/components`. See [Custom elements](/guide/elements).

```bash
npx tessera elements --out dist/elements
```

### `tessera diff`

Compares the contracts and tokens in your working tree (or at `--to`) with a git ref, and classifies each change. **Breaking** is a removed or renamed component, variant, value, part, state, slot, event, token or theme, a changed role or default, a changed token type, a value change that flips a contrast result, or one that moves a token past its neighbour in a scale. **Additive** is something new. **Cosmetic** is any other token value change. `--changelog` prints a release-notes section, `--json` is for tools, and `--fail-on-breaking` exits `1` for CI. See [Versioning and deprecation](/guide/design-systems/versioning).

```bash
npx tessera diff v1.2.0 --changelog
```

### `tessera codemod`

Rewrites the project to match the renames your design system declares (`renamedFrom` on a component or a token, `renamedValues` on a contract): component tags and imports, static variant values, and token references in styles and token files. Without `--write` it only lists the changes. A computed value that still mentions an old name is reported as needing a hand.

```bash
npx tessera codemod
npx tessera codemod --write
```

### `tessera new component`

Writes `app/components/<Name>.tess` with a valid contract to start from. Names are PascalCase and global, so a name another component has is refused.

```bash
npx tessera new component Chip
```

### `tessera new page`

Writes `app/pages/<path>.tess`. It refuses a path that would conflict with an existing route, naming both files, or that cannot be a route.

```bash
npx tessera new page blog/[slug]
```

## Data

### `tessera api import`

Reads an OpenAPI 3 description (JSON, from a file or a web address) and writes the small description the compiler checks calls against, `app/apis/<name>.api.json`, with the endpoints, their parameters, body and answer, and the named types. It also writes `app/apis/<name>.ts` if there is none. After that, a call such as `name.get('/path')` is checked: an endpoint the description lacks, a parameter it does not take, and a field a template reads that the answer does not have. `--name` names the API and `--force` replaces a description that exists. See [Fetching data](/guide/data).

```bash
npx tessera api import https://api.example.com/openapi.json --name example
```

## For AI coding tools

### `tessera manifest`

Writes `.tessera/manifest.json` (every component with its contract and usage examples, every token with its value in every theme, the routes, the APIs, the shared state and the rules the compiler enforces) and `.tessera/custom-elements.json`. `dev` and `build` keep it current, so this is for CI and for tools that run before a build.

```bash
npx tessera manifest
```

### `tessera mcp`

Starts a Model Context Protocol server on standard input and output, so an AI tool can list and search components, fetch a contract, list tokens, resolve a raw value to the nearest token, and validate a snippet with the compiler. It never writes a file. A new project's `.mcp.json` already starts it. See [AI coding tools](/guide/agents).

```bash
npx tessera mcp
```

### `tessera agent-files`

Writes `AGENTS.md` (the rules for working in the project, how a Tessera app is written, and its components, APIs and state) and `llms.txt` from the manifest. Run it after you add an API or a piece of state; `tessera add` does it for components. A file that exists and was not generated by Tessera is left alone unless you pass `--force`.

```bash
npx tessera agent-files
```

## Related

- [The command line](/guide/cli): how the commands fit together on a day of work.
- [Command reference](/reference/cli): every option of every command, generated from `tessera help`.
- [Configuration](/reference/config): `tessera.config.ts`.
