# Using Textarea

A text box for more than one line: a message, a bio, a description.

- **The label is required.** It is what assistive technology reads. Do not use the placeholder as the label.
- Use the `hint` slot for help, and the `error` prop for what is wrong. The error is announced when it appears, is read with the box, and turns the border red. Setting `error` also marks the box invalid, so you do not need `invalid` as well.
- `rows` is how tall it starts (3 by default). The person can drag it taller.
- `input` fires on every change with the new text, and `change` fires when the person leaves the box.

```tess live
<template>
  <div>
    <Textarea rows="3">
      <span slot="label">Message</span>
      <span slot="hint">Plain text, up to 500 characters.</span>
    </Textarea>
    <Textarea error="Write at least a few words.">
      <span slot="label">Feedback</span>
    </Textarea>
  </div>
</template>
```
