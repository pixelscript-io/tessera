# The design system docs

Introduced in v0.1 (Milestone 15).

A design system is only used if people can find out what is in it. `tessera docs` runs a documentation app for your project that is generated from the same contracts and tokens the compiler enforces, so it cannot drift from the code and nothing in it is written by hand.

```bash
npx tessera docs
```

It serves on port 5173 (or the next free one). Add `--port <n>` to choose.

## What is generated

**A page for every component.** Description, role, behavior and version; a live preview of the real component with a control for each variant, a switch for `disabled` when the contract has that state, a field for the default slot's content, and a log of the events it fires; a toggle that outlines its parts. Under it, the variants (with defaults), the parts you may style, the states, slots and events, the contrast pairs the contract declares, usage examples, the tokens its styles use, any `raw()` escapes, whether a generated accessibility suite covers it, and its source.

**A page for every token group.** Each token with its type, tier and description, and its value in every theme and density after aliases are followed, with the alias it came from. Colors have swatches, dimensions a bar, shadows and fonts a specimen. A filter narrows the list. A **Contrast** page measures text tokens on the backgrounds they are used with (`color.text.*` on `color.surface.*`, and the `text` and `bg` of a group such as `color.action.primary`) in every theme, against the minimum the project enforces.

**An overview with the coverage report.** The same numbers as `tessera report`: contract coverage, the share of style declarations that use tokens (by directory), `raw()` escapes with reasons and expiry, exemptions, baseline debt, where generated accessibility suites exist, and deprecated components in use. **Download report.json** gives the report as JSON.

**Theme and density switchers**, always visible, for every attribute your themes define. Choosing one renders every preview in that theme. (The token tables already show every theme side by side.)

It is live. The app reads your components and tokens when it loads, and when you add, remove or change a component, a token file or a `.docs.md` file, the page reloads with the new data. Add a component with a valid contract and it appears, with its controls, without restarting anything and without writing another file.

::: tip What the accessibility section says
It says whether a generated suite covers the component. It does not say the suite passes: running the tests does that. The page also lists what automation cannot check (screen reader announcement quality, label and content quality, focus order in context, reduced motion).
:::

## Adding prose and real examples

Put a `Name.docs.md` beside a component and its content appears on the component's page, under the preview. It is for what a contract cannot say: when to use the component, when not to, how it should read.

```text
# Using Button

Use a button for an **action**, and a link to go somewhere.

- Say what happens: "Save changes", not "OK".

(a fenced block with the info string `tess live` goes here)
```

A fenced block whose info string is `tess live` is a `.tess` file (a template, with a script or style if you like) that runs on the page, with your real components and tokens, above its own source. A snippet that does not compile shows its error in place of the example.

The Markdown it understands is small on purpose: headings, paragraphs, lists, block quotes, fenced code, and inline code, emphasis, strong and links. Everything is escaped, so prose cannot inject markup.

## A static export

```bash
npx tessera docs --static
```

writes `docs-dist` (change it with `--out <folder>`): an `index.html`, one JavaScript module with the components it previews in chunks beside it, a stylesheet, all with relative URLs, and routing by `#` so no server rewrite rule is needed. Any file server can host it. It is the same app with the data compiled in, so the coverage report is a snapshot of the day you exported.

## Editing

The docs are read-only, with one exception for tokens. The **Export** page offers the tokens as files for a design tool (DTCG or Tokens Studio), as a zip or one by one. `tessera docs --edit` adds **Bring in tokens**: a token export from the design tool, previewed and checked by the compiler before it is saved. See [Tokens in the design system docs](/guide/system-manager).

## What it does not do yet

- It does not run the accessibility suites. That is the test runner's job, and a result in the docs would be a copy of one run.
- It can force a variant or a `disabled` state but not `:hover`, `:focus-visible` or `:pressed`, which belong to the browser.
- It does not use your own `vite.config.ts`: it runs its own configuration with the Tessera plugin, because it is not your app.
- A change to a component reloads the page, not just the preview. Hot updates of the preview are possible and not built.

## Related

- [The command line](/guide/cli)
- [Contracts](/guide/contracts)
- [Tokens](/guide/tokens)
