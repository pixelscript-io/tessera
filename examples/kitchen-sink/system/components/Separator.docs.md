# Using Separator

A thin line between groups of content.

- Horizontal by default; set `orientation="vertical"` between items in a row. The vertical one stretches to the height of the row it is in.
- It is announced as a separator with its orientation. For a gap that has no meaning, use spacing instead.

```tess live
<template>
  <div>
    <p>Profile</p>
    <Separator />
    <p>Billing</p>
  </div>
</template>
```
