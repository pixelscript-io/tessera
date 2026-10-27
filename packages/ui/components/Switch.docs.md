# Using Switch

Use a switch for a **setting that takes effect at once**, such as "Dark mode". For a choice that is saved with a form, use a [Checkbox](#/components/Checkbox).

- The label names the setting, and does not change when it is on: "Notifications", not "Turn notifications on".
- It starts off. Set `checked` to start it on, or to change it from outside.
- The `toggle` event says where it is going: `{ checked, source }`.
- Space and Enter both toggle it.

```tess live
<template>
  <div>
    <Switch>Notifications</Switch>
    <Switch checked>Dark mode</Switch>
  </div>
</template>
```
