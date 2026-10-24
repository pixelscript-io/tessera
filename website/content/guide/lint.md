# Linting any project

Introduced in v0.5.

The style rules of `tessera check` do not need Tessera components. `tessera lint` runs them on the CSS of any project: React with CSS modules, Vue, Svelte, Astro or plain HTML. It checks that styles use your design tokens instead of raw values.

```bash
npx tessera lint --tokens design/tokens
```

```text
ERROR  T2102  src/Card.module.css:2:12
  Raw length "13px" in "padding" is off the scale.
  Did you mean "var(--t-space-3)" (12px)?
  Run `tessera explain T2102` for details.

1 error, 0 warnings in 14 files.
```

It exits with 1 if there is any error, so it works as a CI step. In a terminal it shows the line, a caret and whether `--fix` can fix it.

## What it reads

- `.css`, `.pcss` and `.postcss` files.
- The `<style>` element of `.vue`, `.svelte`, `.astro` and `.html` files, with line and column in the whole file.

It does not read Sass, Less or Stylus, or a `<style lang="scss">`, because those are not plain CSS. It counts them and says so at the end. It does not read CSS in JavaScript or Tailwind class names. With no paths it lints the project folder, skipping `node_modules`, build output and folders that start with a dot; give it files or folders to lint less.

## Where the tokens come from

Tokens are [DTCG files](/guide/tokens), the same ones Tessera builds from. `tessera lint` uses, in this order, `--tokens <folder>`, the `tokens` of `tessera.config.ts`, or `system/tokens`. Without any it stops and says so.

In CSS, a token is a custom property, written the way the token build writes it: `var(--t-space-4)`. If your project names them another way, say how with `--var-prefix`:

```bash
npx tessera lint --tokens design/tokens --var-prefix --ds-
```

## What it finds

| Code  | Finds                                                                       |
| ----- | --------------------------------------------------------------------------- |
| T2101 | A raw color, such as `#2563eb` or `red`, where a token should be used.      |
| T2102 | A raw length, duration or other value that is off the token scale.          |
| T2103 | A token of the wrong kind for the property, such as a color in `padding`.   |
| T2104 | A `var()` name that starts like a token but is not one, with the one meant. |
| T2105 | A primitive token used directly instead of a semantic one (a warning).      |
| T2107 | A text and background token pair, on one class, that fails contrast.        |

These are the same codes `tessera explain` describes. Contrast is checked in every theme. The properties checked, the contrast minimum and the primitives rule come from `governed`, `contrast` and `primitives` in `tessera.config.ts`.

A custom property you define yourself (`--gap`) is left alone, and so is anything that is not a governed property, such as `width` or `z-index`. Zero and keywords such as `auto` are fine.

## Fixing

```bash
npx tessera lint --fix
```

applies the fixes that are unambiguous: a raw value that is exactly a token, and a mistyped token name when one is clearly meant. What is left is reported.

## There is no `raw()`

In `.tess`, `raw()` says a value is deliberately off the system. CSS has no equivalent, so the ways out are in configuration, where they can be seen and expire:

```ts
export default defineConfig({
  severity: [
    {
      files: 'src/legacy/**',
      rules: '*',
      level: 'warn',
      reason: 'Old screens, moving to the system in Q1',
      expires: '2027-03-31',
    },
  ],
})
```

Once it has expired the exemption stops applying and the errors come back, with the reason in the message.

## Adopting it in an existing project

```bash
npx tessera lint --baseline
```

records today's violations in `tessera.lint-baseline.json`. After that only new violations fail. Counts can only go down: fixing one tells you the baseline can be lowered, and `tessera lint --prune` lowers it and never raises it. This file is separate from the baseline of `tessera check`, so a project that uses both keeps them apart.

## Other options

- `--json` prints the result for other tools: the number of errors and warnings, and for each file its diagnostics with code, line and column.
- `tessera lint --help` lists everything.
