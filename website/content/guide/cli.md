# The command line

Introduced in v0.1 (Milestones 11 and 12b).

The `tessera` command comes with the `@pixelscriptio/tessera` package. It starts a project, runs it, checks it without bundling, and manages the accountability tools: the baseline, exemptions and the report. Run it with `npx tessera`, or through the scripts a new project has (`npm run dev`).

Every command runs in the nearest folder above the current one that looks like a project (it has `app/`, `system/components/` or a `tessera.config.ts`). Pass `--root <folder>` to name one.

## Start a project

```bash
mkdir my-app
cd my-app
npm init -y
npm install @pixelscriptio/tessera@latest
npx tessera init
npm run dev
```

`init` writes the app (`main.ts`, a default layout, an index page) and, per the preset, the design system. In a terminal it asks which preset; `--preset tailwind` or `--preset unstyled` answers the question, and with neither it uses `tailwind`. See [Starter presets](/guide/presets).

It works in an empty folder or beside an existing `package.json`: it adds the scripts (`dev`, `build`, `preview`, `check`) and the dependency, never overwrites a file, and lists what it left alone. Run it twice and the second run changes nothing.

`npm create @pixelscriptio/tessera@latest my-app` does the same thing in a new folder, through the `@pixelscriptio/create-tessera` package, with no prior install.

## `tessera add`

```bash
npx tessera add Button
npx tessera add Accordion --as MyAccordion
npx tessera add tokens:tailwind
npx tessera add --list
```

