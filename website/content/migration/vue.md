# Coming from Vue

Tessera's files will feel familiar: blocks in one file, an HTML-like template, directives, scoped styles.

| Vue                           | Tessera                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `<script setup>`              | `<script>`. No `setup` attribute; `props` and `emit` are available.   |
| `ref(0)`, `.value`            | `state(0)`, `.value` in script; used bare in the template             |
| `computed(() => ...)`         | `derived(() => ...)`                                                  |
| `watchEffect`, `watch`        | `effect(() => ...)`                                                   |
| `onMounted`, `onUnmounted`    | `onMount`, `onCleanup`                                                |
| `defineProps`, `withDefaults` | `props({ disabled: false })`, plus the variants in the contract       |
| `defineEmits`                 | `emit('name', value)`, with names declared in the contract's `events` |
| `{{ expr }}`                  | `{expr}`                                                              |
| `:title="x"`, `@click="f"`    | the same                                                              |
| `v-if`, `v-else-if`, `v-else` | `if`, `else-if`, `else` (no `v-`)                                     |
| `v-for="x in xs" :key="x.id"` | `each="x in xs" key="x.id"` (a key is required)                       |
| `v-model`                     | `bind:value` on `input`, `textarea`, `select`                         |
| `<slot name="x">`             | the same, with slots declared in the contract                         |
| `<style scoped>`              | `<style>`: always scoped, values from tokens                          |
| Vue Router                    | file-based pages, `<Link>`, `useRoute()`, `navigate()`                |
| Pinia                         | nothing yet: signals in a module, or your own                         |

## What you gain

- A contract that makes a component's variants, slots and events checked at every use, with typos corrected for you.
- Styles enforced against tokens, with themes as data.
- Generated accessibility tests.

## What you give up

- The ecosystem: devtools, component libraries, plugins, a large community, years of production use.
- Server rendering, hydration and a state library. None exist in Tessera yet.
- Flexibility: dynamic components (a tag chosen from a variable) are not supported, and every component needs a contract.
- Nested routes, route guards and data loaders.

## Habits that change

- Declare, then use: a prop with fixed values is a variant in the contract, not a runtime validator.
- Style from tokens, not from values. Reach for `$space.4`, not `16px`.
- Do not nest signals in objects for use in the template; the compiler unwraps only top-level ones ([T4012](/reference/errors/T4012)).

## Next steps

[Tutorial](/tutorial/) and [Components and templates](/guide/components).
