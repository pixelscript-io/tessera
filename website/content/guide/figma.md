# Importing a component from Figma

Introduced in v0.14 (Milestone 51).

`tessera figma import` turns one component set of a Figma file into a Tessera component: its structure, its variants and its styles. It also writes a test that compares the component with the design, variant by variant, so "it matches" is something that is checked.

It needs nothing but the link. Figma says a lot about what a component is: its variant properties, which of them is the state, which layer each icon switch controls, and where the text is. The import reads all of that and writes down what it understood, in a **map** next to the component, which you can change and use again. What Figma cannot say is behavior (that it is a button), so the kind is read from the name, and only a button can be imported so far.

::: tip What was tested
The Button of the Untitled UI kit (the Buttons page: 380 variants of size, hierarchy, icon and state, and a smaller page of 120), read through Figma's REST API on a Pro plan. Every one of the 380 variants has the right box for each part in a real browser, and the pictures Figma made of 47 of them were compared with the component. The section on what the comparison does and does not prove says what that covers.
:::

## What you need

- A Figma file with the component set, and a **personal access token** (Figma, Settings, Security, Personal access tokens) with the **File content** read scope. The free plan works: the import uses the file and image endpoints, not the Variables API, which needs an Enterprise plan.
- The token in your environment, never in a file. In a Bash terminal:

```bash
export FIGMA_TOKEN=your_token_here
```

In PowerShell:

```powershell
$env:FIGMA_TOKEN = "your_token_here"
```

- A Tessera project to import into.

## Import

```bash
npx tessera figma import --url "https://www.figma.com/design/KEY/Name?node-id=1-1183"
```

The link is the one Figma copies for **Copy link to selection** on the page or on the component set. A page with one component set is enough. If it has several, the import lists them and `--component "Buttons/Button"` says which. To work without a token, from a response you saved:

```bash
npx tessera figma import --from-json button-set.json
```

It writes, in `system/components` or `app/components` (or `--out`):

- `Button.tess`: the contract, the template, and the styles;
- `figma/Button/`: `figma.map.json` (what it understood), the numbers the test compares with, and Figma's pictures of the variants;
- `Button.figma.browser.test.ts`: the test;

and, in the project's tokens folder, `figma.tokens.json`. It also sets up the browser tests that run it, as [`tessera a11y`](/guide/commands#tessera-a11y) does (a Vitest configuration and dev dependencies). After it:

```bash
npm install
npm run dev
npm run test:a11y
```

`npm run dev` shows the component in the design system docs. `npm run test:a11y` runs the comparison with the design, and the accessibility tests generated from the component's contract.

It writes over the Button the project started with (and the notes that described it) and over what an earlier import wrote. It never writes over a file of yours without `--replace`, and says which it left.

## What it works out

| Figma                                                                   | Tessera                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| The set's name (`Buttons/Button`)                                       | The component's name (`Button`), and the kind (a button)                                               |
| A variant property (`Size`, `Hierarchy`, `Icon`)                        | A prop, in lower case, with the design's default first                                                 |
| The property for the state (`State`: Default, Hover, Focused, Disabled) | Pseudo-classes: none, `:hover`, `:focus-visible`, `:disabled`                                          |
| A switch that shows or hides a layer (`Icon leading`, `Icon trailing`)  | A slot of that name (`icon-leading`, `icon-trailing`), before or after the label by where the layer is |
| An instance swap for that icon                                          | Nothing: the icon is what the slot holds                                                               |
| The text layer, and the frame around it                                 | The `label` part                                                                                       |

A slot and a prop can not have the same name (the docs could not tell them apart), which is why the slot is `icon-leading` and not `icon` next to a prop `icon`. The slots show the design's own placeholder in the docs, a ring the size of an icon, instead of text.

### A map of your own

The import writes the map it used as `figma/Button/figma.map.json`. Edit it and give it back with `--map` to change what it says, for example to name a prop differently, to say which of several layers is which part, or to give the design's font for the comparison:

