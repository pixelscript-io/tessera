# Template syntax cheat sheet

A template has exactly one root element, which carries `class="root"`. The root cannot use directives.

| Feature           | Syntax                                   | Notes                                                                                                          |
| ----------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Text              | `{expression}`                           | A top-level signal is unwrapped. Write a literal brace as `{"{"}`.                                             |
| Attribute binding | `:title="expression"`                    | Re-evaluated when its signals change.                                                                          |
| Static attribute  | `title="text"`                           |                                                                                                                |
| Event             | `@click="handler"` or `@click="count++"` | Native DOM events. A handler is a function name or a statement.                                                |
| Behavior event    | `@press="handler"`                       | Needs the behavior in the contract ([T4015](/reference/errors/T4015)).                                         |
| Two-way binding   | `bind:value="name"`                      | On `input`, `textarea`, `select`; `name` must be a `state()`.                                                  |
| Element reference | `ref="box"`                              | On an HTML element; `box` must be a `state()`. It holds the element while it is on the page, and `null` after. |
| SVG               | `<svg viewBox="0 0 100 40">`             | `<svg>` and everything in it is created as SVG. Attributes keep their case (`viewBox`, `attributeName`).       |
| Conditional       | `if="expr"`, `else-if="expr"`, `else`    | On consecutive sibling elements.                                                                               |
| List              | `each="item in items" key="item.id"`     | A key is required ([T4011](/reference/errors/T4011)).                                                          |
| Slot              | `<slot />`, `<slot name="icon" />`       | Declared in the contract. Content may be a fallback.                                                           |
| Fill a slot       | `slot="icon"` on a child                 | Goes to that named slot; other children go to the default.                                                     |
| Component         | `<Button tone="danger">`                 | Found by name; variants, events and slots are checked.                                                         |
| Class             | `class="root"`                           | Scoped to the component. `:class` is not scoped ([W4102](/reference/errors/W4102)).                            |

## Script names in a template

A name in an expression must be declared in `<script>` or be an `each` variable ([T4006](/reference/errors/T4006)). Signals are unwrapped only when they are top-level bindings; `{state.field}` where `field` is a signal is [T4012](/reference/errors/T4012).

A read made with `get` (`const tasks = get('/tasks')`) and a write made with `post`, `put`, `patch` or `del` are known to the template: `tasks.data`, `tasks.error`, `tasks.loading` and `tasks.refreshing`, and `add.pending`, `add.error` and `add.data`, are read for their values. See [Fetching data](/guide/data#in-a-tess-file).

## Always available in a script

`state`, `derived`, `effect`, `onCleanup`, `onMount`, `props`, `emit`, `get`, `post`, `put`, `patch` and `del`, any API in `app/apis` by its file name, and in pages and components `useRoute` and `navigate`. They need no import in a `.tess` file; see [Auto-imports](/guide/auto-imports).

## The blocks

| Block        | In         | Purpose                                                                     |
| ------------ | ---------- | --------------------------------------------------------------------------- |
| `<contract>` | components | JSON: the component's public surface. Must not appear in pages and layouts. |
| `<script>`   | all        | Logic.                                                                      |
| `<template>` | all        | One root element.                                                           |
| `<style>`    | all        | CSS with nesting and `$token` values.                                       |
| `<page>`     | pages      | JSON: `title`, `layout`.                                                    |
