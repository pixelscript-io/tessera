# Sharing state between components

Introduced in v0.7 (Milestone 34).

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

## What is not built yet

- **Keeping state:** saving it in the browser (`persist`), in the address (`url`), resetting it in tests, and keeping it across a hot update in the dev server. These are Milestone 35. Until then, state is back to its first value when the page reloads.
- **State for a part of the page,** one copy per list item or dialog (what context does elsewhere), is Milestone 36.
- **Who reads and who changes each piece of state** in `tessera report`, and a warning for state nothing reads, is Milestone 37.
- **Auto-imports in state files.** A state file is a `.ts` file, so it imports `state` and `derived`.
- **A change through a destructured signal** (`const { items } = cart` then `items.value = []`) is not caught.

The plan is in the [roadmap](/releases/roadmap).

## Why it looks like this

- **A file is the store.** The folder is the convention, and the name is the key, as with [APIs](/guide/data) and components.
- **The compiler knows what is in it.** That is what makes `cart.count` work in a template without `.value`, and what makes a mistyped member an error.
- **One place changes it.** The read-only rule is what lets the compiler, and an AI tool, say who changes what.
