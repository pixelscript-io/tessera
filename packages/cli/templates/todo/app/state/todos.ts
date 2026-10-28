import { derived, persisted, urlState } from '@pixelscriptio/tessera/core'

// Shared state: every .tess file can use this one as `todos`, with no import and no provider.
// Read it in a template as {todos.remaining}, call it as todos.add('Buy milk'). One file per topic in app/state.

export interface Todo {
  id: number
  title: string
  done: boolean
}

const isTodos = (value: unknown): value is Todo[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.id === 'number' &&
      typeof item.title === 'string' &&
      typeof item.done === 'boolean',
  )

// Kept in the browser: it is still here after a reload. What is read back is checked, so a damaged value starts a
// new list and nothing breaks. Keep what the person chose here, never a secret.
export const items = persisted<Todo[]>('todos', [], { validate: isTodos })

// Kept in the address (?filter=done), so a filtered list can be linked to and survives a reload.
export const filter = urlState('filter', 'all')

export const shown = derived(() => {
  if (filter.value === 'active') return items.value.filter((todo) => !todo.done)
  if (filter.value === 'done') return items.value.filter((todo) => todo.done)
  return items.value
})

export const remaining = derived(() => items.value.filter((todo) => !todo.done).length)

export function add(title: string) {
  const text = title.trim()
  if (!text) return
  const id = items.value.reduce((highest, todo) => Math.max(highest, todo.id), 0) + 1
  items.value = [...items.value, { id, title: text, done: false }]
}

export function toggle(id: number) {
  items.value = items.value.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo))
}

export function remove(id: number) {
  items.value = items.value.filter((todo) => todo.id !== id)
}

export function clearDone() {
  items.value = items.value.filter((todo) => !todo.done)
}

export function show(name: 'all' | 'active' | 'done') {
  filter.value = name
}
