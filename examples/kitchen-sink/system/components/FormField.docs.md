# Using FormField

A label, a hint and an error around a control that has none of its own.

[TextField](#/components/TextField), [Textarea](#/components/Textarea), [Select](#/components/Select), [Combobox](#/components/Combobox) and [RadioGroup](#/components/RadioGroup) already have a label, a hint and an error. Use `FormField` for the rest: a native `<input type="date">`, a range slider, or a control of your own.

- **The label is required**, in the `label` slot. It is connected to the control, so clicking it focuses the control and a screen reader reads it.
- The control goes in the default slot. `FormField` finds the first `input`, `textarea`, `select` or element with a `role` in it.
- The hint is read with the control. The `error` is announced when it appears, is read with the control, and marks it invalid.
- `required` shows a star and marks the control required for assistive technology. It does not stop anything being submitted: check the value yourself (see [Form](#/components/Form)).

```tess live
<template>
  <div>
    <FormField>
      <span slot="label">Start date</span>
      <input type="date" />
      <span slot="hint">The first day of the trial.</span>
    </FormField>
    <FormField required error="Pick a time.">
      <span slot="label">Reminder</span>
      <input type="time" />
    </FormField>
  </div>
</template>
```
