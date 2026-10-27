# Using RadioGroup

A set of options where exactly one can be chosen.

- **The label names the group** and is required. It should be the question the options answer: "Billing period", not "Choose one".
- Give it `options`, a list of `{ value, label }` (add `disabled: true` to one that cannot be chosen now), and `value` for the one that is chosen. With no `value` nothing is chosen, and Tab stops on the first option.
- The arrow keys move through the options **and choose** the one they land on, wrapping at the ends. Space chooses the one with focus. Tab leaves the group, so it is one stop in the page, not one per option.
- `choose` fires with `{ value, source }` when the person chooses an option, where `source` is `keyboard` or `pointer`. Listen with `@choose`.
- Use `error` for what is wrong, such as "Choose a billing period". It is announced, and read with the group.
- Prefer a [Select](#/components/Select) when there are more than about five options. For a setting that is on or off, use a [Switch](#/components/Switch).
- `orientation="horizontal"` lays the options out in a row.

```tess live
<script>
const options = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly, two months free' },
  { value: 'team', label: 'Team (contact us)', disabled: true },
]
</script>

<template>
  <div>
    <RadioGroup :options="options" value="monthly">
      <span slot="label">Billing period</span>
      <span slot="hint">You can change this later.</span>
    </RadioGroup>
    <RadioGroup :options="options" orientation="horizontal" error="Choose a billing period.">
      <span slot="label">Billing period</span>
    </RadioGroup>
  </div>
</template>
```
