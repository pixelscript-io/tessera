# Using Alert

A message the person should notice. It is announced when it appears.

- Say what happened and what to do about it. A `title` is a short heading; the default slot is the message.
- `tone="danger"` is for something that went wrong, `primary` for something worth noticing, and `neutral` for plain information.
- Add an `icon` to help people who do not read the color. The icon is decoration: the text carries the meaning, and the tone is never the only signal.
- It is not dismissible by itself. To let the person close it, put a [Button](#/components/Button) inside and remove the alert when it is pressed.
- Because it is announced at once, do not show one for something that changed a moment ago. Use it for what needs attention.

```tess live
<template>
  <div>
    <Alert>
      <span slot="title">Heads up</span>
      Your trial ends in three days.
    </Alert>
    <Alert tone="danger">
      <span slot="title">Could not save</span>
      The connection was lost. Try again.
    </Alert>
  </div>
</template>
```
