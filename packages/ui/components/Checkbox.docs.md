# Using Checkbox

Use a checkbox when a person can pick **any number** of options, or must agree to something. For one setting that takes effect at once, use a [Switch](#/components/Switch).

- The label says what is chosen, not "Yes".
- It starts unchecked. Set `checked` to start it checked, or to change it from outside.
- The `toggle` event says where it is going: `{ checked, source }`. The component keeps its own state, so you do not have to.
- Space toggles it. Enter does not, as with a native checkbox.

```tess live
<template>
  <div>
    <Checkbox>Send me product news</Checkbox>
    <Checkbox checked>Remember me</Checkbox>
    <Checkbox disabled>Not available</Checkbox>
  </div>
</template>
```
