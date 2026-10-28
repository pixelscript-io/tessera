# Backlog: what might come next

Ideas that make sense for Tessera, in the order the author chose to take them up, then the rest. This is a working note, not a promise: the roadmap (`website/content/releases/roadmap.md`) and SPEC.md say what is planned and built. Tessera is not trying to be a huge framework, so each idea is judged by whether it helps someone build an app on a design system.

Written 2026-10-26.

## Taking up now, in this order

1. **The comparison page** on the landing site: Tessera against React, Vue and Svelte on the features people compare most, including what Tessera does not have.
2. **A real-model test of `AGENTS.md`.** (Done 2026-10-28: see the decisions log in SPEC.md.) Start a model in a fresh project from `npm create @pixelscriptio/tessera@latest`, give it a few build prompts, and see where it still guesses. Fix the language guide from what it gets wrong.
3. **Forms and validation.** `bind:value` exists, but there is nothing for validation state, field errors, submit handling or accessible error messages. The idea: declare the rules once and let the compiler check the markup and the error wiring.
4. **Milestone 35: keeping state.** `persist` (`localStorage`, with a version and migration), `url` (state kept in a query parameter), `resetState()` for tests, and state that survives a hot update.
5. **Milestone 31 with hydration: data for a page.** The `<page>` block names what a page needs, so the fetch starts on navigation and a prerendered page has its data in the HTML; hydration reuses the static HTML instead of replacing it.
6. **Token importers against real exports** from Figma, Tokens Studio and Penpot. Today they are tested on files written to the formats' documentation.

## Planned already (SPEC.md, roadmap)

- **Tessera UI** (Milestones 39 to 44, `@pixelscriptio/tessera-ui`): the design system as a component library of about 40 components, in phases. Icons: **Lucide** (lucide.dev), a dependency of the library only; built as `Icon` (2026-10-27).

- Milestone 36: scoped state (one copy per subtree, per list item or dialog). Only if real use needs it.
- Milestone 37: who reads and who changes each piece of state, in `tessera report` and the docs app, with a warning for state nobody reads.
- Milestones 30, 32, 33: optimistic updates; development mocks from an API description; the cookbook (including a proxy that adds an API key and handles CORS).
- More behaviors and components: menu, listbox, tooltip, and a `Tabs` component (the `tabs` behavior is built).
- Type-checking of templates (`tessera check --types`) and source maps.
- The deprecation window that tooling enforces.
- Vue and Svelte wrappers for the custom elements (React exists).
- An in-browser playground and versioned docs.

## Other ideas

**Building real apps**

- Error and empty states as first-class: an error boundary for a component or a page, and a convention for 404, offline and failed-load pages.
- Nested routes and a layout per route (out of scope so far; dashboards and settings pages need them).
- Route guards and redirects, for pages that need a signed-in user.
- i18n: message files, plural rules, and a compile-time check that every key exists in every language.
- Transitions and animation: enter and leave, route transitions, and a `prefers-reduced-motion` check (motion tokens exist).
- Testing helpers for users: `mount`, and resetting state and APIs, so app authors can test their own components.

**AI and tooling**

- Rule files for other tools (`.cursor/rules`, Copilot instructions) that point at `AGENTS.md`.
- Machine-readable `tessera check` output (JSON) so an agent can read the errors and apply the suggested fixes in a loop.
- Editor polish: completions for members of shared state and API paths, and hover documentation for contract keys.
- The error reference and the API reference in the offline documentation bundle.

**Design-system side**

- A visual regression hook: screenshot every component, variant and theme and compare.
- A draft `.tess` generator from Figma components (variants, tokens and structure, not behavior).

**Reach and trust**

- Example apps as complete projects: a to-do app, a dashboard, a shop that uses the `cart` state. They double as test material and as sample prompts.
- Benchmarks: bundle size and update speed against comparable apps.
- Linting Sass, Less and Stylus, and a Stylelint plugin built on the same rules as `tessera lint`.
