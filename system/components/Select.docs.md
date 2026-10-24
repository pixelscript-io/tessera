# Using Select

Use a select to **choose one option from a short list**, on the browser's own select, so it works the way people already know on every device. For a long list that people search, use a [Combobox](#/components/Combobox).

- The label is required: it is what assistive technology reads.
- Give it `options`, a list of `{ value, label }`, and `value` to start with one chosen.
- `change` fires with `{ value, label }` when the person chooses an option.

```tess live
<script>
const sizes = [
  { value: 's', label: 'Small' },
  { value: 'm', label: 'Medium' },
  { value: 'l', label: 'Large' },
]
</script>

<template>
  <Select :options="sizes" value="m">
    <span slot="label">Size</span>
  </Select>
</template>
```
