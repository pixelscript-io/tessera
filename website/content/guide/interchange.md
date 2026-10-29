# Importing and exporting tokens

Introduced in v0.1 (Milestone 14).

Tessera's token files are already DTCG: the format the W3C Design Tokens Community Group publishes, which design tools are converging on. `tessera tokens import` and `tessera tokens export` move tokens between that and the shapes other tools actually write, without flattening aliases or losing a theme.

::: tip What was tested
Round trips of this repository's tokens and the full Tailwind preset (490 tokens) through each format, and fixtures written to match the known quirks of Tokens Studio and Penpot exports. It has not been run against a live Figma file or a current Tokens Studio export, so treat an import from a real file as one to read the notes of.
:::

## Export

```bash
npx tessera tokens export
```

writes strict [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/) token files and a [Resolver](https://www.designtokens.org/tr/2025.10/resolver/) document into `.tessera/export/dtcg`:

- the base files, one per file you have, as a set;
- one modifier per attribute (`theme`, `density`), with a context per theme file. The base is the default context, so a tool that applies no modifier gets the base values;
- aliases stay aliases (`{color.neutral.900}`), and units stay explicit (`{ "value": 16, "unit": "px" }`).

A theme's `$extends`, `$attribute` and `$auto` are Tessera's, not DTCG's, so they are not in the theme files: the attribute is the modifier's name, and `$auto` (the media query that switches a theme automatically) is kept under the modifier's `$extensions.tessera`.

```bash
npx tessera tokens export --format tokens-studio --out tokens
```

writes what the Tokens Studio plugin (and Penpot, which uses the same shape) reads: one file per set, `$themes.json` and `$metadata.json`. Colors and dimensions are written as the strings those tools use (`"#2563eb"`, `"16px"`), and every token carries its type, because a set is read on its own. Tokens Studio has no automatic switching, so `$auto` is reported and not exported.

## Import

```bash
npx tessera tokens import tokens.resolver.json
npx tessera tokens import tokens.json
npx tessera tokens import path/to/figma-export --out system/tokens
```

The format is detected: a Resolver document, plain DTCG files, or Tokens Studio files (a single file, or the multi-file layout). Pass `--format dtcg` or `--format tokens-studio` to say. Everything the importer reads is turned into Tessera token files, then **built before anything is written**: if the result has errors, nothing is written and the errors are printed.

It never overwrites. If a file would be replaced it stops and names it; import into a new folder with `--out`, or pass `--force`.

### What it does with a Resolver document

- Each set source becomes a base file of its own (so a tier set on a group is not merged away).
- The modifier's **default context** is the base: its values apply over the set. Every other context becomes a theme file, and the modifier's name becomes its `$attribute`.
- A context that **adds** a token the base does not have is [T1011](/reference/errors/T1011). Tessera themes only override values, and the importer reports that rather than quietly widening them.
- The files the document names are read from beside it.

### What it does with Tokens Studio

Tokens Studio writes tokens as `{ "value": "8", "type": "spacing" }`, so the importer maps its types to DTCG types and its string values to strict ones:

| Tokens Studio                                                                    | DTCG                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `color`                                                                          | `color` (hex, `rgb()`, `hsl()`, `oklch()` and named colors are parsed)              |
| `spacing`, `sizing`, `borderRadius`, `borderWidth`, `fontSizes`, `letterSpacing` | `dimension` (`"16px"`, `"1.5rem"`; a bare number is read as pixels, with a note)    |
| `opacity`, `lineHeights`                                                         | `number` (`"50%"` becomes `0.5`; a line height with `px` or `rem` is a `dimension`) |
| `fontFamilies`, `fontWeights`                                                    | `fontFamily`, `fontWeight` (`"SemiBold"` and `"Semi Bold"` become `600`)            |
| `boxShadow`                                                                      | `shadow` (an array is several layers; `innerShadow` becomes `inset`)                |
| `border`, `duration`, `cubicBezier`                                              | the same type                                                                       |

References are kept: `{spacing.base}` and the older `$spacing.base` both become `{spacing.base}`. A name Tessera cannot use (it must work as a CSS custom property: letters, numbers, `-` and `_`) is rewritten, and so is every reference to it.

Themes come from `$themes`. A token set that **every** theme turns on is the base; a set only some themes turn on belongs to those themes, and the theme's name is the file name (`density=compact` sets the attribute). Design tools often define the semantic layer only in the theme sets, which Tessera's override-only themes cannot do, so a token that exists only in theme sets is **added to the base with the first theme's value**, and the importer says how many. Without `$themes`, all the sets are merged into the base in order.

### What it skips

Some things cannot be written as a Tessera token: a gradient, a typography or composition composite, a math expression such as `{spacing.base} * 2`, an `em` or percent letter spacing, or a token that references one of those. Each is skipped with a [T1016](/reference/errors/T1016) note that names it, and **kept** under `$extensions.tessera.skipped` in the file it came from. Nothing disappears silently, and `tessera tokens export` puts the skipped tokens back, so a design tool's own token survives a trip through Tessera.

## From CSS variables and untyped JSON

Most teams do not have their tokens in a token format. They have a stylesheet of custom properties, or the JSON of Style Dictionary, which has no types. `tessera tokens import` reads both, and **keeps your names**: nothing is renamed to fit Tessera, and no size, naming scheme or number of tiers is required.

```bash
npx tessera tokens import src/globals.css
npx tessera tokens import tokens/        # every .json and .css file in the folder
```

**CSS.** The custom properties of `:root`, `html`, `:host`, `@layer` and Tailwind's `@theme` become tokens. A name is split at its dashes: `--color-brand-600` is `color.brand.600`. A name that is also the start of another (`--primary` and `--primary-foreground`) becomes the group's `$root`. `var(--x)` stays a reference (an alias) to `x`, and `var(--x, fallback)` uses the fallback when `--x` is not in the file. Custom properties in any other selector or media query (`.dark`, `@media (prefers-color-scheme: dark)`, a component) are not imported, and a note counts them with an example.

**Types come from values.** `#1d4ed8`, `rgb()`, `hsl()`, `oklch()` and the like are colors; `1rem` and `16px` are dimensions; `200ms` is a duration; `cubic-bezier()` is an easing; `0 1px 2px rgb(0 0 0 / 5%)` is a shadow (several layers are fine); `1px solid #ccc` is a border; a font stack with `sans-serif` or a name like `--font-sans` is a font family. A bare number could be several things, so the words in its name decide: `weight` is a font weight, `opacity` and `line-height` are numbers, `space`, `radius` or `size` is a length in pixels, `duration` is milliseconds, and anything else is a number.

**Style Dictionary.** A token with no `type`, or one of Style Dictionary's own (`size`, `time`), is typed the same way, and a reference written as `{color.base.gray.900.value}` becomes `{color.base.gray.900}`. Files in a Tokens Studio or Resolver export, and tokens that already have a type Tessera knows, are left as they are.

**What is left out is counted, never guessed:** `calc()`, `clamp()` and `url()` (a token is one value), gradients and keywords such as `currentColor`, a longer expression that mixes in a `var()`, and any value whose type cannot be told. Each is a note such as `Values computed with calc(), clamp(), min(), max() or url(): 4, for example "--radius-sm: calc(var(--radius) - 4px)".`

## From Figma styles

A link to a page or a frame of a Figma file is a source like any file. `tessera tokens import` reads the styles used under it through Figma's REST API and makes one token file of them:

```bash
npx tessera tokens import "https://www.figma.com/design/KEY/Name?node-id=1-2"
```

The link is the one Figma copies for **Copy link to selection**. Point it at the page or frame that uses the styles (the Colors page, the Typography page), or give several links, or mix links with files. A link with no page or frame in it is refused, because a whole file is tens of megabytes.

It needs a **personal access token** (Figma, Settings, Security, Personal access tokens, with the **File content** read scope) in your environment. It works on any plan, because it reads styles, not the Variables API, which needs Enterprise. The token is read from the environment only and is never written or printed.

In a Bash terminal:

```bash
export FIGMA_TOKEN=your_token_here
```

In PowerShell:

```powershell
$env:FIGMA_TOKEN = "your_token_here"
```

A style's name is its path: `Gray/900` is `color.gray.900`, and `Base/White` is `color.base.white`, in lower case with dashes. A first segment that only names the kind of style (`Colors/`, `Shadows/`, `Typography/`) is dropped.

| Figma style                            | Tessera tokens                                                                                                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fill (a solid color, with its opacity) | A `color` token                                                                                                                                                                                                                   |
| Effect: drop and inner shadows         | One `shadow` token, the layers from the top down, an inner shadow as `inset`                                                                                                                                                      |
| Effect: layer or background blur       | A `blur` dimension                                                                                                                                                                                                                |
| Text                                   | A `font.size`, a `font.weight`, a `font.line-height` and, if it is not zero, a `font.letter-spacing`, each at the style's path (`Text md/Medium` is `font.size.text-md.medium`), and each font family once as `font.family.inter` |

Tessera has no text composite, which is why a text style is several tokens. What is left out is listed as [T1016](/reference/errors/T1016), with how many and an example: gradients (Tessera has no gradient token), layout grids, effects that are not shadows or blurs, a style with more than one paint, the text case and decoration of a text style (the rest of it is imported), and a style from a library that is not in the file. Two styles that make one path keep the first; a name that is a group and a token at once (`Gray` and `Gray/500`) is refused.

Spacing and radii are not styles in Figma, so there is nothing to read for them: they arrive as variables, through [Tokens Studio or the plugin routes below](#the-figma-mapping).

Tested on the Untitled UI kit: its Colors, Effect styles and Typography pages gave 350 colors, 14 shadows, 4 blurs, 45 text styles and a font family in two seconds, and the 519 tokens built with no errors. The 110 gradient styles and 2 text styles with a text case or underline were listed as left out.

## The Figma mapping

Tessera does not ship a Figma plugin. The route from Figma is through a tool that writes tokens, and the mapping is the same in each:

| Figma variables               | Tessera                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------- |
| A collection                  | A group of tokens (or a set, in a Tokens Studio export)                         |
| A mode (Light, Dark, Compact) | A theme: `data-theme="dark"`, or `data-density="compact"` for another attribute |
| An alias to another variable  | An alias, never flattened                                                       |
| A number with a unit          | An explicit `{ "value", "unit" }`                                               |

The ways to get variables out of Figma are a plugin that exports them as Tokens Studio sets or DTCG files, then `tessera tokens import`, or the Variables REST API. **The REST API needs an Enterprise plan and a full seat**, according to [Figma's documentation](https://developers.figma.com/docs/rest-api/variables), so most teams will use a plugin. Check the page before relying on either, because Figma changes its plans.

Going back, `tessera tokens export --format tokens-studio` gives a set per file and the `$themes` that combine them, which the plugin reads back into Figma variables.

## Errors

- [T1016](/reference/errors/T1016): an import skipped or adjusted something. A warning that names the token.
- [T1017](/reference/errors/T1017): an import could not read what it was given (not JSON, or a Resolver that names a file you did not give).

Both commands are in the [CLI reference](/reference/cli).
