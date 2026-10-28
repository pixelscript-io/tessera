# Sharing state between components

Introduced in 0.6.5 (Milestone 34).

Some data is needed by more than one component: what is in a cart, a draft, a filter, whether a drawer is open. In other frameworks this is a store, with a provider, an id, a reducer or `storeToRefs`. In Tessera it is a file.

A script file in `app/state` is **shared state**. It is named after the file and every `.tess` file can use it without an import:

```ts
// app/state/cart.ts
import { derived, state } from '@pixelscriptio/tessera/core'

export const items = state<string[]>([])
export const count = derived(() => items.value.length)

export function add(name: string) {
  if (items.value.length < 3) items.value = [...items.value, name]
}

export function clear() {
  items.value = []
}
```

Anywhere in the app, a component names `cart`:

```xml tess kind=page
<template>
  <main>
    <p>{cart.count} in the cart</p>
    <ul>
      <li each="name in cart.items" key="name">{name}</li>
    </ul>
    <button @click="cart.add('A book')">Add</button>
    <button @click="cart.clear()">Empty</button>
  </main>
</template>
```

There is no provider, no store class and no id. The state file is an ordinary script file of signals ([`state` and `derived`](/guide/reactivity)) and functions, so it has to import them as any `.ts` file does. Two components that read `cart.count` change together, because they read the same signal.

## What the compiler does with it

**It reads the file.** `cart.count` is a signal, and the template reads its value, with no `.value` to write and no `storeToRefs`. A function member is called as it is. You can take state apart, and a signal stays reactive:

```xml tess kind=page
<script>
const { count, add } = cart
</script>

<template>
  <button @click="add('A book')">{count} in the cart. Add one.</button>
</template>
```

In a script you read a signal member by its `.value`, as any signal: `cart.count.value`.

**It checks the member.** A member the file does not export is an error with the nearest name ([T5012](/reference/errors/T5012)):

```text
ERROR  T5012  app/components/Header.tess:3:44
  "cart" has no "cout".
  Did you mean "count"?
```

**State is read-only outside its file.** A component cannot assign to it, change its list in place, or bind an input to it. Every change goes through a function of the file ([T5011](/reference/errors/T5011)):

```text
ERROR  T5011  app/components/Drawer.tess:9:27
  "cart.items" can only be changed inside app/state/cart.ts.
  Change it with cart.add() or cart.clear(), or add a function to that file.
```

This is the reason to use a function for a change, even a small one. All the changes to a piece of state are in one file, so when a total is wrong you read one file, not forty components. The rules about the data live there too: the cart above holds at most three things, and no component can skip that. A flag such as "the drawer is open" gets a `toggle()`.

The check is at compile time. A plain `.ts` file can still write to a signal, and reading is never restricted.

## Names

The file name is the name: `cart.ts` is `cart`. It must be a name a script can use, not one Tessera already uses (`state`, `get`...) and not the name of an [API](/guide/data) ([T5010](/reference/errors/T5010)). Declaration files and tests (`cart.test.ts`) are left out. A script that declares a `cart` of its own keeps its own.

## What is state, and what is not

- **Data from a server is not state.** `get('/products')` is already shared, cached and refreshed for every component that asks for the same path. Copying it into a state file makes a second copy to keep in step. Use [`get`](/guide/data).
- **Data one component needs belongs to it.** A `state()` in the component's script, with props and events to talk to its parent, is simpler than shared state.
- **Data many components need, which the user changes,** is shared state: a cart, a selection, a draft, a filter, a theme choice.

## For editors and AI tools

The compiler writes `.tessera/state.d.ts`, so TypeScript knows what `cart` is in a `.tess` script. The manifest lists each state file with its members, and the MCP server has two tools, `list_state` and `get_state`, that tell an AI tool what exists and how to change it. `AGENTS.md` says that state is read-only outside its file.

## Keeping state

State is back to its first value when the page reloads. Four things change that, all in the state file, and all safe where there is no browser (a prerender, a test in Node), where they are a plain signal.

### Keeping it in the browser: `persisted`

`persisted(key, initial)` is `state(initial)` that keeps itself in `localStorage` under `key` and reads itself back the next time. It is a signal like any other: assign it and it is kept.

