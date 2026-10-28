# Tessera UI

Introduced in v0.8 (Milestones 39 to 41); changed in v0.9 (Milestone 47) from a package to components you copy.

Tessera UI is a catalogue of accessible, themeable components such as `Button`, `TextField`, `Dialog` and `Combobox`, written in the same `.tess` files as your own. You do not install it as a dependency. `tessera add` copies the ones you want into your project, where they are yours to edit, and the compiler, the contracts, the generated accessibility tests and the manifest treat them exactly as they treat components you wrote.

The catalogue is not a second system beside yours. Its components are styled only with tokens, so they take their look from the design system of the project they are in: change `color.action.primary.bg` and every button changes with it.

## Add a component

```bash
npx tessera add Button
npx tessera add Accordion Dialog Select
npx tessera add --list
```

`add` writes `system/components/Button.tess` and `Button.docs.md`, and it is ready to use at once: like every component in `system/components` it is available by its name with no import (see [Auto-imports](/guide/auto-imports)).

```xml tess kind=page
<template>
  <main>
    <Button tone="primary">Save</Button>
  </main>
</template>
```

- **What a component needs comes with it.** `Accordion` needs `AccordionItem`, and `add` copies both. If your project already has a component with that name, it is kept and `add` says so.
- **Packages are named, not hidden.** `Icon` imports `lucide`; `add` prints the `npm install` line, or runs it with `--install`.
- **A component can ask for a newer Tessera.** If it needs a newer `@pixelscriptio/tessera` than your project has, `add` refuses and says which.
- **It is recorded.** `tessera.lock.json` lists what was added and a checksum, so `tessera add --list` can show what is installed.
- **It is safe to point anywhere.** `add` writes only `.tess`, `.docs.md` and `.ts` files into `system/components` (and token files into `system/<name>/tokens`); a registry cannot make it write anywhere else, and nothing it downloads is run. `--from` takes an address, a folder of a registry, or a folder of components, so a team can keep its own.

### When the name is taken

No two components share a name. If `Button` exists, in a terminal `add` asks what to do and names both: the **existing** one (yours, with its path) and the **new** one (from Tessera UI):

- **replace** overwrites yours with the new one;
- **rename** keeps yours and asks for another name for the new one (the file, the contract and the examples in its docs are renamed together);
- **cancel** changes nothing.

Without a terminal, say it in the command: `--replace`, or `--as ActionButton`. `--diff` writes nothing and shows how your copy differs from the catalogue's. `--yes` never asks, so a taken name still needs `--replace` or `--as`.

### Design systems

```bash
npx tessera add tokens:tailwind
npx tessera add tokens:unstyled
npx tessera add tokens:tessera
```

