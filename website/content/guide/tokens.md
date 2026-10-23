# Tokens

Introduced in v0.1 (Milestone 2).

Tokens are written in [W3C DTCG](https://www.designtokens.org/) 2025.10 JSON (`*.tokens.json`) and compiled to CSS custom properties inside `@layer tessera.tokens`.

```json
{
  "color": {
    "$type": "color",
    "blue": { "600": { "$value": { "colorSpace": "srgb", "components": [0.145, 0.388, 0.922] } } },
    "action": { "primary": { "bg": { "$value": "{color.blue.600}" } } }
  }
}
```

becomes

```css
@layer tessera.tokens {
  :where(:root) {
    --t-color-blue-600: #2563eb;
    --t-color-action-primary-bg: var(--t-color-blue-600);
  }
}
```

- **Aliases** (`{group.token}`) stay as `var()` references, so overriding a primitive in a theme flows to everything that aliases it.
- **Types supported:** color, dimension, duration, number, fontFamily, fontWeight, cubicBezier, strokeStyle (string form), shadow, border, transition.
- **Names** may use letters, digits, `-` and `_`.
- **Not supported yet:** group `$extends`, JSON Pointer `$ref`, gradient and typography types. They produce an error (T1009 or T1004) rather than being ignored.

## Themes

A theme file in `system/tokens/themes/` overrides values of existing tokens. The file name is the theme name.

```json
{
  "$extends": "base",
  "$auto": "prefers-color-scheme: dark",
  "color": { "surface": { "default": { "$value": "{color.neutral.900}" } } }
}
```

- `$extends` is required and must name the base set (`base`).
- `$attribute` picks the `data-*` attribute: `theme` (default), `density`, `brand`, and so on.
- `$auto` makes `data-theme="auto"` follow a media feature such as `prefers-color-scheme: dark`.
- A theme cannot add a token name (T1011) or change a token's type (T1012).

## Switching at runtime

```ts
import { setTheme, setDensity } from '@pixelscriptio/tessera/tokens'

setTheme('dark') // sets data-theme="dark" on <html>
setDensity('compact') // sets data-density="compact"
setTheme(null) // back to the base values
```

Only an attribute changes. Nothing re-renders; the browser recomputes styles from the new custom properties.

## Errors

Token errors have codes T1001 to T1015. Each error names the file and the token path, and suggests the closest valid token where it can.
