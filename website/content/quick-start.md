# Quick start

Introduced in v0.1 (Milestones 11 and 12b).

Tessera is one package, `@pixelscriptio/tessera`. You make a folder, install it, and start a project in it. The commands below are the same in every shell: no `export`, no `&&`.

## Prerequisites

Node.js 20 or newer and npm (pnpm and Yarn work the same way).

## Create a project

::: code-group

```bash [bash, zsh]
mkdir my-app
cd my-app
git init
npm init -y
npm install @pixelscriptio/tessera
npx tessera init
npm run dev
```

```powershell [PowerShell]
mkdir my-app
cd my-app
git init
npm init -y
npm install @pixelscriptio/tessera
npx tessera init
npm run dev
```

:::

`npx tessera init` asks which starting point you want (see below) and writes the project into the folder you are in. `npm run dev` starts the dev server and prints its address. Open it and you have a page.

::: tip Using pnpm?
pnpm 11 stops an install when a dependency has an install script nobody has approved, and Vite depends on esbuild, which has one. If `pnpm add @pixelscriptio/tessera` ends with `ERR_PNPM_IGNORED_BUILDS`, run `pnpm approve-builds`, allow `esbuild`, and run the install again. npm only prints a warning about it, and the project works either way: esbuild runs from a prebuilt binary.
:::

If you would rather not install first, `npm create @pixelscriptio/tessera my-app` starts a project in a new folder in one step.

### Until the package is published

Packages are not on npm yet, so install from a tarball made in a checkout of the repository (`pnpm install && pnpm build` there first), then continue as above:

```bash quickstart
mkdir my-app
cd my-app
git init
npm init -y
npm install "$TESSERA_TARBALL"
npx tessera init
```

```bash quickstart-serve
npm run dev
```

Make the tarball with `pnpm pack` in `packages/tessera` of the checkout, and set `TESSERA_TARBALL` to its path. In PowerShell: `$env:TESSERA_TARBALL = "C:\path\to\pixelscriptio-tessera-0.1.0.tgz"` and `npm install $env:TESSERA_TARBALL`. The docs test suite runs the commands in the first block exactly as written, in a clean folder, and checks that the dev server serves the page.

## Choose a starting point

| Preset     | What you get                                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tailwind` | A complete design system in `system/`, built from Tailwind's default theme: every color, the spacing scale, radii, type, shadows and more, with light and dark themes and three components. A styled index page. |
| `none`     | No tokens, themes or components, so nothing is checked against a design system yet. An index page and example files with the examples commented out.                                                             |

Skip the question with `npx tessera init --preset tailwind` or `--preset none`. With no terminal and no flag, `init` uses `tailwind` and says so. See [Starter presets](/guide/presets).

## What you have

```text
my-app/
  package.json            scripts: dev, build, preview, check
  tessera.config.ts       style rules and exemptions (empty to start)
  tsconfig.json
  system/                 the design system (tailwind preset)
    tokens/               colors, scale, effects, layout, semantic colors, themes/dark
    components/           Button, Card, Badge
  app/
    main.ts               loads the token CSS and starts the router
    layouts/default.tess  wraps every page
    pages/index.tess      the page at /
```

There is no `vite.config.ts` and no `index.html`: `tessera dev`, `build` and `preview` supply them. Add either file to the project and yours is used instead.

## Edit the first page

Open `app/pages/index.tess`, change the heading and save: the page updates without a reload.

```xml tess kind=page
<page>
{ "title": "Welcome" }
</page>

<template>
  <main>
    <h1>My first Tessera page</h1>
    <Button tone="primary">Go</Button>
  </main>
</template>
```

`Button` is not imported: components in `system/components` and `app/components` are found by name. Misspell it and the compiler says so, with a suggestion.

## Add a component

```bash
npx tessera new component Note
```

This writes `app/components/Note.tess` with a valid contract. Use `<Note>` in any template; no import is needed. Run `npx tessera check` to validate the project.

## Change a token

With the `tailwind` preset, open `system/tokens/semantic.tokens.json` and change `color.action.primary.bg` to another color, say `{color.emerald.600}`. The buttons change everywhere, and `npx tessera check` still passes unless the new color has too little contrast with white text, in which case it says which pair fails.

Then try the opposite on purpose: in a component's `<style>`, write `padding: 13px`.

```text
ERROR  T2102  app/components/Note.tess:14:12
  Raw length "13px" in "padding" is off the scale.
  Did you mean "$space.3" (12px)? Or write raw(13px, "reason") to keep it.
  Run `tessera explain T2102` for details.
```

`npx tessera check --fix` applies the suggestion when it is an exact match.

## Add Tessera to an existing codebase

Run `npx tessera init --preset none` in a folder that already has a `package.json`. It adds the scripts and the dependency, writes the files that are missing, and never overwrites one. Then record today's violations as a baseline, so enforcement fails only on new ones:

```bash
npx tessera baseline
```

Commit `tessera.baseline.json`. The counts can only go down. See [The command line](/guide/cli) and [Adopting in a legacy codebase](/cookbook/legacy-baseline).

## Next steps

- [Starter presets](/guide/presets): what each one generates.
- [Tutorial](/tutorial/): build up a page step by step.
- [Contracts](/guide/contracts) and [Styles and enforcement](/guide/styles).
- [The command line](/guide/cli).