```json
{
  "component": "Buttons/Button",
  "name": "Button",
  "kind": "button",
  "role": "button",
  "description": "Triggers an action. Press it with a mouse, a finger, Enter or Space.",
  "behavior": "press",
  "props": {
    "Size": { "prop": "size", "default": "sm" },
    "Hierarchy": { "prop": "hierarchy", "default": "Primary" },
    "State": {
      "states": {
        "Default": null,
        "Hover": "hover",
        "Focused": "focus-visible",
        "Disabled": "disabled"
      }
    }
  },
  "ignore": { "🔀 Icon leading swap#3466:91": "the icon is what the slot holds" },
  "parts": {
    "root": "$",
    "icon-leading": [
      { "property": ["⬅️ Icon leading#3287:1577"] },
      { "beside": "label", "side": "before" }
    ],
    "label": [
      { "layer": "Text padding", "text": "Text" },
      { "layer": "Text", "text": "Text" }
    ]
  },
  "slots": { "icon-leading": { "description": "an icon before the label", "side": "before" } },
  "fidelity": {
    "threshold": 0.01,
    "ignore": ["icon-leading", "label"],
    "fonts": [{ "family": "Inter", "file": "fonts/Inter.woff2" }]
  }
}
```

| Key         | What it says                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `component` | The name of the component set in Figma.                                                                                                                                                                                                                  |
| `name`      | The name of the Tessera component.                                                                                                                                                                                                                       |
| `props`     | Each variant property of the set. A normal one becomes a prop, with the value to use as the default. **One** is the state: each of its values is a pseudo-class (`hover`, `focus-visible`, `disabled`), or `null` for none.                              |
| `ignore`    | The other properties of the set (booleans, instance swaps) that are not a prop or a slot, each with why.                                                                                                                                                 |
| `parts`     | Which layer is which part. `"$"` is the component itself. A layer is found by `layer` name (`index` picks the n-th), by the `property` (switch or swap) that controls it, or `beside` the label (`side`: `before` or `after`). A list is tried in order. |
| `slots`     | The parts that hold what the caller gives, with their side of the label.                                                                                                                                                                                 |
| `fidelity`  | `threshold` is the share of pixels that may differ (default 1%). `ignore` lists the parts whose pixels are not compared. `fonts` are files, relative to the map.                                                                                         |

With a map you give, what it does not mention is an error, not a default:

```text
F003: The variant property "Hierarchy" is not in the map.
F005: The boolean property "⬅️ Icon leading#3287:1577" is not in the map.
F004: The state values "Hover" of "State" are not in the map.
```

## How the styles are made

Each variant is one place on every axis of the set: `Size=md, Hierarchy=Primary, Icon=Default, State=Default`. A stylesheet written variant by variant would have 380 blocks. Instead, for each property of each part, the import finds a base and the smallest set of conditions that change it. The size alone decides the padding, so there is one rule for each size. The hierarchy and the state decide the color, so there is one for each pair. Where rules overlap the stronger one wins: more conditions, and then the later axis, so a hierarchy's padding beats a size's. The 380-variant Button is about 500 lines.

Then every variant is replayed against the stylesheet, in the order the rules are written, and the import stops with a fault if one would differ from the design. Nothing is written first.

- **States** are pseudo-classes: `:hover` (not on a disabled button), `:focus-visible`, `:disabled`. The state that needs none is written with `:where(:not(...))`, which weighs nothing, so it never wins over a rule it should lose to.
- **A stroke** is drawn as an outline pulled inward (`outline` and a negative `outline-offset`), because in Figma a stroke sits inside the box and does not change its size, and a CSS border would.
- **A gradient stroke** is a gradient under the fill, which is smaller by the width of the stroke.
- **Shadows** keep their order (Figma lists them from the bottom up, CSS from the top down), with the inner ones as `inset`.
- **An icon** is a slot. A slot that is empty is hidden (`.icon-leading:empty`), as in the Figma variants that have none.
- **A label the design does not show** (an icon-only button) is hidden from the eye and kept for a screen reader, with a one-pixel clip. `display: none` would also take it from the accessibility tree, and an icon-only button would have no name. The generated accessibility tests found that.
- **Layout** comes from auto layout: direction, gap, padding, alignment, and fixed sizes. A layer that is not in an auto layout is reported and not translated.

