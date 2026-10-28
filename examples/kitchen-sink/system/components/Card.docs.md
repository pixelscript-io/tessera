# Using Card

A raised surface that groups related content, with an optional heading.

- Put the heading in the `header` slot; it is left out when empty.
- `padding` is `md` by default, `sm` for dense lists and `lg` for a hero.
- A card has no behavior of its own. Put a [Button](#/components/Button) or a link inside for something to do.

```tess live
<template>
  <Card>
    <span slot="header">Billing</span>
    Your plan renews on the first of the month.
  </Card>
</template>
```
