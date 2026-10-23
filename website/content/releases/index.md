# Releases

This page records what each milestone of v0.1 delivered, newest first. A generated changelog from `tessera diff` (planned) will sit above the hand-written highlights once there is a version to compare.

## v0.1 (in progress)

- **Published:** `@pixelscriptio/tessera` and `@pixelscriptio/create-tessera` 0.1.0 are on npm.
- **Milestone 14: token interchange.** `tessera tokens export` writes strict DTCG 2025.10 with a Resolver document, or Tokens Studio sets; `tessera tokens import` reads those, plain DTCG files and Penpot exports, converts the string values older tools write, keeps aliases, reports (T1016) and keeps what Tessera cannot represent, and writes nothing if the result does not build. See [Importing and exporting tokens](/guide/interchange).
- **Milestone 13: agent-readable exports.** `.tessera/manifest.json` (components, tokens in every theme, routes, rules), `tessera mcp` (a read-only MCP server that lists and searches components, returns contracts, resolves a raw value to a token and validates a snippet with the compiler), `tessera agent-files` (AGENTS.md and llms.txt) and a `custom-elements.json` export. See [AI coding tools](/guide/agents).
- **Milestone 12b: one package and starter presets.** The framework is one package, `@pixelscriptio/tessera` (plus `@pixelscriptio/create-tessera` for `npm create`). `tessera dev`, `build` and `preview` need no config files. `tessera init` works beside an existing `package.json`, asks for a preset, and never overwrites a file: `tailwind` writes a full design system built from Tailwind's default theme with a styled index page, `none` writes no tokens and commented examples. Tested by installing the packed tarball into a clean folder and running both presets in a browser.

- **Milestone 12: documentation site.** This site: error reference with one page per code and `tessera explain`, generated references (API, CLI, config, contract, tokens), docs checked in CI (samples compiled, links resolved), tokens-driven theme, accessibility checks.
- **Milestone 11: CLI.** `tessera init`, `check` (with `--fix`), `baseline`, `report`, `tokens build`, `new`, `eject`, and `create-tessera`. `tessera.config.ts` is read by the plugin and the CLI.
- **Milestone 10: layouts.** `app/layouts/default.tess`, per-page `layout` and `false`, layouts that are kept between pages.
- **Milestone 9: pages and routing.** File-based routes, `<Link>`, `navigate()`, `useRoute()`, lazy pages, title, announcement, focus and scroll.
- **Milestone 8: auto-imports.** Components and script APIs resolved at compile time, `.tessera/components.d.ts`, hot updates.
- **Milestone 7: behaviors and accessibility tests.** The `press` behavior, a conformance suite, generated axe-core suites.
- **Milestone 6: styles and enforcement.** Tokens in styles, contrast in every theme, `raw()` with receipts, severity, the baseline and autofix.
- **Milestone 5: editor support.** TextMate grammar, language service, VS Code extension, Prettier plugin.
- **Milestone 4: the compiler.** `.tess` to a module, the Vite plugin, hot updates.
- **Milestone 3: contracts.** Parsing, validation, JSON Schema and derived types.
- **Milestone 2: tokens.** DTCG in, CSS out, themes and density.
- **Milestone 1: the runtime.** Signals, the renderer and the adapter interface.
- **Milestone 0: the repository.** Workspace, tests, lint, format and CI.

## Deprecations and upgrades

There are none yet. When there are, they are listed here with the version that deprecated each item, what replaces it, and an upgrade guide.

## Next steps

[The roadmap](/releases/roadmap).
