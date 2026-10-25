import { derived, state } from '@pixelscriptio/tessera/core'

/** Shared state: every component that names `cart` sees the same items. Only this file changes them. */
export const items = state<string[]>([])
export const count = derived(() => items.value.length)

export function add(name: string) {
  if (items.value.length < 3) items.value = [...items.value, name]
}

export function clear() {
  items.value = []
}
