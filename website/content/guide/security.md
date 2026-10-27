# Security

Introduced in 0.6.8. Tessera runs in your users' browsers and on your computer, so this page says what it protects against by default, and what stays your job.

## In the browser

**An address from data cannot run script.** Pages are full of values that came from somewhere else: an API answer, a query string, a form. When one reaches an attribute that the browser follows or loads (`href`, `src`, `action`, `formaction`, `poster`), a value that would run script (`javascript:` or `vbscript:`, however it is spelled, with tabs and spaces in it or not) is replaced by `about:blank`, and a warning says so once. `mailto:`, `tel:`, `https:`, relative addresses and `data:` images are left alone. A handler written as an attribute (`:onclick="value"`) is not set at all; write `@click`.

**`navigate()` only leaves the app for http and https.** `navigate(route.query.next)` after a sign-in is a common way to build an open redirect, and with `javascript:` an injected script. `navigate()` rejects any other address with an error that says so. Another site over http or https is handed to the browser as before. For `mailto:` and `tel:` use a normal `<a href>`.

**An API sends its headers only to its own origin.** An [API](/guide/data) has a base URL, and its `headers` (a token) and `credentials` go with the requests to that origin, or to the page's own origin when there is no base. A path that is a full address on another site (`get(item.next)`, or `//other.example.net/x`) is sent with neither, so a link inside an answer cannot collect a token. A header you name on the call itself, `get(path, {}, { headers })`, is always sent, because you wrote it there. To send an API's headers to any address, set `allowOtherOrigins: true` and be sure no address comes from data you do not trust.

```ts
export default createApi({
  base: 'https://api.example.com',
  headers: { authorization: `Bearer ${token}` },
  // allowOtherOrigins: true, // only if every address is yours
})
```

**Text is text.** `{expression}` in a template is set as text, and the prerender escapes text and attribute values, so data cannot add markup to a page.

## Things that stay yours

- **Keys in the browser are public.** Anything in `VITE_` variables is in the built page. A secret needs a server in front of it ([Fetching data](/guide/data#keys-and-domains)).
- **Cached answers outlive a sign-out.** An API remembers what it fetched. When a different person signs in during the same visit, call `clearApi()` (or the `clear()` of your API) first, so they do not see the last person's data for the next few seconds.
- **Third-party components and their descriptions** become part of `AGENTS.md` and of what the MCP server says. A model reads those as instructions. Read a component you did not write before you add it.

## On your computer

- **`tessera dev`, `preview` and `docs` listen on this computer only.** The docs app with `--edit` is the one that can write files: its address carries a key that is new each run, and every request is checked for the key, the host and the origin before its body is read.
- **Descriptions and tokens you import are data.** `tessera api import` reads OpenAPI JSON and writes a description; it does not run anything in it, and it writes the server address as a string literal. Token imports follow a Resolver's references only inside its own folder.
- **Run Tessera by its full name when it is not installed.** `npx tessera` runs the copy in `node_modules`. If Tessera is not installed, npx downloads a different package named `tessera` and runs that. Use `npm run check` and the other scripts that `init` adds, or `npx @pixelscriptio/tessera <command>`. The files `init` writes for AI tools do.
- **The packages have few dependencies.** `@pixelscriptio/tessera` depends on `vite` and `acorn`. The test tools of the accessibility suite (`vitest`, `@vitest/browser`, `playwright`, `axe-core`) are yours, installed by `tessera a11y`; keep them up to date, as they run a dev server while the tests run.

## Reporting a problem

Please do not open a public issue for a security problem. Report it privately through the Security tab of [the repository](https://github.com/pixelscript-io/tessera/security).
