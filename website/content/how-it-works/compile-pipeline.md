# The compile pipeline

The compiler is a pure function from the text of a `.tess` file (plus what it needs to know about the project) to a TypeScript module, a block of CSS and a list of diagnostics. It uses no Node APIs, so it runs in a browser too; the Vite plugin and the CLI do the file access and pass everything in. They share one class, `Project`, so a build and `tessera check` run the same code.

## The steps

1. **Split into blocks.** `<contract>`, `<script>`, `<template>`, `<style>` and `<page>`, each at most once, with their offsets in the file so every error can point at a line and column ([T4001](/reference/errors/T4001)).
2. **Parse the contract.** A small JSON-with-comments parser that keeps the offset of every node, then validation of every field ([T3001](/reference/errors/T3001) to [T3013](/reference/errors/T3013)).
3. **Process the style.** A hand-written CSS parser reads the block. Each declaration is checked against the token manifest and the governed-property rules, `raw()` escapes are read, and contrast is computed for every combination of variant and state in every theme. The output is scoped CSS with token references as `var()`.
4. **Analyze the script.** The script is parsed with Acorn to find its bindings (which names are signals, functions, imports), the calls it makes, and what it emits.
5. **Parse the template.** A template parser (not an HTML parser, so component tags keep their case) produces a tree with every offset.
6. **Rewrite expressions.** Each `{ }` and directive is parsed as JavaScript and its names are resolved against the script's bindings: a top-level signal becomes a read of `.value`, an unknown name is [T4006](/reference/errors/T4006), a nested signal that would not unwrap is [T4012](/reference/errors/T4012).
7. **Generate code.** The template becomes calls into the renderer. Components the file uses get real `import` lines, resolved from the registry. A page also exports its `<page>` metadata.
8. **Plugin step.** The Vite plugin hands the result to esbuild to strip types, serves the CSS from its own request (`?tess&type=style&lang.css`), and adds hot-update support in development.

Errors from every step are collected, not thrown, and sorted by position, so one run reports everything it can. Code generation stops only for errors that leave nothing to run; style rule violations do not stop it, which is how a baseline can let a file with known violations still build.

## Not done yet

Source maps are not emitted, so an error in the browser points into generated code. Compile-time diagnostics still point at the right place in your file.

## Next steps

[The signals runtime](/how-it-works/signals).
