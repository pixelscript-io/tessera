## How a Tessera app is written

You have probably not seen `.tess` files. Read this section before writing any. It is short and it is complete enough to build with; the full documentation is named under "Where the facts are".

A `.tess` file is a component, a page or a layout. It has up to five blocks, in any order: `<contract>` (components only), `<script>`, `<template>` (exactly one root element), `<style>`, and `<page>` (pages only).

### A component

Files in `app/components` are components, imported by tag name with no `import` (`<Chip>` finds `Chip.tess`). The file name equals the contract `name`. The contract is JSON, and it is the component's whole public surface: its `parts` (the class names other code may style), its `variants` (the first value is the default), its `slots` and its `events`.

The components of the Tessera UI library (`@pixelscriptio/tessera-ui`, which the presets install) are used the same way, with no `import`: `<Button>`, `<TextField>`, `<Dialog>`. Look a component up with `npx @pixelscriptio/tessera manifest` or the MCP server before using it. To change one, run `npx @pixelscriptio/tessera eject Button`: the copy in `app/components` replaces the library's.

```xml tess
<contract>
{
  "name": "Chip",
  "role": "group",
  "description": "A small label for a status.",
  "parts": ["root", "label"],
  "variants": { "tone": ["neutral", "success", "danger"] },
  "slots": { "default": "the label" },
  "events": { "remove": "fired when the chip is removed" }
}
</contract>

<script>
const count = state(0)
const text = derived(() => `Removed ${count.value} times`)

function remove() {
  count.value++
  emit('remove', count.value)
}
</script>

<template>
  <span class="root">
    <span class="label"><slot /></span>
    <button type="button" aria-label="Remove" @click="remove">x</button>
    <small if="count > 0">{text}</small>
  </span>
</template>

<style>
.root {
  display: inline-flex;
  gap: $space.2;
  padding: $space.1 $space.3;
  border-radius: $radius.md;
  background: $color.surface.raised;
  color: $color.text.default;

  &[data-tone='success'] {
    background: $color.surface.default;
  }
}
</style>
```

- A variant arrives on the root element as `data-tone="neutral"`; style it with `&[data-tone='success']`. Using it wrongly (`<Chip tone="sucess">`) is an error that names the right value.
- The template has **one root element, and it has `class="root"`**. Every class you use in the template and style is scoped to the component.
- `state(0)` makes a signal and `derived(() => ...)` computes from signals. In `<script>` read and write them with `.value`. In the template a top-level signal is written bare (`{count}`).
- `emit('remove', value)` must name an event in the contract. `props({ label: '' })` returns read-only signals for the variants and for extra props.
- `state`, `derived`, `effect`, `onCleanup`, `onMount`, `props`, `emit`, `get`, `post`, `put`, `patch`, `del`, `useRoute` and `navigate` need no import in a `.tess` file.

### The template

| Feature         | Syntax                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Text            | `{expression}`                                                                                  |
| Attribute       | `:title="expression"` (computed), `title="text"` (static)                                       |
| Event           | `@click="handler"` or `@click="count++"`; components declare their own events, such as `@press` |
| Two-way binding | `bind:value="name"` on `input`, `textarea`, `select`; `name` must be a `state()`                |
| Condition       | `if="expr"`, `else-if="expr"`, `else` on consecutive sibling elements                           |
| List            | `each="item in items" key="item.id"` (the key is required)                                      |
| Component       | `<Button tone="primary" @press="save">Save</Button>`                                            |
| Slot            | `<slot />`, `<slot name="icon" />`; fill one with `slot="icon"` on a child                      |

A name in an expression must be declared in `<script>` or be an `each` variable. A signal inside an object or array is not unwrapped: write `.value`, or take it out into a top-level `const`.

### Styles

`<style>` is plain CSS with nesting. **Write design tokens, never raw values**: `$space.4`, `$radius.md`, `$color.text.default`, `$font.size.lg`. `padding: 13px` is an error with the nearest token suggested. Prefer semantic tokens (`$color.surface.default`, `$color.action.primary.bg`) to primitive ones (`$color.blue.600`), because semantic tokens change with the theme. The tokens that exist are in `.tessera/manifest.json`, and `resolve_value` in the MCP server answers "what token is 13px?".

