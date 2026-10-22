# Token architecture

Introduced in v0.1 (Milestone 2).

Tokens come in three tiers, and the tier of a token says who may use it.

| Tier      | What it is                      | Example                     | Used by                      |
| --------- | ------------------------------- | --------------------------- | ---------------------------- |
| Primitive | A raw palette or scale value    | `color.blue.600`, `space.4` | Other tokens, not components |
| Semantic  | A meaning, aliasing a primitive | `color.action.primary.bg`   | Components                   |
| Component | A decision for one component    | `button.padding`            | That component               |

A theme overrides **semantic** tokens (`color.surface.default` is light in the base and dark in the dark theme), so everything that uses the meaning changes together. A component that uses a primitive such as `$color.blue.600` pins itself to one color and ignores the theme, which is why using one in a component is [T2105](/reference/errors/T2105). The rule is a warning by default; set `primitives: 'error'` in `tessera.config.ts` to make it an error.

The tier is set in `$extensions.tessera.tier` on a token or, more usually, on a group, and is inherited:

```json
{
  "color": {
    "$type": "color",
    "$extensions": { "tessera": { "tier": "primitive" } },
    "blue": { "600": { "$value": { "colorSpace": "srgb", "components": [0.145, 0.388, 0.922] } } }
  }
}
```

## Aliases

A semantic token aliases a primitive with `{color.blue.600}`. The CSS keeps the reference as `var(--t-color-blue-600)`, so overriding the primitive in a theme flows to everything that aliases it, and the manifest records both the alias and the resolved value for each theme.

## Naming

Name tokens by role, not appearance: `color.action.primary.bg`, not `color.blue.button`. Appearance changes between themes; roles do not. Paths become custom properties (`--t-color-action-primary-bg`), and the tools that read the token manifest (`tessera tokens build`) see the same paths.

## What is governed

Styles must take spacing, radii, font sizes, opacity, motion, shadows and colors from tokens. Which CSS properties are governed, and which token types and groups each accepts, is configurable: see [the config reference](/reference/config).

## Next steps

[Theming, density and multiple brands](/guide/design-systems/theming).
