# Theming, density and multiple brands

Introduced in v0.1 (Milestone 2).

A theme is a file in `system/tokens/themes/` that overrides values of existing semantic tokens. It compiles to CSS that applies under a data attribute on the root element, so switching a theme changes one attribute and the browser recomputes the page. Nothing re-renders.

## Light and dark

```text
{
  "$extends": "base",
  "$auto": "prefers-color-scheme: dark",
  "color": { "surface": { "default": { "$value": "{color.neutral.900}" } } }
}
```

The file name is the theme name, so this is `data-theme="dark"`. `$auto` makes `data-theme="auto"` follow the system setting. Contrast is checked for the pairs your components declare and for every rule that sets a text and a background token, in **every** theme, so a theme that breaks readability fails the build.

## Density

Density is another attribute. A theme file that sets `"$attribute": "density"` (the `compact` theme in a new project) overrides the spacing tokens, and `setDensity('compact')` sets `data-density="compact"`. Components do not know about density; they use `$space.4`, and the value changes.

## Multiple brands

A brand is a theme on its own attribute:

```text
{
  "$extends": "base",
  "$attribute": "brand",
  "color": { "action": { "primary": { "bg": { "$value": "{color.green.600}" } } } }
}
```

This file, `acme.tokens.json`, applies under `[data-brand="acme"]`. Attributes are independent, so `data-theme="dark"` and `data-brand="acme"` can be set together. Where both a theme and a brand override the same token, the rule that comes later in the generated CSS wins, so keep brand files to tokens the other themes leave alone, or design the combinations you ship on purpose. Set the attribute yourself (`document.documentElement.dataset.brand = 'acme'`); `setTheme` and `setDensity` cover the two built-in attributes.

Contrast is checked per theme, not per combination of attributes, so test the combinations you offer.

## Rules for theme files

- `$extends` is required and must name the base set ([T1010](/reference/errors/T1010)).
- A theme cannot add a token ([T1011](/reference/errors/T1011)) or change a token's type ([T1012](/reference/errors/T1012)). Every theme exposes the same names.
- Two themes with the same name on the same attribute are [T1015](/reference/errors/T1015).

## Next steps

[Enforcement](/guide/design-systems/enforcement).
