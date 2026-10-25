# Roadmap

What exists is in [Releases](/releases/). This page lists what does not, in the order it is planned, so you know what not to rely on.

## Next

- **A deprecation window** that the tooling enforces (`tessera diff` and the codemods exist; the window does not).
- **Token importers tested against real exports** from Figma, Tokens Studio and Penpot. The importers are tested on files written to the formats' documentation.
- **More behaviors and components:** menu, listbox and tooltip, and a `Tabs` component (the `tabs` behavior is built).
- **Hydration** for prerendered pages. `tessera build --prerender` writes static HTML today, and the router replaces it when the app starts.

## Data fetching, in order

The runtime, the calls in `.tess` files and the `app/apis` folder are built ([Fetching data](/guide/data)). The rest, in order: a description of your API (OpenAPI, or a small format of our own) so endpoints, parameters and the fields you read are checked at compile time; optimistic updates; data for a page, started when you navigate and prerendered; development mocks and loading and error states in the docs app and the accessibility tests; a recipe for a proxy that adds a key and handles CORS.

## Later

- Vue and Svelte wrappers for the custom elements (React exists), and watching slot content for changes.
- Linting Sass, Less and Stylus, and a Stylelint plugin built on the same rules as `tessera lint`.
- A draft `.tess` generator from Figma components: variants, tokens and structure, not behavior.
- A Zed language extension.
- A global store.
- An in-browser playground and versioned docs. The compiler core is browser-safe so the playground does not need a rewrite.
- Type-checking of templates (`tessera check --types`) and source maps.

## Not planned for v0.x

Server rendering with hydration, and islands (prerendering to static HTML is built; see Next for hydration); a backend framework; native mobile targets; a visual editor or Figma plugin; nested routes, route guards and data loaders. See [What is Tessera?](/introduction/).

## What is deferred, and what that means for the docs

- The tutorial is static snippets with a check at the end of each step; the interactive version waits for the playground.
