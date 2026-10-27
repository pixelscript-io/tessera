# Using Skeleton

A placeholder in the shape of content that has not loaded yet.

- `shape` is `text` (a line), `block` (a picture or a card) or `circle` (an avatar).
- It is hidden from assistive technology and says nothing. Announce the loading some other way: a [Spinner](#/components/Spinner), or text in a live region.
- It pulses, and stands still for people who prefer less motion.
- Match the real content's size, so the page does not jump when it arrives.

```tess live
<template>
  <div>
    <Skeleton shape="circle" />
    <Skeleton />
    <Skeleton />
    <Skeleton shape="block" />
  </div>
</template>
```