Use the project's components (listed below) instead of building buttons and fields from scratch. Style only the parts a component's contract lists.

### A page and routing

A file in `app/pages` is a page and its path is its URL: `index.tess` is `/`, `about.tess` is `/about`, `blog/[slug].tess` is `/blog/:slug`, `404.tess` is the not-found page. A page has no `<contract>`. It may have a `<page>` block (JSON: `title`, `layout`). Layouts are files in `app/layouts` with a `<slot />`. Links use `<Link to="/about">` with a route that exists; `useRoute()` gives the current `path`, `params` and `query`, and `navigate('/about')` goes there.

```xml tess kind=page
<page>
{ "title": "Welcome" }
</page>

<script>
const route = useRoute()
const name = state('')
</script>

<template>
  <main class="root">
    <h1>Hello, {name}</h1>
    <input aria-label="Your name" bind:value="name" />
    <Link to="/">Home</Link>
  </main>
</template>

<style>
.root {
  padding: $space.6;
  color: $color.text.default;
}
</style>
```

### Data from a server

`get` reads, and `post`, `put`, `patch` and `del` write. They need no import. A read has `data`, `error`, `loading` and `refreshing`, which the template reads bare. Show `loading` and `error`, or the compiler warns (W4105).

```xml tess kind=page
<script>
const tasks = get('/tasks')
const add = post('/tasks')
const title = state('')

async function submit() {
  await add({ title: title.value })
  title.value = ''
}
</script>

<template>
  <main class="root">
    <p if="tasks.loading">Loading...</p>
    <p else-if="tasks.error">Could not load: {tasks.error.message}</p>
    <ul else>
      <li each="task in tasks.data" key="task.id">{task.title}</li>
    </ul>
    <input aria-label="New task" bind:value="title" />
    <button type="button" :disabled="add.pending" @click="submit">Add</button>
  </main>
</template>
```

- A read follows the signals in its parameters (`get('/users/:id', { id })`), shares one answer with every component that asks for the same path, retries, and is refreshed when a write to the same path succeeds. Do not copy server data into state.
- Each file in `app/apis` is a server with its own base URL: `app/apis/github.ts` exports `createApi({ base: 'https://api.github.com' })` (imported from `@pixelscriptio/tessera/core`) and a script calls `github.get('/users/:name', { name })`. A file named `default.ts` is what plain `get` and `post` use.
- A description beside it (`github.api.json`, or made by `npx @pixelscriptio/tessera api import openapi.json --name github`) makes the compiler check each call: the endpoint, its parameters and the fields a template reads.

### State that components share

A `.ts` file in `app/state` is shared state, named after the file, usable in every `.tess` file with no import. It is made of signals and functions, and it is **read-only outside its file**: a component changes it by calling the file's functions.

```ts
// app/state/cart.ts
import { derived, state } from '@pixelscriptio/tessera/core'

export const items = state<string[]>([])
export const count = derived(() => items.value.length)

export function add(name: string) {
  items.value = [...items.value, name]
}

export function clear() {
  items.value = []
}
```

A template then reads `{cart.count}` and `each="name in cart.items"`, and handlers call `cart.add('A book')`. `@click="cart.items = []"` is an error (T5011) that names `cart.clear()`. A member the file does not export is T5012. Use state for data several components need and the user changes (a cart, a draft, a filter); use `state()` in a component for data only it needs.

### The loop

After every change, run `npm run check`. It prints the same errors the build does, each with a fix, and `npx @pixelscriptio/tessera explain T4008` explains any code. `npm run dev` runs the app with hot updates. Run Tessera only through the npm scripts or as `npx @pixelscriptio/tessera <command>`: a bare `npx tessera` can download an unrelated package of that name when Tessera is not installed. Do not guess a component, variant, token or API member: look it up in the manifest or with the MCP tools, or in the documentation.
