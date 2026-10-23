# Starter presets

Introduced in v0.1 (Milestone 12b).

`tessera init` starts a project from one of two presets. You choose when you run it: in a terminal it asks, and `--preset tailwind` or `--preset none` answers it. The choice is made in `init`, not when you run `npm install`, because install scripts cannot prompt reliably (pnpm skips them by default, as do `--ignore-scripts` and most CI). With no terminal and no flag, `init` uses `tailwind` and says so.

Either way the project is yours: `init` writes ordinary files, never overwrites one, and does not leave Tessera or Tailwind configuration you cannot see.

## `tailwind`

A complete design system in `system/`, built from the default theme of Tailwind CSS (4.3.3), written as Tessera tokens. It is data, not a dependency: your project does not install Tailwind, has no Tailwind build step and does not use Tailwind's utility classes. It is a Tessera design system whose primitives have Tailwind's names and values, so if you know `red-500` or `rounded-xl`, you know where to look.

```text
system/tokens/
  colors.tokens.json     every Tailwind color: all palettes, all shades, black and white (primitives)
  scale.tokens.json      spacing, radii, font families, sizes, line heights, weights, letter spacing
  effects.tokens.json    shadows, drop and text shadows, blur, durations, easing, opacity
  layout.tokens.json     breakpoints, containers, perspective, aspect ratio
  semantic.tokens.json   surface, text, border, action, focus and brand colors (light)
  themes/dark.tokens.json   the dark overrides
  README.md, TAILWIND-LICENSE
system/components/
  Button.tess  Card.tess  Badge.tess
app/
  layouts/default.tess   a header with a Light, Dark and Auto switch
  pages/index.tess       a styled index page
```

How it is organized:

- **Primitives** (`color.red.500`) carry Tailwind's names. Components do not use them directly (that is [T2105](/reference/errors/T2105)); they use the **semantic** layer (`color.surface.default`, `color.text.muted`, `color.action.primary.bg`), which a theme overrides. See [Token architecture](/guide/design-systems/token-architecture).
- **The dark theme** overrides the semantic colors and applies under `data-theme="dark"`, and under `data-theme="auto"` when the system asks for dark. The header's switch calls `setTheme`.
- **Spacing** follows Tailwind's scale: `$space.4` is 1rem, and a half step is written `$space.0-5` because a name cannot contain a dot.
- **Contrast** is checked for every text and background pair in both themes when the files compile. The preset ships with no failures, and a change you make that causes one is [T2107](/reference/errors/T2107).
- **Not included:** Tailwind's animation shorthands (`spin`, `ping`, `pulse`, `bounce`), which need keyframes rather than values, and its utility classes.

The index page uses only tokens and the three components, so it is a worked example of the system: a hero, buttons, cards and a theme switch. Change any token and it changes with it.

### Credit

The values come from Tailwind CSS, which is MIT licensed. The license is in `system/tokens/TAILWIND-LICENSE`. The data is regenerated from Tailwind's own theme definition by a script in the Tessera repository, and a test checks the committed tokens match it.

## `none`

No tokens, no themes, no components. Nothing is checked against a design system until you add one, so you can start without opinions.

```text
app/
  layouts/default.tess              a plain layout, with an example in a comment
  pages/index.tess                  a plain page, with state, styles and components as comments
  components/Example.tess.example   a component with a contract, inert until renamed
system/
  tokens/base.tokens.json.example   example tokens, inert until renamed
  README.md                         how to turn each piece on
```

Examples are commented out, not deleted: the live files have the examples in `<!-- -->` comments (a `.tess` file ignores a comment between blocks) or `//` comments. JSON has no comments, so the tokens example is a separate `.example` file; a file ending in `.tokens.json` is read, and one ending in `.example` is not.

To turn on a design system:

1. Rename `system/tokens/base.tokens.json.example` to `base.tokens.json` and edit it.
2. In `app/main.ts`, uncomment `import 'virtual:tessera/tokens.css'`.
3. Write `padding: $space.4;` in a `<style>` block. A raw value off the scale is now an error with the nearest token suggested.

Until a token folder exists, the checks that need tokens are off, and `npx tessera check` still validates contracts, templates, routes and layouts.

## Changing your mind

Both presets are only starting points. To move from `none` to a full system, run `npx tessera init --preset tailwind` in the same folder: it writes the files that are missing and leaves the rest, so your pages and components stay. Delete what you do not want, or edit the tokens: they are yours.

## Next steps

[The command line](/guide/cli) and [Token architecture](/guide/design-systems/token-architecture).
