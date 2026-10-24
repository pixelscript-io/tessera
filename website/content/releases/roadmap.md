# Roadmap

What exists is in [Releases](/releases/). This page lists what does not, in the order it is planned, so you know what not to rely on.

## Next

- **A deprecation window** that the tooling enforces (`tessera diff` and the codemods exist; the window does not).
- **Token importers tested against real exports** from Figma, Tokens Studio and Penpot. The importers are tested on files written to the formats' documentation.
- **More behaviors and components:** menu, tabs, listbox and tooltip.
- **Hydration** for prerendered pages. `tessera build --prerender` writes static HTML today, and the router replaces it when the app starts.

## Later

- Vue and Svelte wrappers for the custom elements (React exists), and watching slot content for changes.
- Linting Sass, Less and Stylus, and a Stylelint plugin built on the same rules as `tessera lint`.
- A draft `.tess` generator from Figma components: variants, tokens and structure, not behavior.
- A Zed language extension.
- A global store and data-fetching layer.
- An in-browser playground and versioned docs. The compiler core is browser-safe so the playground does not need a rewrite.
- Type-checking of templates (`tessera check --types`) and source maps.

## Not planned for v0.x

Server rendering with hydration, and islands (prerendering to static HTML is built; see Next for hydration); a backend framework; native mobile targets; a visual editor or Figma plugin; nested routes, route guards and data loaders. See [What is Tessera?](/introduction/).

## What is deferred, and what that means for the docs

- The tutorial is static snippets with a check at the end of each step; the interactive version waits for the playground.
