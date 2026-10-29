# Importing a component from Figma

Introduced in v0.14 (Milestone 51).

`tessera figma import` turns one component set of a Figma file into a Tessera component: its structure, its variants and its styles. It also writes a test that compares the component with the design, variant by variant, so "it matches" is something that is checked.

It does not guess what a design cannot say. Figma knows how a button looks. It does not know that it is a button, what the keyboard does, or which of its properties are props and which are states. A hand-written **map** says that, and the import refuses to continue when the map and the design disagree.

::: tip What was tested
The Button of the Untitled UI kit (the Buttons page: 380 variants of size, hierarchy, icon and state), read through Figma's REST API on a Pro plan. Every one of its 380 variants has the right box for each part in a real browser, and the pictures Figma made of 47 of them were compared with the component. The section on what the comparison does and does not prove says what that covers. Only a button can be imported so far.
:::

## What you need

- A Figma file with the component set, and a **personal access token** (Figma, Settings, Security, Personal access tokens) with the **File content** read scope. The free plan works: the import uses the file and image endpoints, not the Variables API, which needs an Enterprise plan.
- The token in your environment, never in a file:

```bash
export FIGMA_TOKEN=your_token_here
```

- A map, `figma.map.json`.
- Optional: the design's font as a file, so the comparison draws the same type.

## The map

```json
{
  "component": "Buttons/Button",
  "name": "Button",
  "kind": "button",
  "role": "button",
  "description": "Triggers an action. Press it with a mouse, a finger, Enter or Space.",
  "behavior": "press",
  "props": {
    "Size": { "prop": "size", "default": "md" },
    "Hierarchy": { "prop": "hierarchy", "default": "Primary" },
    "Icon": { "prop": "icon", "default": "Default" },
    "State": {
      "states": {
        "Default": null,
        "Hover": "hover",
        "Focused": "focus-visible",
        "Disabled": "disabled"
      }
    }
  },
  "ignore": {
    "⬅️ Icon leading#3287:1577": "an icon is a slot: it shows when the slot has something in it"
  },
  "parts": {
    "root": "$",
    "icon": [{ "layer": "placeholder", "index": 0 }, { "layer": "_Dot" }],
    "label": [
      { "layer": "Text padding", "text": "Text" },
      { "layer": "Text", "text": "Text" }
    ],
    "icon-end": { "layer": "placeholder", "index": 1 }
  },
  "slots": {
    "icon": "optional icon before the label",
    "icon-end": "optional icon after the label"
  },
  "sample": "Button CTA",
  "fidelity": {
    "threshold": 0.01,
    "ignore": ["icon", "icon-end", "label"],
    "fonts": [{ "family": "Inter", "file": "fonts/Inter.woff2" }]
  }
}
```

| Key         | What it says                                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `component` | The name of the component set in Figma.                                                                                                                                                                                     |
| `name`      | The name of the Tessera component.                                                                                                                                                                                          |
| `props`     | Each variant property of the set. A normal one becomes a prop, with the value to use as the default. **One** is the state: each of its values is a pseudo-class (`hover`, `focus-visible`, `disabled`), or `null` for none. |
| `ignore`    | The other properties of the set (booleans, instance swaps), each with why it is not a prop.                                                                                                                                 |
| `parts`     | Which layer is which part. `"$"` is the component itself. A layer is found by name (`index` picks the n-th of that name). A list is tried in order: a variant may draw the same part with another layer.                    |
| `fidelity`  | `threshold` is the share of pixels that may differ (default 1%). `ignore` lists the parts whose pixels are not compared: an icon is what the caller puts in the slot. `fonts` are files, relative to the map.               |

What the map does not mention is an error, not a default:

```text
F003: The variant property "Hierarchy" is not in the map.
F005: The boolean property "⬅️ Icon leading#3287:1577" is not in the map.
F004: The state values "Hover" of "State" are not in the map.
```

## Import

```bash
npx tessera figma import --map figma.map.json --url "https://www.figma.com/design/KEY/Name?node-id=1-1183"
```

The link is the one Figma copies for **Copy link to selection** on the page or the set. The set named in `component` is found inside it. To work without a token, from a response you saved:

```bash
npx tessera figma import --map figma.map.json --from-json button-set.json
```

It writes, in `system/components` or `app/components` (or `--out`):

- `Button.tess`: the contract, the template, and the styles;
- `Button.figma.browser.test.ts` and `figma/Button/`: the test, the numbers it compares with, Figma's pictures of the variants and the font;

and, in the project's tokens folder, `figma.tokens.json`. It never overwrites a file without `--replace`, and says which it left.

## How the styles are made

Each variant is one place on every axis of the set: `Size=md, Hierarchy=Primary, Icon=Default, State=Default`. A stylesheet written variant by variant would have 380 blocks. Instead, for each property of each part, the import finds a base and the smallest set of conditions that change it. The size alone decides the padding, so there is one rule for each size. The hierarchy and the state decide the color, so there is one for each pair. Where rules overlap the stronger one wins: more conditions, and then the later axis, so a hierarchy's padding beats a size's. The 380-variant Button is about 500 lines.

Then every variant is replayed against the stylesheet, in the order the rules are written, and the import stops with a fault if one would differ from the design. Nothing is written first.

- **States** are pseudo-classes: `:hover` (not on a disabled button), `:focus-visible`, `:disabled`. The state that needs none is written with `:where(:not(...))`, which weighs nothing, so it never wins over a rule it should lose to.
- **A stroke** is drawn as an outline pulled inward (`outline` and a negative `outline-offset`), because in Figma a stroke sits inside the box and does not change its size, and a CSS border would.
- **A gradient stroke** is a gradient under the fill, which is smaller by the width of the stroke.
- **Shadows** keep their order (Figma lists them from the bottom up, CSS from the top down), with the inner ones as `inset`.
- **An icon** is a slot. A part that is empty is hidden (`.icon:empty`), as in the Figma variants that have none.
- **Layout** comes from auto layout: direction, gap, padding, alignment, and fixed sizes. A layer that is not in an auto layout is reported and not translated.

## Tokens

The compiler refuses a raw value (T2102), so the import makes tokens for what the design uses, in the groups the compiler governs:

- A value that uses a Figma **style** gets a token named after the style: the fill style `Brand/600` is `$color.figma-brand-600`, and the effect style `Shadows/shadow-xs-skeuomorphic` is `$shadow.figma-shadows-shadow-xs-skeuomorphic`.
- A value with **no style** gets a token named after the value (`$space.figma-14`, `$color.figma-1d2939`). The import lists these, because a design that uses styles everywhere has none. `--strict` stops instead.

These are your tokens now: rename them, alias them to your own, or point your components at others. The gradient border and the multi-layer shadow of this kit have no equivalent in a flat token set, so they are tokens like the rest: the design is kept exactly, and flattening it is a change you make in Figma.

## The test

`tessera a11y` sets up the browser tests, and the import writes one more beside the component. Run it with the others:

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
| F001         | The map's `kind` is not `button`.                                                                   |
| F002         | The set in the map is not the set in the file.                                                      |
| F003 to F006 | A property of the set is not in the map, or the map names one the set does not have.                |
| F008         | `parts` has no `"root": "$"`.                                                                       |
| F009         | The stylesheet would give a variant something other than the design. This is a fault in the import. |
| F010         | There is no `FIGMA_TOKEN`.                                                                          |
| F011         | The link has no file or node.                                                                       |
| F012         | Figma refused: the token is wrong, expired, or lacks the scope; or the file is not visible to it.   |
| F014         | `--strict`, and a value has no style.                                                               |
