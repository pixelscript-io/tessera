# Using Button

Use a button for an **action**, and a [Link](#/components/Link) to go somewhere.

- Say what happens: "Save changes", not "OK".
- One primary button per view.
- It is a plain button. Set `type="submit"` for the button that sends a [Form](#/components/Form).

```tess live
<template>
  <div>
    <Button>Primary</Button>
    <Button tone="neutral" emphasis="outline">Neutral</Button>
  </div>
</template>
```
