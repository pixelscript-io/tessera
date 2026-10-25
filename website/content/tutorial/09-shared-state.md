# 9. Sharing state

So far each component keeps its own data. When two components need the same data, such as a button that adds to a cart and a badge that shows how many are in it, they share it through a file in `app/state`.

Make `app/state/cart.ts`:

```ts
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

It is an ordinary file: two signals and two functions. The file name is the name, so every `.tess` file can now use `cart`, with no import. A badge:

```xml tess kind=page
<template>
  <p>{cart.count} in the cart</p>
</template>
```

A button, in another component:

```xml tess kind=page
<template>
  <button @click="cart.add('A book')">Add a book</button>
</template>
```

Put both on a page and click the button: the badge changes. They never import each other, and neither knows the other exists. They share `cart.count` because it is one signal.

The template reads `cart.count` as a value, with no `.value`, because the compiler read `cart.ts` and knows `count` is a signal. A list works the same way:

```xml tess kind=page
<template>
  <ul>
    <li each="name in cart.items" key="name">{name}</li>
  </ul>
</template>
```

## Why a component cannot change it directly

Try to empty the cart from a component:

```text
<button @click="cart.items = []">Empty</button>
```

```text
ERROR  T5011  app/pages/index.tess:4:13
  "cart.items" can only be changed inside app/state/cart.ts.
  Change it with cart.add() or cart.clear(), or add a function to that file.
```

Shared state is read-only outside its file. A component changes it by calling a function of the file, here `cart.clear()`. That is what keeps a rule such as "a cart holds three things" true: `add` is the only way in, and it checks. It also means that when something about the cart is wrong, you read one file. The error names the functions that exist, and a flag as small as "the drawer is open" gets a small function too.

A mistyped member is caught the same way:

```text
ERROR  T5012  app/pages/index.tess:2:6
  "cart" has no "cout".
  Did you mean "count"?
```

## What goes in `app/state`

Data from a server does not: [`get`](/tutorial/08-data) already shares it between every component that asks for the same path. Data that only one component needs does not either: keep it in a `state()` there. A state file is for what several components need and the user changes.

## Check

Run `npx tessera check` with `@click="cart.items = []"` in a component, and then with `cart.clear()`. The first fails with T5011 and the second passes. Everything about shared state, and what comes next (saving it, state for part of a page), is in [Sharing state](/guide/shared-state).

## Next steps

[Accessibility tests](/tutorial/10-accessibility).
