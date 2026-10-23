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

## Formatting

The Prettier plugin formats every block with the right tool: the contract with the JSONC parser, the script with TypeScript, the style with CSS. The template is only re-indented: Prettier's HTML parser lowercases component tags (`<Button>` becomes `<button>`) and reflows text, so Tessera's formatter keeps your line breaks and changes only indentation, trailing whitespace and runs of blank lines. A block that does not parse is left exactly as written.

The plugin ships in the package, and `tessera init` writes the configuration for it (unless the project already has Prettier configuration):

```json
{ "plugins": ["@pixelscriptio/tessera/prettier"] }
```

Prettier itself is yours to install:

```bash
npm install --save-dev prettier
npm run format
```

`npm run format` is `tessera format`, which formats the project's `.tess` files with the Prettier in the project and its configuration. It does not depend on any editor. `tessera format --check` changes nothing and exits 1 if a file is not formatted, which is what CI wants.

### In an editor

Any editor that runs the project's Prettier on save will format `.tess` files once the configuration above is there, provided the editor knows `.tess` is a language it should format. VS Code does, through the extension in this repository.

An editor that cannot run a Prettier plugin for a file type it does not know can call `tessera format` as an external formatter. With `--stdin-filepath` it reads the buffer from standard input and writes the result to standard output, the way editors expect:

```bash
npx tessera format --stdin-filepath app/components/Card.tess
```

For Zed, this is the setting to try in `settings.json`. It is written from Zed's documented external-formatter option and has **not** been tested in Zed, so check it against your Zed version:

```json
{
  "file_types": { "HTML": ["tess"] },
  "languages": {
    "HTML": {
      "formatter": {
        "external": {
          "command": "npx",
          "arguments": ["tessera", "format", "--stdin-filepath", "{buffer_path}"]
        }
      }
    }
  }
}
```

This treats `.tess` as HTML for highlighting, which is approximate. The command passes any file that is not `.tess` through unchanged, so your real HTML files are not touched, but it is a stopgap: a proper Zed language extension for `.tess` is not built.

## Type-checking templates

Not built yet. A spike (recorded in the project's decisions log) showed that TypeScript can check the compiler's output, and what is missing: mapping errors back to template positions, and types for the props of other components.