```ts
// app/state/todos.ts
import { derived, persisted } from '@pixelscriptio/tessera/core'

export const items = persisted('todos', [] as Array<{ id: number; title: string; done: boolean }>)
export const remaining = derived(() => items.value.filter((t) => !t.done).length)

export function add(title: string) {
  items.value = [...items.value, { id: Date.now(), title, done: false }]
}
```

What is read back is checked, because anyone can edit the storage. Text that is not what `persisted` wrote, a value another version wrote, or a value your `validate` refuses starts it from `initial` as if nothing were kept. When the storage is missing, full or blocked, the value lives in memory and nothing throws. A change made in another tab is followed.

Options (the third argument):

- `version` (default `1`) changes when the shape of what is kept changes. A value kept by an **older** version goes through `migrate(stored, fromVersion)`, and the result is written back at once, so it runs once; with no `migrate`, or if it throws, the value is forgotten. A value kept by a newer version is forgotten.
- `validate(value)` returns whether what was read has the right shape (a type guard).
- `storage` is where to keep it: `sessionStorage` keeps it until the tab closes.

```ts
export const prefs = persisted(
  'prefs',
  { size: 'normal', zoom: 1 },
  {
    version: 2,
    // Version 1 kept only the size, as text.
    migrate: (old, from) => (from === 1 ? { size: String(old), zoom: 1 } : (old as never)),
  },
)
```

Keep only what the person chose: a theme, a draft, a filter. Anything in the storage can be read by any script on the page, so do not keep a secret in it.

### Keeping it in the address: `urlState`

`urlState(name, initial)` is state shown as the query parameter `name`: `?page=2`. A link to that address opens the page with it set, and the router's navigation and the back button change it.

```ts
// app/state/list.ts
import { urlState } from '@pixelscriptio/tessera/core'

export const page = urlState('page', 1)
export const sort = urlState('sort', 'name')
```

A string, a number and a boolean need nothing more (a number must be a plain one: `?page=1e3` is not a number and gives the initial value). For another kind, give `parse` and `serialize`, which say how it is written in the address; `serialize` returns `undefined` to leave it out.

```ts
export const tags = urlState<string[]>('tags', [], {
  parse: (text) => text.split(','),
  serialize: (list) => (list.length ? list.join(',') : undefined),
})
```

When the value is the initial one the parameter is left out, so the address stays clean (`/list`, not `/list?page=1`). A change **replaces** the address and does not add a history entry, so the back button leaves the page and does not step through the values, and the rest of the address (other parameters, the `#` part) is kept. What is written is encoded, so a value cannot add to the address.

### Putting it back in tests: `resetState`

`resetState()` puts every piece of shared state back to the value it started with: the state in the files of `app/state`, and every `persisted` and `urlState`, which also forget what they stored and what the address said. Call it before each test, so one test's cart is not in the next.

```ts
import { beforeEach } from 'vitest'
import { resetState } from '@pixelscriptio/tessera/core'

beforeEach(() => resetState())
```

State made inside a component is not touched: it is made again with the component. The build marks each file in `app/state` (it puts a call at the top of it), which is how `resetState` knows what is shared; a `state()` made later, in a component, is not.

### Across an edit in the dev server

When you edit a state file while `tessera dev` runs, the file runs again. Each piece of state in it starts from the value it had, as long as the code still starts it from the same first value and the value is plain data (text, numbers, booleans, arrays and objects of them), so an edit does not empty a cart you filled to test it. If you change the first value in the code, the new first value is used. A `Map`, a `Date` or a class instance starts again.

## What is not built yet

- **State for a part of the page,** one copy per list item or dialog (what context does elsewhere), is Milestone 36.
- **Who reads and who changes each piece of state** in `tessera report`, and a warning for state nothing reads, is Milestone 37.
- **Auto-imports in state files.** A state file is a `.ts` file, so it imports `state` and `derived`.
- **A change through a destructured signal** (`const { items } = cart` then `items.value = []`) is not caught.

The plan is in the [roadmap](/releases/roadmap).

## Why it looks like this

- **A file is the store.** The folder is the convention, and the name is the key, as with [APIs](/guide/data) and components.
- **The compiler knows what is in it.** That is what makes `cart.count` work in a template without `.value`, and what makes a mistyped member an error.
- **One place changes it.** The read-only rule is what lets the compiler, and an AI tool, say who changes what.