These copy a set of tokens into `system/<name>/tokens` (`--as <folder>` picks another folder) and say what to add to `tessera.config.ts`. See [Design systems in `system/`](/guide/presets#design-systems-in-system).

### A project from 0.8

Version 0.8 delivered the library as the package `@pixelscriptio/tessera-ui`. It is not published any more, and a project that still lists it stops with a message that says so, with the `tessera add` line for the components its templates use. Remove the package and run that line.

## The Tessera UI site

[tessera-ui.pixelscript.io](https://tessera-ui.pixelscript.io) lists every component with its contract, the tokens it uses and its docs, and is also the registry `tessera add` reads. It is made from the same files, so it cannot say something the registry does not. To build it (and publish it, if you run your own copy):

```bash
pnpm build:ui-site
cd packages/ui
npx wrangler deploy
```

The build writes `packages/ui/dist`: the pages, `index.json` and `r/`. `packages/ui/wrangler.jsonc` serves that folder as static files, with no code. Its `_headers` lets any origin read the registry and caches it for five minutes. Add your domain to the Worker in the Cloudflare dashboard. The folder is also a registry you can try before deploying: `npx tessera add Button --from packages/ui/dist`.

## Tokens a component needs

A catalogue component uses only the tokens listed in the next section, which is the interface between the catalogue and a design system. The `tailwind` and `unstyled` presets define all of them. A design system of your own may not, so `add` compares before it writes anything. For each design system in `tessera.config.ts` it reports the tokens the new components use that the system **lacks**, and the ones it defines with **another type** than the component expects (a `radius.sm` that is a color, say):

```text
The new components use tokens that some of your design systems lack or define differently:
  Brand:
    missing     color.action.primary.bg (a color) (Badge)
    wrong type  radius.sm is a color here, and the components expect a dimension (Badge)
```

There are three ways to make a component fit, and in a terminal `add` asks which:

- **`--fit add`** writes the missing tokens, with the values of the reference set (the `tailwind` tokens), into `tessera-ui.tokens.json` in each system's tokens folder. That file holds only what `add` put there, so you can edit it or delete it. A token the reference set gives another value in the dark theme gets its dark value in the system's own `themes/dark.tokens.json`, beside your overrides (a theme file is named for its theme, so it cannot be split). A wrong type is never overwritten; that is for `--map`.
- **`--map from=to`** rewrites the component, as it is written to your project, to use a token you have: `--map color.action.primary.bg=color.brand.bg,radius.sm=radius.md`. It can be repeated. The fit is checked again against the tokens you mapped to.
- **`--fit set`** installs the whole reference set (`tokens:tailwind`) as another design system and leaves yours as it is.

`--fit skip` leaves the comparison out. With no flag and no terminal, `add` still writes the component, reports the gaps and names these flags, so a script is never held up.

When the files are written, `add` runs the check on the new components and prints what it finds (for example a contrast that is too low in your dark theme). The generated accessibility tests cover them as well: `npx tessera a11y --system all` runs them in every design system, and `add` says so.

In the docs that `tessera dev` serves, the design system switch shows the same gaps for each component.

## The token interface

```text token-interface
color.action.danger.bg
color.action.danger.bg-hover
color.action.danger.fg
color.action.danger.text
color.action.primary.bg
color.action.primary.bg-hover
color.action.primary.fg
color.action.primary.text
color.border.default
color.border.strong
color.focus.ring
color.surface.default
color.surface.hover
color.surface.inverse
color.surface.raised
color.text.default
color.text.muted
font.size.base
font.size.xs
font.size.lg
font.size.sm
font.weight.bold
motion.duration.fast
opacity.disabled
radius.full
radius.lg
radius.md
radius.sm
shadow.md
shadow.sm
space.0-5
space.1
space.10
space.12
space.16
space.2
space.3
space.4
space.5
space.6
space.8
```

New components may add tokens to this list; a test fails until the list and the components agree, and a new token is a change you will find in the [release notes](/releases/).

## Forms

A field is a component with a visible label, an optional hint and an optional `error`: `TextField`, `Textarea`, `Select`, `Combobox` and `RadioGroup`. The error is announced when it appears, is read with the field, and marks it invalid. For a control with none of that (a native date input, say) wrap it in a `FormField`.

`Form` ties them together. You give it the `values` and the `rules`; on submit it fires `submit` with the values if every rule passes, and otherwise `invalid` with the errors, and moves focus to the first field that has one. It does not draw the errors: you keep them in state and hand each to its field, so the messages and when they appear stay yours. The Form page of the component docs (`npx tessera docs`) has a complete example.

## Overlays

`Popover` and `Tooltip` use the browser's own `popover` attribute and CSS anchor positioning, so there is no positioning code to ship: the browser puts the panel in the top layer (nothing clips or covers it), next to its button, on the other side when there is no room, and closes it on Escape or a click outside. A browser without anchor positioning gets the panel placed under its button, without flipping. `Dialog` is the one that blocks the page; a `Popover` does not.

## Icons

Icons come from [Lucide](https://lucide.dev/icons/) (ISC license). Lucide is a dependency of the `Icon` component and of nothing else: a project that does not add `Icon` does not get it, and `@pixelscriptio/tessera` itself never depends on it.

```xml tess kind=page
<template>
  <main>
    <Button><Icon slot="icon" name="plus" />New</Button>
  </main>
</template>
```

`Icon` knows about sixty of the most common icons by name (`check`, `x`, `search`, `chevron-down`, `trash-2` and so on, Lucide's names in kebab case). For any other icon, import it from `lucide` and pass it as `icon`; only what you import is in your build. Install `lucide` in your project first (`add Icon` tells you), or draw icons however you like: nothing in Tessera requires this one.

## Conventions every catalogue component follows

These are the rules a component must meet before it joins the catalogue. They are also a good checklist for your own.

- **A contract first.** Parts, states, variants (the first value of each is the default), slots and events are declared, and the `role` and `behavior` come from the [behaviors](/guide/behaviors) Tessera already tests. Every component has `since`, the release that added it.
- **Tokens only.** No raw colors, sizes or shadows. A value that is not in the interface above is added to the interface, not written in.
- **Accessible by construction.** The generated accessibility suite passes in the light and dark themes, for every variant and state. Keyboard behavior comes from a behavior, not from the component's own script.
- **Variants are `tone`, `size` and `emphasis`.** The same names mean the same thing everywhere: `size` is `sm` or `md` (and `lg` where it makes sense), `tone` is `primary`, `neutral` or `danger`, `emphasis` is `solid`, `outline` or `ghost`.
- **Events are named for what happened.** `press`, `toggle`, `change`, `input`, `select`, `dismiss`, `expand`; the payload is the new value.
- **Icons are a slot.** A component that can show one has an `icon` slot, filled with an `Icon` (see below). A component never draws an icon you did not ask for.
- **One docs page per component**, `Name.docs.md` beside it, with live examples that compile.
- **It builds as a custom element** with `tessera elements`, like the rest of the system.

## What is in it

`Accordion`, `AccordionItem`, `Alert`, `Avatar`, `Badge`, `Button`, `Card`, `Checkbox`, `Combobox`, `Dialog`, `Form`, `FormField`, `Icon`, `Kbd`, `Popover`, `Progress`, `RadioGroup`, `Select`, `Separator`, `Skeleton`, `Spinner`, `Switch`, `Textarea`, `TextField` and `Tooltip`, and more coming in phases: the rest of the overlays (a menu, toasts, a drawer) first, then navigation and data, and pickers. The catalogue is meant to stay around forty components; a component that most apps do not need belongs in the project that does. See the [roadmap](/releases/roadmap).
