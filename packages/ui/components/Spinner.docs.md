# Using Spinner

Shows that something is loading.

- The text you give it is announced to a screen reader and not shown. With none it says "Loading". Say what is loading when more than one thing might be: `Saving your changes`.
- It is a status, so it is announced politely when it appears. Remove it when the work is done.
- For people who prefer less motion it stops turning, and the announced text still says what is happening.
- To show where the content will go, use a [Skeleton](#/components/Skeleton) too.

```tess live
<template>
  <div>
    <Spinner size="sm">Loading</Spinner>
    <Spinner>Saving your changes</Spinner>
    <Spinner size="lg">Uploading</Spinner>
  </div>
</template>
```