Copies a component, or a set of design tokens, from [Tessera UI](/guide/tessera-ui) into the project. Flags: `--as <Name>`, `--replace`, `--diff`, `--install`, `--yes`, `--list` (with `--json`) and `--from <address or folder>`. What happens when the name is taken, what comes with a component and what `add` will and will not write are on the [Tessera UI](/guide/tessera-ui#add-a-component) page.

## `tessera dev`, `build` and `preview`

`tessera build --prerender` also renders the pages that have no parameters to HTML after the build. See [Prerendering](/guide/pages-and-routing#prerendering).

```bash
npx tessera dev
npx tessera build
npx tessera preview
```

These run the app with no configuration files. The CLI supplies the Vite config (with the Tessera plugin) and the HTML page, so a new project has no `vite.config.ts` and no `index.html`. Add either to the project and yours is used instead: a project that has its own `vite.config.ts` registers the plugin itself, and one with its own `index.html` keeps its own page.

`dev` starts two servers and prints both addresses: the app (port 5173, or the next free one; `--port <n>` chooses) and the [docs of the design system](/guide/docs-app) beside it, on the next free port (`--docs-port <n>` chooses). The docs update by themselves when a component in `system/` or `app/`, a token or a `.docs.md` file changes, including a file you add while it runs. To start only the app, set `docs: false` in `tessera.config.ts`. `build` does not build the docs; `tessera docs --static` does that.

`build` writes `dist/`, with each page as its own chunk. `preview` serves it, to check it locally.

## `tessera check`

Runs every validation without bundling, and exits non-zero on any error, so it is the command for CI.

```text
ERROR  T2102  app/components/Card.tess:6:12
  13px is not on the spacing scale.
  Did you mean "$space.3" (12px)?
  Run `tessera explain T2102` for details.

1 error, 0 warnings in 14 files.
```

It does what a build does, with the same code: the tokens build, each `.tess` file (contract, template, style rules, contrast, links, layouts), route conflicts, and auto-imports used in a plain `.ts` file. Per-path severity and the baseline are applied.

- `--fix` applies the fixes that are unambiguous (an exact value match to one token, or a typo with one candidate) and never changes how the default theme renders. A fix can reveal the next problem, so it runs again until nothing more applies. A value with no exact token is suggested, not changed.
- `--json` prints the result for tools.

## Adopting Tessera in an existing app: `tessera baseline`

```text
tessera baseline
```

records today's violations per file and per rule in `tessera.baseline.json`. Commit it. From then on `check` and builds fail only on violations beyond the recorded counts, so a legacy app starts with zero errors and fails on one new violation.

- Counts can only go down. Fixing a violation leaves room in the file's count, and `check` tells you the baseline can be lowered.
- `tessera baseline --prune` lowers the counts to what files have now. It never raises one.
- Contract errors are never baselined: a component without a valid contract is an error whatever the baseline says.
- A path exempted by `severity` in `tessera.config.ts` has nothing to record.

## `tessera lint`

Checks the CSS of any project, with or without Tessera, against your design tokens. See [Linting any project](/guide/lint).

## `tessera a11y`

Sets up the [generated accessibility tests](/tutorial/10-accessibility): a test file in `system/components` and `app/components`, a Vitest browser-mode configuration if there is none, the dev dependencies and a `test:a11y` script. It installs nothing: it ends with the three commands to run. It never overwrites a file, and with an existing Vitest configuration it says what to add instead of changing it.

In a project with several [design systems](/guide/presets#design-systems-in-system), the tests run in the active one. `--system all` writes them to run in every system, each axe check once per system and named after it ("Unstyled design system"), so a system whose colors fail contrast shows up as failing tests; `--system <name>` runs in one. A test file that is already there is not changed: delete it and run the command again.

## `tessera elements`

Builds the design system as custom elements, with React wrappers and types, so teams that do not use Tessera can use it. See [The design system as custom elements](/guide/elements).

## `tessera report`

```text
Styles (what declarations contain, not what is imported)
  72 declarations: 46 use a token (64%), 3 write a value by hand
  app/components    20/30 tokenized (67%), 0 by hand
raw() escapes: 1
  app/components/Card.tess:6  13px  "legacy modal spacing"  expires 2027-03-01
...
```

It measures what styles contain, not how many files import something: the tokenized versus hand-written declaration ratio in total and per directory, every `raw()` with its file, line, reason and expiry (expired ones are flagged), every severity exemption with its expiry, remaining baseline debt, contract coverage (components without a contract are named), where generated accessibility suites exist, and who still uses a deprecated component. `--json` prints the same data for CI.

The accessibility line says suites are _present_ in a component's folder, not that they pass: run your tests for that.

## `tessera tokens build`

Resolves the design tokens and writes `tokens.css`, `tokens.d.ts` and `manifest.json` to `.tessera/tokens` (or `--out <folder>`). It exits 1 with the diagnostics if the tokens do not build.

## `tessera explain`

Every error and warning has a code, and every code has a page in the [error reference](/reference/errors/). `tessera explain` prints the same explanation in the terminal, so it works offline:

```bash
tessera explain T2102
```

```text
T2102  Raw value off the token scale

Cause
  A governed property (spacing, radius, font size, opacity, motion, shadow) has a value that is not on the token scale.

Fix
  Use the nearest scale step the hint names, or `raw(value, "reason", "expiry")` for a one-off.
...
```

It prints the cause, an example that produces the code and the fix. The examples are run by the test suite, so each one really produces its code. A code that does not exist gets the nearest real one as a suggestion. The full command list is in the [CLI reference](/reference/cli).

## Scaffolding

```text
tessera new component UserCard
tessera new page blog/[slug]
```

- `new component` writes `app/components/UserCard.tess` with a valid starter contract. Component names are global, so a name another component has is refused.
- `new page` writes `app/pages/blog/[slug].tess`. It refuses a path that would conflict with an existing route (naming both files) or that cannot be a route.

To copy a component from [Tessera UI](/guide/tessera-ui) into the project, use `tessera add`.

## How it looks

In a terminal the command line has a look: the commands are grouped in `tessera help`, `tessera check` shows each problem with the line it is on and a caret under the column, `tessera init` asks its question with the arrow keys, and results are marked with a check or a cross. Everything else is the same text as before, and a pipe, a file or CI gets exactly that plain text, with no color and no symbols.

- `tessera <command> --help` (or `tessera help <command>`) says what a command does and lists its options. `tessera --version` prints the version.
- `--no-color` or the `NO_COLOR` environment variable keeps the layout and drops the color. `FORCE_COLOR=1` turns the look on where there is no terminal.
- Terminals that cannot draw the symbols (an old Windows console) get ASCII ones.
- Mistyped commands are met with a suggestion: `tessera chek` asks if you meant `check`.

## `tessera.config.ts`

```ts
export default {
  tokens: 'system/tokens',
  contracts: 'optional',
  severity: [
    {
      files: 'app/legacy/**',
      rules: '*',
      level: 'warn',
      reason: 'old screens',
      expires: '2027-01-01',
    },
  ],
}
```

The Vite plugin and the CLI both read it, so a build and `tessera check` agree. Options passed to `tessera()` in `vite.config.ts` win over the file. Besides the style fields (`governed`, `contrast`, `primitives`, `autoImports`, `severity`), it takes `contracts`, `tokens` and `baseline` (a path, relative to the project).
