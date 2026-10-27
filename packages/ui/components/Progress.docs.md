# Using Progress

How far along something is.

- `value` runs from 0 to `max` (100 unless you set it). The bar's width and what a screen reader hears are both set from it.
- Leave `value` out when you do not know how long it will take: the bar moves back and forth, and the progress bar is announced without a value.
- Give it a `label` that says what is progressing, such as `Uploading photo`. The default is `Progress`.
- `tone="danger"` is for a failed upload that stays on screen. `size="sm"` is a thinner bar.

```tess live
<template>
  <div>
    <Progress value="40" label="Uploading photo" />
    <Progress value="80" tone="neutral" size="sm" label="Storage used" />
    <Progress label="Waiting for the server" />
  </div>
</template>
```
