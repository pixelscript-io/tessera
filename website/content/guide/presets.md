# Starter presets

Introduced in v0.1 (Milestone 12b); the presets were changed in v0.9 (Milestone 45).

`tessera init` asks which tokens (`tailwind` or `none`) and, with `tailwind`, which starter app (`todo`, `page` or `blank`). You choose when you run it: in a terminal it asks, and `--tokens` and `--starter` answer. `--preset tailwind`, `--preset unstyled` or `--preset none` is the older spelling of the tokens. `none` is a blank slate with no tokens and no components (see below); the starters are built from components, so with `none` the app is one empty page. This page describes the tokens and the `page` starter. The choice is made in `init`, not when you run `npm install`, because install scripts cannot prompt reliably (pnpm skips them by default, as do `--ignore-scripts` and most CI). With no terminal and no flag, `init` uses the `page` starter and `tailwind` and says so.

Both presets write the same project, and differ only in the tokens:

```text
app/
  main.ts                 loads the tokens and starts the app
  layouts/default.tess    a header with a Light, Dark and Auto switch
  pages/index.tess        the index page: a button that counts, and a list from an API call
  apis/default.ts         the API the page calls (and default.api.json, which describes it)
  state/counter.ts        shared state: the count the button changes
system/
  components/             Button and Card, each with its docs file
  <name>/tokens/          the design system's tokens (tailwind or unstyled)
tessera.config.ts         names the design system and says which one is active
```

