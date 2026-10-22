# The route manifest

`app/pages/` is turned into routes by one function with no dependencies, which the compiler, the dev server and the browser runtime all use, so they cannot disagree.

## From files to routes

`index.tess` is its folder's default, `[name].tess` is a parameter, and a top-level `404.tess` is the not-found page. Two files of the same shape conflict, and neither is routed ([T6001](/reference/errors/T6001)), because silently picking one would hide a mistake. Matching prefers static segments to parameters, position by position, so `/blog/new` beats `/blog/:slug`.

## The virtual module

The plugin turns the manifest into a module, `virtual:tessera/routes`:

```text
export const routes = [
  { path: "/", load: () => import("/app/pages/index.tess") },
  { path: "/blog/:slug", load: () => import("/app/pages/blog/[slug].tess") },
]
export const notFound = () => import("/app/pages/404.tess")
export const layouts = { "default": () => import("/app/layouts/default.tess") }
```

Each page and layout is behind a dynamic import, so a bundler gives each its own chunk and a visit downloads only the page it lands on. Adding or removing a page file regenerates the module and the types without restarting the dev server.

## Types and checks

The same manifest writes `.tessera/routes.d.ts` (the route patterns and their parameters) and gives the compiler the route list, so `<Link to="/abuot">` fails to compile ([T6004](/reference/errors/T6004)) and a page's `layout` is checked against `app/layouts` ([T6003](/reference/errors/T6003)).

## At runtime

The router matches the address, loads the page (and its layout) before committing, shows it, and keeps the address bar, history, title, focus, announcements and scroll in sync. A newer navigation wins over a slower earlier one. See [Pages and routing](/guide/pages-and-routing).

## Next steps

[Why contracts and enforcement](/how-it-works/why).
