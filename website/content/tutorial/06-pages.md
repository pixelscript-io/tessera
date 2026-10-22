# 6. Pages and routing

A file in `app/pages/` is a page, and its path is its URL. Create two:

```bash
tessera new page about
tessera new page blog/[slug]
```

```xml tess kind=page
<page>
{ "title": "About" }
</page>

<template>
  <main>
    <h1>About</h1>
    <Link to="/">Home</Link>
  </main>
</template>
```

`[slug]` is a parameter. Read it with `useRoute()`, which needs no import in a `.tess` file:

```xml tess kind=page
<page>
{ "title": "Post" }
</page>

<script>
const route = useRoute()
</script>

<template>
  <main>
    <h1>{route.params.slug}</h1>
    <Link to="/blog">All posts</Link>
  </main>
</template>
```

`<Link>` renders a real `<a href>`, goes through the router on a normal click, and leaves a Ctrl-click or a middle click to the browser. A literal `to` is checked against your routes:

```xml tess kind=page error=T6004
<template>
  <main>
    <Link to="/abuot">About</Link>
  </main>
</template>
```

```text
ERROR  T6004  app/pages/index.tess:3:15
  Unknown route "/abuot".
  Did you mean "/about"?
  Run `tessera explain T6004` for details.
```

On each navigation the router sets `document.title` from the page's `<page>` block, announces the new page to screen readers, and moves focus to the page, as a full page load would have.

## Check

Run the dev server and click between pages, then use the browser's back and forward buttons. Load `/blog/hello` directly: the page reads `hello` from the address.

## Next steps

[Layouts](/tutorial/07-layouts).
