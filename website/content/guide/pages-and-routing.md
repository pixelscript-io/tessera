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

`navigate(address)` goes to another site only over http or https; any other address (`javascript:`, `data:`, `mailto:`) is rejected with an error, so `navigate(route.query.next)` cannot run script ([Security](/guide/security)).

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
- `data`: the reads the page needs, started when the person navigates to it, before its code has loaded. See [Data for a page](#data-for-a-page).
- `wait`: `true` to keep the current page until that data is in. See [Data for a page](#data-for-a-page).

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

## Data for a page

A page that reads from an API asks for it only once it is on screen, after its code has loaded. If the page says what it needs, the request starts the moment the person clicks, in step with the code, so the two do not wait for each other:

```xml tess
<page>
{
  "title": "Posts",
  "data": ["/posts", { "path": "/comments", "query": { "limit": 10 } }]
}
</page>

<script>
const posts = get('/posts')
</script>

<template>
  <main>
    <p if="posts.loading">Loading...</p>
    <ul else>
      <li each="post in posts.data" key="post.id">{post.title}</li>
    </ul>
  </main>
</template>
```

Each entry is a path (on the default API), or an object with `path`, `api` (the name of a file in `app/apis`) and `query`. A `:name` in a path is filled from the route's parameters, so `"/posts/:id"` on `/posts/[id]` asks for the post being opened. At most 8 entries. The page's own `get` joins the request already on its way (one request, not two), so nothing in the script changes.

By default the page shows at once and its read has the states it always has (`loading`, `error`, `refreshing`). A page that is not worth showing without its data says `"wait": true`: the router keeps the current page and address until the data is in (or has failed, which the page then shows as its own error). A failed or slow prefetch never blocks a page that does not wait, and never throws.

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

- **The page is hydrated.** Each element in the HTML says the order it was made in (`data-h`). When the script loads, the router does not make the page again: it finds those elements and gives them their behavior, so a field the visitor typed in, or a focus, before the script arrived is still there. If what is in the HTML is not what the app makes (the HTML came from another build, or someone changed it), the router says so in the console and makes the page from nothing, as it did before hydration existed. A page is never left half done.
- **A page with `data` is written with it.** The reads in its `<page>` block are fetched in Node during the build, so the HTML shows the real content with no loading state, and the answers are written after the page as JSON the browser does not run (`<script type="application/json" id="tessera-data">`). The page shows them with no request, then asks again once it is up, so what shows is not as old as the build, and the old data stays on screen until the new arrives. If a read cannot be fetched at build time the page is not written (named with the reason), and it still works as an app.
- **What is declared is public.** The answers go into HTML that anyone can read, and the build fetches without a person's sign-in. Declare only data that is the same for everyone, never a read that needs a key or a token.
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
