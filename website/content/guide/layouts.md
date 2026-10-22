# Layouts

Introduced in v0.1 (Milestone 10).

A layout is the markup several pages share: a header, a navigation, a footer. It lives in `app/layouts/` and puts the page where its `<slot />` is.

```xml tess kind=layout
<!-- app/layouts/default.tess -->
<template>
  <div class="root">
    <SiteNav />
    <slot />
  </div>
</template>

<style>
.root {
  display: flex;
  flex-direction: column;
  gap: $space.4;
}
</style>
```

A layout has no `<contract>` and no `<page>` block, uses the same auto-imports (`<SiteNav />` needs no import) and the same token enforcement as every other file, and must contain a default `<slot />`:

```text
ERROR  T6006  app/layouts/default.tess:1:1
  This layout has no <slot />, so pages would have nowhere to render.
  Add <slot /> where the page should appear.
  Run `tessera explain T6006` for details.
```

## Which layout a page gets

- `app/layouts/default.tess` applies to every page, and to your `404.tess`, with nothing to write.
- A page picks another layout by name in its `<page>` block: `{ "layout": "focus" }` uses `app/layouts/focus.tess`.
- A page opts out with `{ "layout": false }` and renders on its own.

If the app has no `default.tess`, pages without a `layout` render on their own.

An unknown name fails the compile with a suggestion:

```text
ERROR  T6003  app/pages/about.tess:2:19
  Unknown layout "defualt".
  Did you mean "default"?
  Run `tessera explain T6003` for details.
```

Layouts are a flat folder: the name is the file name, and nested layouts (a layout inside a layout) are not supported.

## Navigating inside a layout

Moving between pages that share a layout keeps the layout: its elements are not rebuilt, so its state, focus and scroll position inside it survive. Moving to a page with a different layout, or none, swaps the layout.

Everything the router does on a navigation still happens across layout boundaries: the title, the announcement, focus on the page's root element and scroll position. Focus goes to the page, not the layout, so a keyboard user starts at the top of the new content.

Each layout is its own lazy chunk, loaded before the page is shown, so there is no flash of a page without its layout.
