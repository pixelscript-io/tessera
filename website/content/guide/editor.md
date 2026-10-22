# Editor support

Introduced in v0.1 (Milestone 5).

## VS Code

The extension in `packages/editor/vscode` provides syntax highlighting, inline diagnostics and contract completion. It is not published yet; run it from this repository:

```bash
pnpm build
code --extensionDevelopmentPath=packages/editor/vscode examples/kitchen-sink
```

Diagnostics come from the same compiler as the CLI and the Vite plugin, so a message in the editor reads like the one in your terminal:

```text
ERROR  T4008  app/seeded/Broken.tess:15:20
  Counter.tone has no value "primry".
  Did you mean "primary"?
  Run `tessera explain T4008` for details.
```

The editor checks:

- the contract, the template and the script (everything the compiler checks);
- `$token.path` references in `<style>` against the tokens it finds by walking up to a `system/tokens` folder. Other style rules arrive in Milestone 6.

In the `<contract>` block, completions offer field names, ARIA roles, behaviors and the parts you declared.

## Other editors

The TextMate grammar (`packages/editor/vscode/syntaxes/tess.tmLanguage.json`) works anywhere that reads TextMate grammars. The contract JSON Schema is `packages/contract/contract.schema.json`.

## Prettier

The Prettier plugin formats every block with the right tool: the contract with the JSONC parser, the script with TypeScript, the style with CSS. The template is only re-indented: Prettier's HTML parser lowercases component tags (`<Button>` becomes `<button>`) and reflows text, so Tessera's formatter keeps your line breaks and changes only indentation, trailing whitespace and runs of blank lines.

```json
{ "plugins": ["@tessera/editor/prettier"] }
```

A block that does not parse is left exactly as written.

## Type-checking templates

Not built yet. A spike (recorded in the project's decisions log) showed that TypeScript can check the compiler's output, and what is missing: mapping errors back to template positions, and types for the props of other components.
