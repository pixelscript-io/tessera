# Components and templates

Introduced in v0.1 (Milestone 4).

A component is one `.tess` file with up to four blocks, in any order: `<contract>`, `<script>`, `<template>`, `<style>`. Pages use the same format without a contract. See [Styles and enforcement](/guide/styles) for `<style>`.

```xml tess
<contract>
{
  "name": "Counter",
  "role": "group",
  "parts": ["root", "button", "list"],
  "variants": { "tone": ["neutral", "primary"] },
  "slots": { "default": "heading" },
  "events": { "change": "fired with the new count" }
}
</contract>

<script>
  const count = state(0)
  const label = derived(() => `Clicked ${count.value} times`)

  function inc() {
    count.value++
    emit('change', count.value)
  }
</script>

<template>
  <div class="root">
    <slot />
    <button class="button" @click="inc">{label}</button>
    <p if="count > 2">Many clicks.</p>
    <p else>Keep going.</p>
    <ul class="list"></ul>
  </div>
</template>
```

## Script

`state`, `derived`, `effect`, `onCleanup`, `onMount`, `props` and `emit` are available without imports. Imports you write are moved to the top of the module. Reactive values are signals: read and write them with `.value` in `<script>`.

- `props({ disabled: false })` returns read-only signals for the contract's variants plus the extra props you name.
- `emit('change', value)` calls the parent's `@change` handler. The compiler checks the name against the contract's `events`.
- `derived()` should be pure. Assigning a signal or calling `emit()` inside it is a warning (`W4101`); use `effect()`.

## Template

| Feature           | Syntax                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------- |
| Text              | `{expression}`                                                                         |
| Attribute binding | `:title="expression"`                                                                  |
| Event             | `@click="handler"` or `@click="count++"`                                               |
| Two-way binding   | `bind:value="name"` on `<input>`, `<textarea>`, `<select>`; `name` must be a `state()` |
| Conditional       | `if="expr"`, `else-if="expr"`, `else` on consecutive sibling elements                  |
| List              | `each="item in items" key="item.id"` (the key is required)                             |
| Slot              | `<slot />`, `<slot name="icon" />`; the name must be in the contract                   |
| Component         | `<Button tone="danger" @press="save">Save</Button>`                                    |

A template has exactly one root element. `if` and `each` cannot be used on the same element, or on the root.

### Signals in templates

A top-level binding is used bare and unwrapped: `{count}` reads `count.value`, and `@click="count++"` writes it. Unwrapping applies **only to top-level bindings**.

```xml tess kind=page error=T4012
<script>
  const user = { name: state('Ada') }
</script>
<template>
  <p>{user.name}</p>
  <!-- error T4012: a signal nested in an object does not unwrap -->
</template>
```

Destructure it to a top-level binding or read `.value`. When the compiler cannot see the problem (for example a signal returned from a function), Tessera prints a one-time warning in the console when a signal is rendered as text.

## Using other components

Use a component by its tag. The compiler imports it for you (see [Auto-imports](/guide/auto-imports)):

```xml tess kind=page
<script>
  function save() {}
</script>

<template>
  <div class="root">
    <Button tone="danger" class="extra" @press="save"><span slot="icon">!</span>Save</Button>
  </div>
</template>
```

- Variant values are checked against the component's contract: `Button.tone has no value "dangr". Did you mean "danger"?`
- `@event` names are checked against the contract's `events`, and `slot="icon"` against its `slots`.
- Attributes the component does not claim as props (`class`, `aria-*`, `data-*`, ...) land on its root element. A `class` is appended to the root's own.
- Variants appear on the root as `data-tone="danger"` attributes.

## Errors

Compiler errors have codes `T4001` to `T4013` (and `T6001` to `T6006` for pages, routing and layouts), plus the contract codes `T3001` to `T3013` for the `<contract>` block. They use the same layout everywhere:

```text
ERROR  T4006  Counter.tess:31:30
  Unknown name "cnt" in the template. It is not declared in <script> and is not a loop variable.
  Did you mean "count"?
  Run `tessera explain T4006` for details.
```

## With Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { tessera } from '@tessera/compiler/vite'

export default defineConfig({ plugins: [tessera()] })
```

Editing a `.tess` file updates the running page without a reload. State of the edited component resets.
