## How a Tessera app is written

You have probably not seen `.tess` files. Read this section before writing any. It is short and it is complete enough to build with; the full documentation is named under "Where the facts are".

A `.tess` file is a component, a page or a layout. It has up to five blocks, in any order: `<contract>` (components only), `<script>`, `<template>` (exactly one root element), `<style>`, and `<page>` (pages only).

### A component

Files in `app/components` are components, imported by tag name with no `import` (`<Chip>` finds `Chip.tess`). The file name equals the contract `name`. The contract is JSON, and it is the component's whole public surface: its `parts` (the class names other code may style), its `variants` (the first value is the default), its `slots` and its `events`.

The components in `system/components` (a new project has `Button` and `Card`; more are added with `tessera add`, see the list below) are used the same way, with no `import`: `<Button>`, `<Card>`. Look a component up with `npx @pixelscriptio/tessera manifest` or the MCP server before using it, and edit its file in `system/components` to change it.

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

**Expressions.** Any JavaScript expression works in `{}` and in bindings: a call (`{title.slice(0, 80)}`), a comparison or ternary (`:emphasis="filter === 'all' ? 'solid' : 'outline'"`), strings joined (`:to="'/posts/' + post.id"`), an arrow function (`each="t in items.filter((x) => !x.done)"`), and in a handler an assignment (`@click="draft = ''"`). A top-level signal is read bare in all of them. Browser globals (`localStorage`, `window`, `document`) are not names in a template (T4006): use them in `<script>` or in a state file and expose a function or a value.

**What a handler receives.** An event sends one value, and `$event` is that value: `@input="setName($event)"` for a TextField, which sends the new text. What each component sends is written beside its events in the list of components below, for example `@change (fired with { value, label } when ...)`. To change a local `state()` from a handler, assign it (`@press="open = true"`) or call a function.

### Styles

`<style>` is plain CSS with nesting. **Write design tokens, never raw values**: `$space.4`, `$radius.md`, `$color.text.default`, `$font.size.lg`. `padding: 13px` is an error with the nearest token suggested. Prefer semantic tokens (`$color.surface.default`, `$color.action.primary.bg`) to primitive ones (`$color.blue.600`), because semantic tokens change with the theme. The tokens that exist are in `.tessera/manifest.json`, and `resolve_value` in the MCP server answers "what token is 13px?".

Use the project's components (listed below) instead of building buttons and fields from scratch: a catalogue component has its label, error and accessibility built in. A plain `<input aria-label="...">` is fine where no component fits. Style only the parts a component's contract lists.

A layout holds what every page shares (a nav, a footer) and is styled once. Each page styles its own `<main>`, so spacing you gave one page is not on another. To space the children of a component (the fields in a `Form`, the content of a `Card`), wrap them in an element of your own with a class, and give that class `display: flex; flex-direction: column; gap: $space.4`.

### A page and routing

A file in `app/pages` is a page and its path is its URL: `index.tess` is `/`, `about.tess` is `/about`, `blog/[slug].tess` is `/blog/:slug`, `404.tess` is the not-found page. A page has no `<contract>`. It may have a `<page>` block (JSON: `title`, `layout`, and `data` and `wait`, below). Layouts are files in `app/layouts` with a `<slot />`. Links use `<Link to="/about">` with a route that exists; `useRoute()` gives the current `path`, `params` and `query`, and `navigate('/about')` goes there.

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
- Each file in `app/apis` is a server with its own base URL: `app/apis/github.ts` exports `createApi({ base: 'https://api.github.com' })` (imported from `@pixelscriptio/tessera/core`) and a script calls `github.get('/users/:name', { name })`. A file named `default.ts` is what plain `get` and `post` use. For a different server, add a file with a lowercase name of its own and leave `default.ts` alone. The file name is then a name you use in any script or template with no import (`github.get(...)`).
- A description beside it (`github.api.json`, or made by `npx @pixelscriptio/tessera api import openapi.json --name github`) makes the compiler check each call: the endpoint, its parameters and the fields a template reads. It is optional: without one the calls work and are not checked, and neither are the fields a template reads. Write one only from the server's real answers (fetch one and look): a wrong description makes the compiler report errors that are not real (T5008).

A page at `app/pages/tasks/[id].tess` reads its parameter from `useRoute()`. Pass it to the read as a `derived`, and the read follows it when the address changes:

