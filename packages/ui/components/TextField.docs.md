# Using TextField

A text input with a visible label and an optional hint.

- **The label is required.** It is what assistive technology reads. Do not use the placeholder as the label.
- Use the `hint` slot for help or an error message. Set `invalid` to mark the field as having an error.
- `type` is any text-like input type: `text`, `email`, `password`, `search`, `url`, `tel`.
- `input` fires on every change with the new text, and `change` fires when the person leaves the field.

```tess live
<template>
  <div>
    <TextField>
      <span slot="label">Email</span>
      <span slot="hint">We only use it to sign you in.</span>
    </TextField>
    <TextField invalid>
      <span slot="label">Name</span>
      <span slot="hint">Enter your name.</span>
    </TextField>
  </div>
</template>
```
