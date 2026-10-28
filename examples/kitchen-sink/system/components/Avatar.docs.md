# Using Avatar

A person or a thing as a picture, or as initials.

- Give it a `name`. It is the accessible name, and the initials come from it (the first letters of the first two words).
- Give it a `src` for a picture. If the picture does not load, the initials are shown instead, so there is never a broken image.
- The picture is described by the `name` once, on the avatar. Do not repeat the name in text beside it for people who use a screen reader unless it adds something.
- `size` is `sm`, `md` or `lg`.

```tess live
<template>
  <div>
    <Avatar name="Ada Lovelace" size="sm" />
    <Avatar name="Grace Hopper" />
    <Avatar name="Alan Turing" size="lg" />
  </div>
</template>
```
