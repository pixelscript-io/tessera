# Quick start

Introduced in v0.1 (Milestone 11).

Tessera is not published yet, so you run it from a checkout of the repository. The commands marked below are run in a clean folder by the docs test suite, exactly as written, and must end with the dev server serving the index page.

## Prerequisites

- Node.js 20 or newer and [pnpm](https://pnpm.io/) 10.
- A checkout of the Tessera repository, with its packages installed and built (`pnpm install && pnpm build` in the checkout). Set `TESSERA` to its path:

```bash
export TESSERA=/path/to/tessera
```

## Create a project

```bash quickstart
node $TESSERA/packages/cli/bin/tessera.js init my-app
cd my-app
pnpm install
```

Once packages are published this becomes `pnpm create tessera my-app`. The `create-tessera` package is a one-line wrapper for `tessera init` and already works from the checkout.

`init` links the new project to your checkout instead of downloading Tessera's packages, which is why `pnpm install` needs no network access for them.

## Run it

```bash quickstart-serve
pnpm dev
```

Open the address Vite prints. You see the index page: a heading, a short instruction, and a `Button` that counts its clicks.

## Tour of the project

```text
my-app/
  index.html                 the page Vite serves; loads app/main.ts
  vite.config.ts             registers the Tessera plugin
  tessera.config.ts          style rules and exemptions (empty to start)
  system/
    tokens/                  base tokens and the dark and compact themes (DTCG JSON)
    components/Button.tess   a system component
  app/
    main.ts                  imports the token CSS and starts the router
    layouts/default.tess     wraps every page
    pages/index.tess         the page at /
```

## Edit the first page

Open `app/pages/index.tess` and change the heading. Save: the page updates without a reload.

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
node $TESSERA/packages/cli/bin/tessera.js new component Note
```

This writes `app/components/Note.tess` with a valid contract. Use `<Note>` in any template; no import is needed. Run `tessera check` to validate the project.

## Change a token

Open `system/tokens/base.tokens.json` and change `space.4`. Every component that uses `$space.4` changes with it, and `tessera check` still passes because styles refer to the token by name.

Then try the opposite on purpose: in a component's `<style>`, write `padding: 13px`.

```text
ERROR  T2102  app/components/Note.tess:14:12
  Raw length "13px" in "padding" is off the scale.
  Did you mean "$space.3" (12px)? Or write raw(13px, "reason") to keep it.
  Run `tessera explain T2102` for details.
```

`tessera check --fix` applies the suggestion when it is an exact match.

## Add Tessera to an existing codebase

You do not have to fix everything first. Record today's violations as a baseline, and enforcement fails only on new ones:

```bash
node $TESSERA/packages/cli/bin/tessera.js baseline
```

Commit `tessera.baseline.json`. The counts can only go down. See [The command line](/guide/cli) and [Adopting in a legacy codebase](/cookbook/legacy-baseline).

## Next steps

- [Tutorial](/tutorial/): build up a page step by step.
- [Contracts](/guide/contracts) and [Styles and enforcement](/guide/styles).
- [The command line](/guide/cli).
