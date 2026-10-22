# Styles and enforcement

Introduced in v0.1 (Milestone 6).

A `<style>` block is plain CSS with nesting. Values come from design tokens, and the compiler checks every declaration.

```xml tess
<contract>
{
  "name": "Card",
  "role": "group",
  "parts": ["root", "button"],
  "variants": { "tone": ["neutral", "primary"] }
}
</contract>

<template>
  <div class="root"><button class="button">Go</button></div>
</template>

<style>
.root {
  padding: $space.4;
  border-radius: $radius.md;
  background: $color.surface.raised;
  color: $color.text.default;

  &[data-tone='primary'] {
    background: $color.surface.default;
  }
}

.button {
  background: $color.action.primary.bg;
  color: $color.action.primary.fg;

  &:hover {
    background: $color.action.primary.bg-hover;
  }
}
</style>
```

- `$color.action.primary.bg` becomes `var(--t-color-action-primary-bg)`.
- Classes are scoped to the component: `.root` in `Counter.tess` is `.t-Counter__root`, in the CSS and in the template. Classes listed as `parts` in the contract are the public ones; others are private.
- The CSS goes in `@layer tessera.components`, below `tessera.overrides`, so app CSS in the overrides layer wins without specificity fights.
- Variants are `data-*` attributes on the root, so `&[data-tone="danger"]` targets one. A value the contract does not declare is an error (T2114).
- `:class="..."` bindings are not scoped (W4102); use a data attribute or `if`/`else` with static classes.

## What is checked

| You write                                                                            | Result                                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `$token.path` that exists                                                            | OK                                                                               |
| `$token.path` that does not exist                                                    | Error T2104, with the nearest token                                              |
| A raw color (`#fff`, `rgb()`, `hsl()`, a name like `red`)                            | Error T2101, with the closest token by perceptual distance                       |
| A raw length, duration or number in a governed property (`padding: 13px`)            | Error T2102, with the nearest scale step                                         |
| A token of the wrong type or group for the property (`padding: $color.text.default`) | Error T2103                                                                      |
| A raw value in any other property (`width: 13px`, `z-index: 10`)                     | OK                                                                               |
| `0`, `auto`, `100%`, `inherit`, `currentColor`, `transparent`                        | OK                                                                               |
| `raw(13px, "legacy modal", "2027-03-01")`                                            | Warning T2111, counted; error T2110 after the date; error T2108 without a reason |
| Text color and background tokens that fail WCAG contrast in any theme                | Error T2107                                                                      |
| A primitive token (`$color.blue.600`)                                                | Warning T2105 (or an error, by config)                                           |

Governed properties by default: spacing (`padding`, `margin`, `gap`, ...), radius, `font-size`, `opacity`, durations and easing, `box-shadow`, and colors. A raw color is rejected in any property.

### Contrast

When one rule sets both a `color` token and a `background` token, the compiler checks their contrast in the base rule, in every state or variant rule (using the base for whatever it does not set), and in every theme. Pairs across parts are declared in the contract:

```text
"contrast": [{ "foreground": "label", "background": "root" }]
```

The default is WCAG AA (4.5:1). A pairing the compiler cannot see is not checked: a color set by a script, text on a background from a parent the contract does not name, or a translucent background. A declared pairing that has no token on one side is a warning (T2109).

## Fixing violations

`applyFixes` (used by `tessera check --fix` from Milestone 11) applies only unambiguous fixes: a raw value that is exactly one token (`16px` is `$space.4`), or a misspelled token with one clear target. A fix never changes what renders in the default theme. Everything else is a suggestion.

## Adopting in an existing codebase

A baseline records how many violations each file has per rule. Builds fail only on violations beyond it, and the counts can only go down.

```ts
import { createBaseline, applyBaseline, pruneBaseline } from '@tessera/compiler'
```

Contract errors and expired `raw()` escapes are never baselined.

## Exceptions

Lower the severity for a path, with a reason, and optionally an expiry. After the date the rule is an error again.

```ts
tessera({
  config: {
    severity: [
      {
        files: 'app/legacy/**',
        rules: '*',
        level: 'warn',
        reason: 'Migrating to tokens',
        expires: '2027-03-01',
      },
    ],
    contrast: { level: 'AAA' },
    governed: { width: { type: 'dimension', groups: ['space'] }, margin: false },
  },
})
```

A `warn` or `off` setting without a reason is an error (T2112).
