# Pages and routing

Introduced in v0.1 (Milestone 9).

A file in `app/pages/` is a page, and its path is its URL. There is no route table to keep in step with the files.

| File                         | URL            |
| ---------------------------- | -------------- |
| `app/pages/index.tess`       | `/`            |
| `app/pages/about.tess`       | `/about`       |
| `app/pages/blog/index.tess`  | `/blog`        |
| `app/pages/blog/[slug].tess` | `/blog/:slug`  |
| `app/pages/404.tess`         | no match found |

`index` is a folder's default. `[name]` is a parameter. A top-level `404.tess` is shown when nothing matches (without one, a small built-in page is).

## Starting the app

```ts
// app/main.ts
import 'virtual:tessera/tokens.css'
import { createApp } from '@pixelscriptio/tessera/router/app'

createApp().mount('#app')
```

`mount()` returns a promise that resolves once the first page is on screen. The routes come from the `virtual:tessera/routes` module the Vite plugin generates; adding or removing a page file updates it, the types and the link checks without restarting the dev server.

The router uses the History API. There is no hash mode, and no nested routes, guards or loaders.

## A page

```xml tess
<page>
{ "title": "About" }
</page>

<script>
const route = useRoute()
</script>

<template>
  <main>
    <h1>About</h1>
    <Link to="/blog">Read the blog</Link>
  </main>
</template>
```

A page has no `<contract>`: it is not part of the design system. Its template has one root element, like a component's.

The `<page>` block is JSON (comments allowed). Its fields:

- `title`: the `document.title` while the page is shown.
- `layout`: the layout to render the page in, or `false` for none. See [Layouts](/guide/layouts).

Each page is its own lazy chunk. A visit downloads the entry and the page it lands on, and the components that page uses. Components shared by several pages are split out once.

## Links

`<Link>` is a normal component with its own contract. It renders a native `<a href>` underneath, so it can be opened in a new tab, copied, and read by assistive technology. It marks the link to the page you are on with `aria-current="page"`.

A plain click goes through the router. A modified click (Ctrl, Cmd, Shift, Alt), a middle click, a `target` other than the same window, and a `download` link are left to the browser.

A literal `to` is checked against the routes when the file compiles:

```text
ERROR  T6004  app/pages/about.tess:12:19
  Unknown route "/abuot".
  Did you mean "/about"?
  Run `tessera explain T6004` for details.
```

A path that matches a parameter route (`/blog/hello` for `/blog/:slug`) is fine. A dynamic target (`:to="'/blog/' + post.slug"`) is not checked, and neither is a link that does not start with `/`; use a plain `<a>` for another site.

## Reading the route

```ts
const route = useRoute()
route.path // "/blog/hello"
route.params // { slug: "hello" }
route.query // { draft: "1" }  the first value of each key
route.hash // "#top"
```

Reading a property inside `derived()` or `effect()` subscribes to it, so the value stays current as the user navigates.

## Navigating from code

```ts
navigate('/blog/hello')
navigate('/login', { replace: true }) // replace the history entry
```

Both return a promise. `navigate()` before `createApp().mount()` throws a clear error. `useRoute` and `navigate` need no import in a `.tess` file; in a plain `.ts` file import them from `@pixelscriptio/tessera/router`.

## What happens on each navigation

The router does what a browser does for a full page load, because a single-page app takes that away:

- **Title.** `document.title` becomes the page's `<page>` title.
- **Announcement.** A visually hidden polite live region says `Navigated to About`, so a screen reader hears the change.
- **Focus.** Focus moves to the new page's root element (given `tabindex="-1"`, without scrolling), so a keyboard user starts at the top of the new page and not on a link that no longer exists.
- **Scroll.** A new page starts at the top, a link with a `#hash` scrolls to that element (so does an app that starts on an address with one), and back and forward restore where you were.

The first page of a visit does none of this: the browser already did it.

If a page is slow to load and the user navigates again, the newest navigation wins. If a page fails to load (offline, for instance), the current page and address stay as they were and `navigate()` rejects.

## Typed routes

The plugin writes `.tessera/routes.d.ts` (add `.tessera` to `.gitignore`), which gives TypeScript the list of routes and their parameters. `RoutePattern` from `@pixelscriptio/tessera/router` is then the union of the real patterns.

## Prerendering

```bash
npx tessera build --prerender
```

builds the app as usual and then renders every page that has no parameters to HTML: `/` is `index.html`, `/about` is `about/index.html`, and the not-found page is `404.html`. Each has the page's content, its layout and components, its `<title>` and the stylesheets it needs, so it shows at once, with or without JavaScript, and a search engine reads the content. The scripts and the stylesheets of the build are linked as before. Static hosts (GitHub Pages, Netlify, Cloudflare Pages, S3) serve `about/index.html` for `/about` and `404.html` for a missing page.

- **There is no hydration.** When the script loads, the router replaces the prerendered content with the live page, which is the same page. A link, a form or a focus ring that the visitor used before the script loaded is not carried over.
- **A route with a parameter** (`/blog/[slug]`) is not rendered: there is no one page for it. It is named in the output and works as it always did.
- **A page that needs a browser** is skipped. It is rendered in Node with no browser behind it, so a page script that reads `window` or `document` at its top (not inside an effect, a handler or `onMount`) cannot be: the output says which page and why (`/wide was not prerendered: window is not defined`), and it still works in the browser.
- The page's `<title>` is the `<page>` block's. A page with none keeps the one in `index.html`.
- It needs an empty `<div id="app"></div>` in `index.html`, which the project's default shell has.

## Route errors

Two files that map to the same route are an error that names both, and neither is routed, so nothing silently picks one:

```text
ERROR  T6001  app/pages/blog.tess:1:1
  Route conflict: blog.tess and blog/index.tess both map to "/blog".
  Keep one of them. A folder default is index.tess, so blog.tess and blog/index.tess clash.
  Run `tessera explain T6001` for details.
```

`[id].tess` and `[slug].tess` in the same folder clash too. T6002 covers a file name that cannot be a route (a space, a catch-all `[...rest]`, a repeated parameter, a nested `404.tess`). A build fails on either; the dev server shows them in the error overlay.

When two routes could match, the more specific one wins: static segments before parameters, so `blog/new.tess` beats `blog/[slug].tess`. Matching is case sensitive and ignores a trailing slash.
