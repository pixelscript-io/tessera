# A form field component

A label and an input that belong together, with an error message that is announced.

```xml tess
<contract>
{
  "name": "TextField",
  "role": "group",
  "parts": ["root", "label", "input", "error"],
  "slots": { "default": "the label text" },
  "events": { "input": "fired with the new value as the user types" }
}
</contract>

<script>
const { error } = props({ error: '' })
const value = state('')

function changed() {
  emit('input', value.value)
}
</script>

<template>
  <div class="root">
    <label class="label"><slot /></label>
    <input class="input" type="text" bind:value="value" @input="changed" />
    <p class="error" role="alert" if="error">{error}</p>
  </div>
</template>

<style>
.root {
  display: flex;
  flex-direction: column;
  gap: $space.1;
}

.label {
  color: $color.text.default;
}

.input {
  padding: $space.2;
  border-radius: $radius.md;
  color: $color.text.default;
  background: $color.surface.default;
}

.error {
  margin: 0;
  color: $color.action.danger.text;
}
</style>
```

- The `bind:value` is two-way and needs a `state()`; the compiler checks that.
- The error paragraph has `role="alert"`, so a screen reader announces it when it appears.
- A label wrapping the slot is only enough when the input is inside it or associated with `for` and `id`. Pairing a label to an input is the kind of thing automation cannot judge well: verify it with a screen reader.

## Next steps

[Configuring CI](/cookbook/ci).