## Tokens

The compiler refuses a raw value (T2102), so the import makes tokens for what the design uses, in the groups the compiler governs:

- A value that uses a Figma **style** gets a token named after the style: the fill style `Brand/600` is `$color.figma-brand-600`, and the effect style `Shadows/shadow-xs-skeuomorphic` is `$shadow.figma-shadows-shadow-xs-skeuomorphic`.
- A value with **no style** gets a token named after the value (`$space.figma-14`, `$color.figma-1d2939`). The import lists these, because a design that uses styles everywhere has none. `--strict` stops instead.

These are your tokens now: rename them, alias them to your own, or point your components at others. The gradient border and the multi-layer shadow of this kit have no equivalent in a flat token set, so they are tokens like the rest: the design is kept exactly, and flattening it is a change you make in Figma.

## The test

The import sets up the browser tests (as `tessera a11y` does) and writes one more beside the component. Run them together:

```bash
npm run test:a11y
```

For each variant it mounts the component the way the design shows it (the sample text, something the size of an icon in each slot) and checks:

1. **Where things are.** The box of the component and of each part is within a pixel of the design's. A part the design does not have is not shown. The label's width and what follows it may differ by 4%: the browser sets the same font a little wider or narrower than Figma does.
2. **What it looks like.** A screenshot of the component against Figma's picture of the variant, on white. The share of pixels that differ (by more than a tenth) must stay under the threshold, leaving out the parts in `fidelity.ignore`.

A failure names the variant and the share: `Size=md, Hierarchy=Primary, Icon=Default, State=Focused: 23.73% of the pixels differ from the design (the most allowed is 1%)`.

### What the comparison does and does not prove

It proves the boxes of every part, and the paint of everything that is compared: the fill, the strokes, the radii and the shadows, including the focus ring. It does not prove the label's letters or an icon. An icon is what the caller supplies. Type is drawn by two renderers, so the edges of the letters differ even with the same font file: with the label compared, most of the Button's variants were 1 to 4% different at the edges of the letters and none anywhere else, so the Button's map leaves the label out of the pixels (`"ignore"`). The label's box is still held to the design's, so the font's size, weight and line height are. Put the design's font in the map's `fonts`, or the label's width will not match.

## One design, one theme

A Figma file usually draws a component in one theme. The imported component has that theme's colors, so it is right in light mode, and `npm run test:a11y` runs every variant in both themes. For the Untitled UI Button the light run passes entirely. In dark mode the hierarchies that have a fill (primary and the two secondaries) pass, because their fill and text were designed together. The four that have **no fill** (tertiary and link, gray and color) fail the contrast check there: dark purple or gray text, drawn for a white page, on a dark one. That is a real finding about the design, not a fault of the import.

To fix it, give the dark theme its own value for the colors those variants use, in the project's dark token file, for example `$color.figma-gray-700` and `$color.figma-brand-700`. The import does not invent dark colors.

## Not built yet

Components other than a button, nested instances as slots, icons as vector layers, a round trip back to Figma, and the Variables API (the file's variables arrive through [`tokens import`](/guide/interchange)).

## Errors

| Code         | Means                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------- |
| F001         | The set is not a button (by its name, or the map's `kind`). Only a button can be imported so far.   |
| F002         | The set in the map is not the set in the file.                                                      |
| F003 to F006 | A property of the set is not in the map, or the map names one the set does not have.                |
| F008         | `parts` has no `"root": "$"`.                                                                       |
| F009         | The stylesheet would give a variant something other than the design. This is a fault in the import. |
| F010         | There is no `FIGMA_TOKEN`.                                                                          |
| F011         | The link has no file or node.                                                                       |
| F012         | Figma refused: the token is wrong, expired, or lacks the scope; or the file is not visible to it.   |
| F014         | `--strict`, and a value has no style.                                                               |
| F015         | A slot has the name of a prop.                                                                      |
| F016         | The set has no text layer to be the label.                                                          |
| F017         | The link has several component sets: say which with `--component`.                                  |