```xml tess kind=page
<page>
{ "title": "Task" }
</page>

<script>
const route = useRoute()
const id = derived(() => route.params.id)
const task = get('/tasks/:id', { id })
</script>

<template>
  <main class="root">
    <Link to="/">Back</Link>
    <p if="task.loading">Loading...</p>
    <p else-if="task.error">Could not load: {task.error.message}</p>
    <h1 else>{task.data.title}</h1>
  </main>
</template>

<style>
.root {
  padding: $space.6;
  color: $color.text.default;
}
</style>
```

A page that reads from an API can say what it needs in its `<page>` block so the request starts when the person clicks, not after the page's code has loaded: `"data": ["/posts", { "path": "/users/:id", "query": { "limit": 10 } }]` (a path on the default API, or an object with `path`, `api` and `query`; `:id` is filled from the route). The page's own `get` joins that request, so the script does not change. `"wait": true` keeps the current page until the data is in. With `tessera build --prerender` a page with `data` is written with its data in the HTML and hydrated when the script loads. That HTML is public and is built with no sign-in, so declare only data that is the same for everyone, never a read that needs a key or token.

A write can show its result before the server answers: `post('/todos', { optimistic: { '/todos': (list, input) => [...list, { id: 0, title: input.title }] } })`. Each key is the path of a read (`:id` is filled from what is sent), and the function gets that read's data and what the call sent and returns the data to show; return a new value, never change the one you are given. A failed write takes its change back and `error` says why. Use it when failure is rare and the answer is easy to predict. To build a page before its API exists, give the API a description (`app/apis/<name>.api.json`) and run `npm run dev -- --mock`: the dev server answers from the description with made-up data, and `?mock=error`, `?mock=empty`, `?mock=loading` or `?mock=slow` on the page's address shows those states. Only the dev server mocks.

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

### Keeping data after a reload

State resets when the page reloads. To keep it, make it with `persisted(key, initial)` instead of `state(initial)`: it is a signal that keeps itself in `localStorage` and reads itself back, checks what it reads, and is a plain signal where there is no storage (a prerender). Keep only what the person chose; anything in the storage can be read by any script, so never a secret.

```ts
// app/state/todos.ts
import { derived, persisted } from '@pixelscriptio/tessera/core'

export const items = persisted('todos', [] as Array<{ id: number; title: string; done: boolean }>)
export const remaining = derived(() => items.value.filter((t) => !t.done).length)

export function add(title: string) {
  items.value = [...items.value, { id: Date.now(), title, done: false }]
}
```

- When the shape of what is kept changes, raise `version` and give `migrate(old, fromVersion)`: `persisted('todos', [], { version: 2, migrate })`. Without `migrate` an older value is forgotten. `validate` refuses a value of the wrong shape.
- To keep it in the address, as `?page=2`, use `urlState('page', 1)`: a string, a number or a boolean, or give `parse` and `serialize`. A link to that address opens the page with it set.
- In tests, call `resetState()` before each one: it puts all shared state back, and forgets what `persisted` and `urlState` kept.

### Forms

A form is `Form` with fields from the catalogue (`add Form TextField Select Checkbox`), and a `type="submit"` button.

```xml tess kind=page
<script>
const plans = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
]
const values = state({ name: '', email: '', plan: 'free', news: false })
const errors = state({})
const saved = state(false)
const rules = {
  name: (v) => (v.trim() ? '' : 'Enter your name.'),
  email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? '' : 'Enter an email such as ada@example.com.'),
}

function setValue(key, value) {
  values.value = { ...values.value, [key]: value }
}

function invalid(detail) {
  errors.value = detail.errors
  saved.value = false
}

function sent() {
  errors.value = {}
  saved.value = true
}
</script>

<template>
  <main class="root">
    <Alert if="saved"><span slot="title">Saved</span></Alert>
    <Form :values="values" :rules="rules" @invalid="invalid($event)" @submit="sent()">
      <div class="fields">
        <TextField :error="errors.name" @input="setValue('name', $event)">
          <span slot="label">Name</span>
        </TextField>
        <TextField :error="errors.email" @input="setValue('email', $event)">
          <span slot="label">Email</span>
        </TextField>
        <Select :options="plans" value="free" @change="setValue('plan', $event.value)">
          <span slot="label">Plan</span>
        </Select>
        <Checkbox @toggle="setValue('news', $event.checked)">Send me the newsletter</Checkbox>
        <Button type="submit">Save</Button>
      </div>
    </Form>
  </main>
</template>

<style>
.root {
  padding: $space.6;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: $space.4;
}
</style>
```

