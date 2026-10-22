# Examples

## The kitchen-sink app

`examples/kitchen-sink` is a real Tessera app that every milestone is dogfooded in: components with contracts and styles, the system's `Button`, a theme and density switcher, pages, a dynamic route, a 404 page and two layouts. Its source is the example; this page shows the parts.

### The entry

<<< ../../../examples/kitchen-sink/app/main.ts{ts}

### A page with a parameter

<<< ../../../examples/kitchen-sink/app/pages/blog/[slug].tess{xml}

### A layout

<<< ../../../examples/kitchen-sink/app/layouts/default.tess{xml}

### A component that uses a system component

<<< ../../../examples/kitchen-sink/app/components/ConfirmBar.tess{xml}

Run it from the checkout:

```bash
pnpm --filter kitchen-sink dev
```

It serves on port 5290. Its tests (`examples/kitchen-sink/app/*.browser.test.ts`) show how components, the router and layouts are tested in a real browser, and `examples/kitchen-sink/src/build.test.ts` shows a production build putting every page in its own chunk.

## A project from `tessera init`

[The Quick start](/quick-start) makes the smallest example: a theme, one `Button`, a layout and an index page.

## Live demos

A live demo embedded in this site would run in an isolated frame so Tessera's runtime does not interfere with the site's own. That arrives with the playground, which is deferred.
