import { highlight, type CodePane } from './code'

/** What the "Shared state" section shows: the file, two components that never import it, and what the compiler says about a change. */

export type StateTabId = 'file' | 'use' | 'check'

export const STATE_TABS: ReadonlyArray<{ id: StateTabId; label: string }> = [
  { id: 'file', label: 'app/state/cart.ts' },
  { id: 'use', label: 'two components' },
  { id: 'check', label: 'tessera check' },
]

const SNIPPETS: Record<StateTabId, string[]> = {
  file: [
    `// app/state/cart.ts
import { derived, state } from "@pixelscriptio/tessera/core"

export const items = state([])
export const count = derived(() => items.value.length)`,
    `export function add(name) {
  if (items.value.length < 3) {
    items.value = [...items.value, name]
  }
}

export function clear() {
  items.value = []
}`,
  ],
  use: [
    `// Badge.tess
<template>
  <p>{cart.count} in the cart</p>
</template>`,
    `// AddButton.tess
<template>
  <button @click="cart.add('A book')">
    Add a book
  </button>
</template>`,
  ],
  check: [
    `$ npx tessera check

ERROR  T5011  app/components/Clear.tess:2:20
  "cart.items" can only be changed inside
  app/state/cart.ts.
  Change it with cart.add() or cart.clear(),
  or add a function to that file.`,
    `ERROR  T5012  app/components/Badge.tess:2:12
  "cart" has no "cout".
  Did you mean "count"?`,
  ],
}

export const STATE_PANES: Record<StateTabId, CodePane[]> = Object.fromEntries(
  Object.entries(SNIPPETS).map(([id, panes]) => [
    id,
    panes.map((source) => ({ lines: source.split('\n').map(highlight) })),
  ]),
) as Record<StateTabId, CodePane[]>

export const STATE_NOTES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'A file is the store',
    body: 'No provider, no id, no action syntax. The file name is the name, and every component can use it without an import.',
  },
  {
    title: 'No ref to unwrap',
    body: 'The compiler reads the file, so cart.count works in a template and stays reactive when you destructure it.',
  },
  {
    title: 'One place changes it',
    body: 'State is read-only outside its file. Every change, and every rule about the data, is in one place the compiler can check.',
  },
]
