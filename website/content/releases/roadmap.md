# Roadmap

What exists is in [Releases](/releases/). This page lists what does not, in the order it is planned, so you know what not to rely on.

## Next

- **The design-system docs app** (`@tessera/docs`): generated from your contracts and tokens, with live previews, token pages and the coverage overview, and a static export.
- **Interchange.** `tessera tokens import` and `export` for strict DTCG, and adapters for Tokens Studio and Penpot.
- **Versioning tools.** `tessera diff`, codemods for renames, and a deprecation window.

## Later

- More behaviors and components: `toggle`, `disclosure`, dialog and combobox.
- A global store and data-fetching layer.
- An in-browser playground, versioned docs and a hosted site. The compiler core is browser-safe so the playground does not need a rewrite.
- Type-checking of templates (`tessera check --types`) and source maps.

## Not planned for v0.x

Server rendering, hydration and islands; a backend framework; native mobile targets; a visual editor or Figma plugin; nested routes, route guards and data loaders. See [What is Tessera?](/introduction/).

## What is deferred, and what that means for the docs

- The tutorial is static snippets with a check at the end of each step; the interactive version waits for the playground.