It also writes `AGENTS.md`, `llms.txt`, `CLAUDE.md` and `.mcp.json`, so a model can build in the new folder without looking Tessera up ([AI coding tools](/guide/agents#a-new-project-is-ready-for-an-ai-tool)).

The project is yours: `init` writes ordinary files, never overwrites one, and leaves no Tessera or Tailwind configuration you cannot see. The components are copies, not a dependency: your project depends on `@pixelscriptio/tessera` and nothing else, and you edit `system/components/Button.tess` like any file of your own. More components come from [Tessera UI](/guide/tessera-ui).

## The starter app

The index page shows the three things most apps do first:

- **A click.** The button reads and changes `counter`, a file in `app/state`: `counter.bump()` in the page, `{counter.count}` in its text. There is no import and no provider ([shared state](/guide/shared-state)).
- **Data.** `get('/users')` in the page's script lists users from `app/apis/default.ts`, with loading and error states handled ([data](/guide/data)). `default.api.json` describes the API, so the compiler can check the call and the fields the page reads.
- **Styles from tokens.** Every value in the page's `<style>` is a token, so a raw value is a compile error with the nearest token suggested.

The page is the same file in both presets, and uses only tokens that both define, so you can change the design system without touching the page.

## `tailwind`

Tokens built from the default theme of Tailwind CSS (4.3.3), written as Tessera tokens, in `system/tailwind/tokens/`. It is data, not a dependency: your project does not install Tailwind, has no Tailwind build step and does not use Tailwind's utility classes. It is a Tessera design system whose primitives have Tailwind's names and values, so if you know `red-500` or `rounded-xl`, you know where to look.

```text
system/tailwind/tokens/
  colors.tokens.json     every Tailwind color: all palettes, all shades, black and white (primitives)
  scale.tokens.json      spacing, radii, font families, sizes, line heights, weights, letter spacing
  effects.tokens.json    shadows, drop and text shadows, blur, durations, easing, opacity
  layout.tokens.json     breakpoints, containers, perspective, aspect ratio
  semantic.tokens.json   surface, text, border, action, focus and status colors (light)
  themes/dark.tokens.json   the dark overrides
  README.md, TAILWIND-LICENSE
```

How it is organized:

- **Primitives** (`color.red.500`) carry Tailwind's names. Components do not use them directly (that is [T2105](/reference/errors/T2105)); they use the **semantic** layer (`color.surface.default`, `color.text.muted`, `color.action.primary.bg`), which a theme overrides. See [Token architecture](/guide/design-systems/token-architecture).
- **The dark theme** overrides the semantic colors and applies under `data-theme="dark"`, and under `data-theme="auto"` when the system asks for dark. The header's switch calls `setTheme`.
- **Spacing** follows Tailwind's scale: `$space.4` is 1rem, and a half step is written `$space.0-5` because a name cannot contain a dot.
- **Contrast** is checked for every text and background pair in both themes when the files compile. The preset ships with no failures, and a change you make that causes one is [T2107](/reference/errors/T2107).
- **Not included:** Tailwind's animation shorthands (`spin`, `ping`, `pulse`, `bounce`), which need keyframes rather than values, and its utility classes.

### Credit

The values come from Tailwind CSS, which is MIT licensed. The license is in `system/tailwind/tokens/TAILWIND-LICENSE`. The data is regenerated from Tailwind's own theme definition by a script in the Tessera repository, and a test checks the committed tokens match it. To update to a newer Tailwind, replace `packages/cli/tailwind/theme.css` and run `pnpm --filter @tessera/cli generate:tailwind`; nothing in your project depends on Tailwind's release schedule.

## `none`: a blank slate

No tokens and no components: `system/design/tokens/` holds only a README, `system/components/` holds `_example.tess.txt` (a commented example of how a component is written, ignored by Tessera), and the app is one page that uses no tokens. Nothing is guessed about your design. Bring your own tokens, under your own names, with `npx tessera tokens import <source>` (see [Importing and exporting tokens](/guide/interchange)).

## `unstyled`

The same token names with plain values, in `system/unstyled/tokens/`: black on white, square corners, no shadows, and a dark theme. It defines every token the starter app and the components use, and about sixty in all, so the project builds and every check runs, but nothing has a look of its own. It is for people who want to make the design themselves.

```text
system/unstyled/tokens/
  colors.tokens.json     surface, text, border, action, focus and status colors (light)
  scale.tokens.json      spacing, corner radius (all square), type sizes, weights, families
  effects.tokens.json    shadows (none), motion and opacity
  themes/dark.tokens.json   the dark values
  README.md              examples of changing the design, each in one place
```

The files describe themselves: each has a `$description` saying what to change, and the README lists examples, such as setting `radius.md` to `0.5rem` to round every corner, or `color.action.primary.bg` to your brand color. `npx tessera check` fails if text on a color you chose is too faint to read.

## The docs use the same files

`npm run dev` serves the app, and the docs of the design system beside it. The docs style their own pages (the page and panel colors, text, borders, buttons, the font and the corner radius) from your semantic tokens, so the app and its documentation share one set of token files: change `color.surface.default` and both change. The docs read these names, and use their own built-in look for any that are missing:

```text
color.surface.default  color.surface.hover  color.text.default  color.text.muted  color.border.default
color.action.primary.bg  color.action.primary.fg  color.status.success  color.status.danger
font.family.sans  font.family.mono  radius.sm
```

Both presets define all of them. If the tokens have a theme that follows the system (`$auto`), the docs start on it and the theme switcher in the docs moves the whole page.

## Design systems in `system/`

A design system is a folder of tokens, `system/<name>/tokens`, and `system/components` is styled by whichever is active. `tessera.config.ts` lists them and says which one the app and the docs use:

```ts
export default {
  systems: [
    { name: 'Tailwind', path: '/tailwind' },
    { name: 'Unstyled', path: '/unstyled' },
  ],
  defaultSystem: 'Tailwind',
}
```

`path` is the folder under `system/` and defaults to the name in lower case. With no `defaultSystem`, the first system is active. A project can hold several systems to try them side by side: change `defaultSystem` and the same components and pages take another look. They can only be swapped if they define the same token names, which is the list in [Tessera UI](/guide/tessera-ui#the-token-interface); a missing token is a compile error in the component that uses it, naming the token. Systems do not refer to each other's tokens, so each is a folder you can copy or delete.

A project from before v0.9 keeps `system/tokens` with no `systems` in its config, and works as it did.

The config is checked ([T2115](/reference/errors/T2115)): a system with no name, two with the same name or folder, a path outside `system/`, or a `defaultSystem` that is not in the list.

## Changing your mind

The presets are only starting points. To start from the other one, run `npx tessera init --preset unstyled` (or `tailwind`) in the same folder: it writes the files that are missing and leaves the rest, so your pages and components stay. Delete what you do not want, or edit the tokens: they are yours.

If you used the `tessera` or `none` presets of an earlier version, `tessera` is now a design system you add (see [Tessera UI](/guide/tessera-ui)), and `none` is now a blank slate with no tokens and no components (the plain-valued tokens are the `unstyled` preset).

## Next steps

[The command line](/guide/cli), [Token architecture](/guide/design-systems/token-architecture) and [Tessera UI](/guide/tessera-ui).
