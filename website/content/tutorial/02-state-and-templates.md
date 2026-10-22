# 2. State and templates

State is a signal made with `state()`. Reading and writing it in `<script>` uses `.value`; in the template a top-level signal is used bare.

```xml tess
<contract>
{
  "name": "Tally",
  "role": "group",
  "parts": ["root", "add"],
  "events": { "change": "fired with the new count" }
}
</contract>

<script>
const count = state(0)
const label = derived(() => `${count.value} so far`)

function add() {
  count.value++
  emit('change', count.value)
}
</script>

<template>
  <div class="root">
    <button class="add" @click="add">Add one</button>
    <p>{label}</p>
    <p if="count > 2">That is a few.</p>
    <p else>Keep going.</p>
  </div>
</template>
```

- `state(0)` creates a signal. `derived()` computes from other signals and updates when they change.
- `{label}` renders text. `@click` attaches a handler. `if` and `else` choose between sibling elements.
- `emit('change', value)` calls the parent's `@change` handler. The compiler checks the name against the contract's `events`: emit `chnage` and it is an error.

Nothing re-renders as a whole. Each `{ }` is bound to the signals it reads, so clicking updates one text node.

## Check

Add `<Tally />` to a page, run the dev server and click the button. Then remove `"events"` from the contract and run `tessera check`: emitting `change` is now an error ([T4010](/reference/errors/T4010)).

## Next steps

[Props and variants through a contract](/tutorial/03-contracts).
