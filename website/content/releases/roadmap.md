# Roadmap

What exists is in [Releases](/releases/). This page lists what does not, in the order it is planned, so you know what not to rely on.

## Next

- **A system manager.** The design system docs app gaining an editing mode, so that people who do not write code can change tokens and contract fields through a UI, with every change checked by the compiler first and shown as breaking or not before it is saved. Proposed; its open questions are being decided.
- **A deprecation window** that the tooling enforces (`tessera diff` and the codemods exist; the window does not).

## Later

- More behaviors and components: `toggle`, `disclosure`, dialog and combobox.
- A global store and data-fetching layer.
- An in-browser playground, versioned docs and a hosted site. The compiler core is browser-safe so the playground does not need a rewrite.
- Type-checking of templates (`tessera check --types`) and source maps.

## Not planned for v0.x

Server rendering, hydration and islands; a backend framework; native mobile targets; a visual editor or Figma plugin; nested routes, route guards and data loaders. See [What is Tessera?](/introduction/).

## What is deferred, and what that means for the docs

- The tutorial is static snippets with a check at the end of each step; the interactive version waits for the playground.
