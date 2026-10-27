# Tessera UI

Introduced in v0.7 (Milestone 39).

Tessera UI is the component library for Tessera apps: accessible, themeable components such as `Button`, `TextField`, `Dialog` and `Combobox`, written in the same `.tess` files as your own. It is a package of its own, `@pixelscriptio/tessera-ui`, and it ships as source, so the compiler, the contracts, the generated accessibility tests and the manifest treat its components exactly as they treat yours.

It is not a second system beside yours. Its components are styled only with tokens, so they take their look from the design system of the project they are in: change `color.action.primary.bg` and every library button changes with it.

## Install it

```bash
npm install @pixelscriptio/tessera-ui@latest
```

The starter presets (`tessera` and `tailwind`) add it for you. With it installed, every component is available by its name, with no import, like a component in `app/components` (see [Auto-imports](/guide/auto-imports)):

```xml tess kind=page
<template>
  <main>
    <Button tone="primary">Save</Button>
  </main>
</template>
```

The library is only used by a project that has a design system, meaning tokens in `system/tokens`. Without tokens its components would have nothing to be styled by, so `--preset none` stays empty even if the package is installed.

## Making a component your own

A component in `app/components` with the same name as a library component replaces it, everywhere in the project, and it is not an error. That is the one place a name may repeat: two components of your own with one name are still T5001 ([error reference](/reference/errors/)).

The easy way to start is to copy the library's component:

```bash
npx tessera eject Button
```

This writes `app/components/Button.tess`, with the contract recording `forkedFrom` (the component and the version it came from). Edit it as you like. `tessera eject Button FancyButton` copies it under a new name instead, so both exist.

Until you eject, the library's component is not yours to edit, and a new version of the package improves it for you. After you eject, it is yours and stays as it is.

## Tokens a library component may use

A library component uses only the tokens listed here, which is the interface between the library and a design system. The `tessera` and `tailwind` presets define all of them, and a design system of your own has to as well, or `tessera check` reports the missing one in the component that uses it.

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

Icons come from [Lucide](https://lucide.dev/icons/) (ISC license). Lucide is a dependency of `@pixelscriptio/tessera-ui` and of nothing else: a project that does not install the library, or that has no design system, does not get it, and `@pixelscriptio/tessera` itself never depends on it.

```xml tess kind=page
<template>
  <main>
    <Button><Icon slot="icon" name="plus" />New</Button>
  </main>
</template>
```

`Icon` knows about sixty of the most common icons by name (`check`, `x`, `search`, `chevron-down`, `trash-2` and so on, Lucide's names in kebab case). For any other icon, import it from `lucide` and pass it as `icon`; only what you import is in your build. Install `lucide` in your project first, or use a design system of your own and draw icons however you like: nothing in Tessera requires this one.

## Conventions every library component follows

These are the rules a component must meet before it joins the library. They are also a good checklist for your own.

- **A contract first.** Parts, states, variants (the first value of each is the default), slots and events are declared, and the `role` and `behavior` come from the [behaviors](/guide/behaviors) Tessera already tests. Every component has `since`, the release that added it.
- **Tokens only.** No raw colors, sizes or shadows. A value that is not in the interface above is added to the interface, not written in.
- **Accessible by construction.** The generated accessibility suite passes in the light and dark themes, for every variant and state. Keyboard behavior comes from a behavior, not from the component's own script.
- **Variants are `tone`, `size` and `emphasis`.** The same names mean the same thing everywhere: `size` is `sm` or `md` (and `lg` where it makes sense), `tone` is `primary`, `neutral` or `danger`, `emphasis` is `solid`, `outline` or `ghost`.
- **Events are named for what happened.** `press`, `toggle`, `change`, `input`, `select`, `dismiss`, `expand`; the payload is the new value.
- **Icons are a slot.** A component that can show one has an `icon` slot, filled with an `Icon` (see below). The library never draws an icon you did not ask for.
- **One docs page per component**, `Name.docs.md` beside it, with live examples that compile.
- **It builds as a custom element** with `tessera elements`, like the rest of the system.

## What is in it

`Accordion`, `AccordionItem`, `Alert`, `Avatar`, `Button`, `Checkbox`, `Combobox`, `Dialog`, `Form`, `FormField`, `Icon`, `Kbd`, `Popover`, `Progress`, `RadioGroup`, `Select`, `Separator`, `Skeleton`, `Spinner`, `Switch`, `Textarea`, `TextField` and `Tooltip`, and more coming in phases: the rest of the overlays (a menu, toasts, a drawer) first, then navigation and data, and pickers. The library is meant to stay around forty components; a component that most apps do not need belongs in the project that does. See the [roadmap](/releases/roadmap).
