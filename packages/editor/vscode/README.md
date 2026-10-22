# Tessera for VS Code

Support for `.tess` files:

- Syntax highlighting for all five blocks (`<contract>`, `<script>`, `<template>`, `<style>`, `<page>`), with TypeScript in `<script>` and in template expressions, JSON with comments in `<contract>`, CSS in `<style>`, and `$token.path` and `raw()` highlighted in styles.
- Inline diagnostics from the Tessera compiler, with the same messages as the CLI: unknown variant values, unknown slots, events, components and tokens, root and part problems, and more, each with a "Did you mean" suggestion.
- Completions inside `<contract>`: field names (with descriptions), ARIA roles, behaviors, and declared parts in `contrast` pairings.

## Try it from this repository

```bash
pnpm install
pnpm build
code --extensionDevelopmentPath=packages/editor/vscode examples/kitchen-sink
```

Open `app/seeded/Broken.tess`. It has an unknown variant value (`tone="primry"`) and two unknown tokens, and each shows as an error with a suggestion. Edit a file under `system/tokens` and diagnostics refresh.

The extension is not packaged or published yet.

## How it is built

`src/extension.ts` is a thin layer over `@tessera/editor`, which holds the language service (`getDiagnostics`, `completeContract`). The grammar is `syntaxes/tess.tmLanguage.json`; other editors that read TextMate grammars can reuse it.
