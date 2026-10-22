# Glossary

**Auto-import.** Resolving a component tag or script API to an `import` at compile time, so a `.tess` file needs no import lines. See [Auto-imports](/guide/auto-imports).

**Baseline.** A committed file (`tessera.baseline.json`) recording how many violations each file has per rule, so existing code can adopt enforcement and fail only on new violations. See [Enforcement](/guide/design-systems/enforcement).

**Behavior.** A headless interaction primitive, such as `press`, that a contract opts into and that a component's template attaches with an event like `@press`.

**Contract.** The JSON block at the top of a component that declares its name, role, parts, variants, states, slots, events and behavior. See [Contracts](/guide/contracts).

**DTCG.** The W3C Design Tokens Community Group format that Tessera's tokens are written in.

**Governed property.** A CSS property whose values must come from tokens, such as `padding` or `color`.

**Layout.** A `.tess` file in `app/layouts/` that wraps pages and puts the page where its `<slot />` is. See [Layouts](/guide/layouts).

**Manifest.** The resolved description of every token, with its type, tier and value per theme (`tessera tokens build`), or the route list built from `app/pages`.

**Page.** A `.tess` file in `app/pages/`; its path is its URL.

**Part.** A named piece of a component's template, identified by a class and listed in the contract. The root element carries the `root` part.

**Primitive, semantic and component tokens.** The three tiers of a token. See [Token architecture](/guide/design-systems/token-architecture).

**`raw()`.** The escape hatch for a single style value: it needs a reason and may have an expiry. See [Enforcement](/guide/design-systems/enforcement).

**Role.** The ARIA role a component has, declared in its contract.

**Signal.** A reactive value: `state()` holds one, `derived()` computes one. See [The signals runtime](/how-it-works/signals).

**Slot.** A named place in a component where a parent puts content, declared in the contract.

**State.** In a contract, a condition a component can be in that styles and tests care about (`hover`, `disabled`). In code, a signal made with `state()`.

**Theme.** A token file that overrides semantic token values and applies under a data attribute.

**Token.** A named design value (`space.4`, `color.action.primary.bg`) written in DTCG JSON and compiled to a CSS custom property.

**Variant.** A named choice with a fixed list of values in a contract; the first value is the default. It appears on the component's root as a `data-` attribute.
