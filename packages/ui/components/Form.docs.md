# Using Form

A form that checks what was entered before it lets it through.

You give it the form's `values` and its `rules`. When the person submits (a button of type `submit`, or Enter in a field), it runs each rule. If every rule passes, it fires `submit` with the values. If one fails, it fires `invalid` with the errors, and moves focus to the first field marked invalid, so a keyboard or screen reader user lands on the first thing to fix.

- A rule is a function from a field's value (and all the values) to a message. Return an empty string, or nothing, when the value is fine.
- `Form` does not draw errors. You keep them in state and hand each to its field's `error` prop ([TextField](#/components/TextField), [Textarea](#/components/Textarea), [RadioGroup](#/components/RadioGroup), [FormField](#/components/FormField)). The `invalid` event gives you all of them at once.
- A field has no `name`. The key you use in `values`, `rules` and the errors is the only link between a field and its rule, and you wire each field yourself: its input event stores the value, and its `error` shows the message. A field keeps what is typed. To clear it from outside (after a submit), keep the text in a `state()`, pass it as `value` and update it from the input event: then setting it back to an empty string empties the field. Setting a value the state already has does nothing.
- Browser validation is off (`novalidate`), so the messages are yours and say what you want in the words you want.
- Say what is wrong and how to fix it: "Enter an email such as ada@example.com", not "Invalid". Show an error only after the person has tried to submit or left the field, not while they are still typing.
- `busy` marks the form as busy for assistive technology while it is being sent. Disable the submit button yourself.

```tess live
<script>
const values = state({ email: '', plan: '' })
const errors = state({})
const rules = {
  email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? '' : 'Enter an email such as ada@example.com.'),
  plan: (v) => (v ? '' : 'Choose a plan.'),
}
const plans = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
]

function typed(value) {
  values.value = { ...values.value, email: value }
}
function chose(detail) {
  values.value = { ...values.value, plan: detail.value }
}
function invalid(detail) {
  errors.value = detail.errors
}
function sent() {
  errors.value = {}
}
</script>

<template>
  <Form :values="values" :rules="rules" @invalid="invalid($event)" @submit="sent()">
    <TextField :error="errors.email" @input="typed($event)">
      <span slot="label">Email</span>
    </TextField>
    <RadioGroup :options="plans" :error="errors.plan" @choose="chose($event)">
      <span slot="label">Plan</span>
    </RadioGroup>
    <Button type="submit">Sign up</Button>
  </Form>
</template>
```
