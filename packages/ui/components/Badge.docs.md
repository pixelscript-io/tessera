# Using Badge

A small label for a status or category.

- Keep it to one or two words.
- `tone` is `neutral` by default; use `primary` for the thing to notice and `danger` for a problem.
- A badge is text, not a control. It is not focusable and has no events.

```tess live
<template>
  <div>
    <Badge>Draft</Badge>
    <Badge tone="primary">New</Badge>
    <Badge tone="danger">Failed</Badge>
  </div>
</template>
```
