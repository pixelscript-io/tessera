# Coming from Svelte

The single-file shape is the same and the reactivity is closer to Svelte 5's signals than to its older compiler-driven assignments.

| Svelte                                   | Tessera                                                 |
| ---------------------------------------- | ------------------------------------------------------- |
| `let count = $state(0)`                  | `const count = state(0)`; `.value` in script            |
| `$derived(expr)`                         | `derived(() => expr)`                                   |
| `$effect(() => ...)`                     | `effect(() => ...)`                                     |
| `onMount`, cleanup returns               | `onMount`, `onCleanup`                                  |
| `{expr}`                                 | `{expr}`                                                |
| `{#if x}...{:else}...{/if}`              | `if="x"` and `else` on sibling elements                 |
| `{#each xs as x (x.id)}`                 | `each="x in xs" key="x.id"`                             |
| `on:click={f}` / `onclick={f}`           | `@click="f"`                                            |
| `bind:value={v}`                         | `bind:value="v"`                                        |
| `export let tone` / `$props()`           | variants in the contract; `props({ ... })` for the rest |
| `<slot name="x">` / snippets             | `<slot name="x">`, declared in the contract             |
| scoped `<style>`                         | always scoped; tokens, not raw values                   |
| `createEventDispatcher` / callback props | `emit('name')`, declared in the contract                |
| SvelteKit routing                        | `app/pages` file-based routing, layouts                 |

## What you gain

- The contract and compile-time enforcement of variants, slots, events and tokens.
- Themes and density as data attributes, with contrast checked in every theme.
- Generated accessibility tests and a baseline for existing code.

## What you give up

- SvelteKit's full-stack features: server rendering, load functions, form actions, adapters.
- Svelte's compiler-driven reactivity for plain variables: in Tessera a reactive value is explicitly a signal.
- The ecosystem and tooling.
- Control flow blocks: conditionals and loops are attributes on elements, so an `if` needs an element to sit on.

## Habits that change

- Reactive values are signals with `.value` in script. The template unwraps top-level ones.
- Components are declared by contract first; a prop that is a choice is a variant.
- `each` always needs a `key`.

## Next steps

[Tutorial](/tutorial/) and [Reactivity](/guide/reactivity).