- `Form` takes `values` and `rules` (a function for each key that returns the error message, or an empty string). It runs the rules when the person submits, by the button or by Enter in a field, and fires `submit` with the values or `invalid` with `{ errors }`.
- Fields have no `name`. The key you use in `values`, `rules` and `errors` is the only link between a field and its rule, and you wire each field yourself: `@input` to store what it sends, `:error` to show the message.
- A field keeps what is typed. To set it or clear it from outside (empty it after a submit), keep the text in a `state()`, pass it as `:value="draft"`, and update it from the input event (`@input="draft = $event"`): then `draft = ''` empties the field. Assigning a value the state already has does nothing, so a `value` that is never updated from the input cannot clear it.
- A single field has no event for Enter. To submit with Enter, put the fields in a `Form`, which submits on it.
- A `Select`, `Checkbox` or `RadioGroup` reports a choice only when the person makes one: start `values` with the default you show (`plan: 'free'`), and pass the same `value`. A `Select` gives `{ value, label }` in `@change`, a `Checkbox` `{ checked }` in `@toggle`.
- An error says what is wrong and how to fix it, and appears after a submit. A rule for required text should trim it (`v.trim() ? '' : 'Enter your name.'`). `Alert` has no success tone (its tones are neutral, primary and danger): use the default tone for "Saved".

### Changing the tokens

Tokens are JSON files in `system/<name>/tokens/`, where `<name>` is the design system named in `tessera.config.ts`: `colors`, `scale` (spacing, radii, type), `effects` (shadows, opacity, motion), `semantic` (the meanings components use: surface, text, action, border, focus), and one file for each theme in `themes/`, such as `themes/dark.tokens.json`, which overrides values for that theme.

- Change what a color means in `semantic.tokens.json`: `"bg": { "$value": "{color.green.700}" }` points at a color of the palette. **A theme that sets the same token keeps its own value**: changing `color.action.primary.bg` in `semantic.tokens.json` does not change it in dark if `themes/dark.tokens.json` sets it too, so change both. (`tessera dev` says so when you save.)
- Add a token beside its neighbours: `"18": { "$value": { "value": 4.5, "unit": "rem" } }` in the `space` group of `scale.tokens.json` makes `$space.18`. A theme file can only override tokens that exist.
- Keep the contrast. Text must stay at 4.5:1 in every theme, and `action.primary.fg` is checked against both `bg` and `bg-hover` (error T2107 names the pair, the theme and the ratio). With white text, both of them must be dark enough in every theme.
- The primary action is `color.action.primary.*` (`bg`, `bg-hover`, `fg`, `text`). The focus ring (`color.focus.ring`) and `color.brand.*` are separate tokens: change them too if the brand color changes.
- The layout of a new project, `app/layouts/default.tess`, already has Light, Dark and Auto buttons that call `setTheme`; change those instead of adding another switcher.
- `setTheme('dark')`, from `@pixelscriptio/tessera/tokens`, switches the theme of the page, and `setTheme(null)` goes back to the base. To remember a choice, store it yourself and call `setTheme` in `app/main.ts` before `createApp()`, so the page does not flash. The documentation has this as the theme-switcher recipe.

### The loop

After every change, run `npm run check`. It prints the same errors the build does, each with a fix, and `npx @pixelscriptio/tessera explain T4008` explains any code. `npm run dev` runs the app with hot updates. A passing `check` and `build` does not show that the feature works, or even that your edit landed (an edit that failed still passes): run `npm run dev`, use the page, and read the file back.

`npm run dev` prints the address of the app (the "App" line) and of the docs. The port moves when another is busy, so take the address from that output, and check that the page is this project's before you trust what you see. Stop the server with Ctrl+C; if you started it as a background process, stop it by its process id. To see an error state, point the API at a wrong path for a moment: a read retries before it reports an `error`, so it takes a moment to appear. After you add an API or a state file, run `npx @pixelscriptio/tessera agent-files` so AGENTS.md lists it (`tessera add` does this for components). Run Tessera only through the npm scripts or as `npx @pixelscriptio/tessera <command>`: a bare `npx tessera` can download an unrelated package of that name when Tessera is not installed. Do not guess a component, variant, token or API member: look it up in the manifest or with the MCP tools, or in the documentation.
