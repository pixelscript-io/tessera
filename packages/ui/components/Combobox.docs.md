# Using Combobox

Use a combobox to **choose from a long list** that narrows as the person types: countries, people, tags. For a short fixed list, use a [Select](#/components/Select).

- The label is required: it is what assistive technology reads.
- Give it `options`, a list of `{ value, label }`. The text shows the label of the chosen `value`.
- Arrow Down opens the list (or moves to the next option), Arrow Up the other way, Enter chooses the active option, Escape closes the list and keeps the text, Tab closes it and moves on.
- `select` fires with `{ value, label }` when an option is chosen, and `input` fires with the text.
- Typing narrows the list to the labels that contain it. "No results" is announced when none do.

```tess live
<script>
const fruit = [
  { value: 'apple', label: 'Apple' },
  { value: 'apricot', label: 'Apricot' },
  { value: 'banana', label: 'Banana' },
  { value: 'blueberry', label: 'Blueberry' },
]
</script>

<template>
  <Combobox :options="fruit">
    <span slot="label">Fruit</span>
  </Combobox>
</template>
```
