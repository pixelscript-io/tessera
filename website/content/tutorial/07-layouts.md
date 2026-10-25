# 7. Layouts

A layout is the markup pages share. `app/layouts/default.tess` already wraps every page in your project. Add a second one and use it from a page:

```xml tess kind=layout
<template>
  <div class="root">
    <p class="back"><Link to="/blog">Back to the blog</Link></p>
    <slot />
  </div>
</template>

<style>
.root {
  padding: $space.6;
  background: $color.surface.raised;
  color: $color.text.default;
}

.back {
  margin: 0;
}
</style>
```

Save it as `app/layouts/focus.tess`. A page picks it by name in its `<page>` block, or opts out with `false`:

```xml tess kind=page
<page>
{ "title": "Post", "layout": "focus" }
</page>

<template>
  <main>
    <h1>A post</h1>
  </main>
</template>
```

A name that does not exist is a compile error with a suggestion ([T6003](/reference/errors/T6003)). Moving between pages that share a layout keeps the layout's elements, so its state survives; moving to a page with a different layout swaps it.

## Check

In the dev server, give an element in the default layout a marker with the browser tools (`$0.dataset.mark = 'x'`), click to another page and check that the marker is still there.

## Next steps

[Data from an API](/tutorial/08-data).
