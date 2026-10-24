# Behaviors and accessibility tests

Introduced in v0.1 (Milestone 7).

A behavior is the interaction logic of a component, separate from how it looks. Three are built: `press` (a click, a tap, or Enter or Space, with none of the differences between them), `toggle` (press that moves between on and off) and `disclosure` (a trigger that shows and hides a region). They share one design: the component owns its state and binds it to the element, and the behavior reads that state from the element, handles the keyboard and pointer, and reports where it is going.

## Using press

Declare it in the contract and listen for it in the template:

```xml tess
<contract>
{
  "name": "Button",
  "role": "button",
  "parts": ["root", "label"],
  "behavior": "press",
  "slots": { "default": "label content" },
  "events": { "press": "fired on click, Enter, or Space" }
}
</contract>

<script>
const { disabled } = props({ disabled: false })
</script>

<template>
  <button class="root" type="button" :disabled="disabled" @press="emit('press', $event)">
    <span class="label"><slot /></span>
  </button>
</template>
```

`@press` is the behavior's event, not a DOM event. The compiler attaches the behavior to that element and checks that the contract declares `"behavior": "press"` and the `press` event.

- `$event` is `{ source: 'pointer' | 'keyboard' | 'virtual', event }`. `virtual` means code or assistive technology called `click()`.
- On a native `<button>`, `<a href>`, `<summary>` or `<input type="button">` the browser already turns Enter and Space into clicks. On any other element the behavior adds `tabindex="0"` and the contract's role, presses on Enter (key down) and on Space (key up, after stopping the page from scrolling), and ignores key repeat.
- A disabled element never presses. Disabled is read from the element: `disabled` or `aria-disabled="true"`.
- While the pointer or a key is held, the element has `data-state="pressed"`, so a style can use `&[data-state="pressed"]` without JavaScript.
- A behavior works with no styles applied.

## toggle

For a checkbox, a switch or a toggle button. Declare `"behavior": "toggle"` and the `toggle` event, bind `aria-checked` (or `aria-pressed` for a toggle button) to the component's state, and listen for `@toggle`:

```xml tess
<contract>
{
  "name": "Switch",
  "role": "switch",
  "parts": ["root", "label"],
  "behavior": "toggle",
  "slots": { "default": "the label" },
  "events": { "toggle": "fired with { checked, source } when the person changes it" }
}
</contract>

<script>
const { checked, disabled } = props({ checked: false, disabled: false })
const on = state(checked.value)
effect(() => {
  on.value = checked.value
})

function change(detail) {
  on.value = detail.checked
  emit('toggle', detail)
}
</script>

<template>
  <button
    class="root"
    type="button"
    role="switch"
    :aria-checked="on ? 'true' : 'false'"
    :disabled="disabled"
    @toggle="change($event)"
  >
    <span class="label"><slot /></span>
  </button>
</template>
```

- `$event` is `{ checked, source, event }`. `checked` is where it is going, not where it is: the component sets its state, and the attribute follows.
- The current state is read from the element, so the component stays the owner of the value. A toggle with no state yet starts as off, so assistive technology always has a value to read.
- Space toggles. Enter toggles a switch and a toggle button but not a checkbox, which matches a native one.
- Everything else (disabled, key repeat, `data-state="pressed"`) is `press`.

## disclosure

For a trigger that shows and hides a region, such as an accordion item. The contract declares the parts `root`, `trigger` and `content` and the `expand` event. Put `@expand` on the trigger, bind `aria-expanded` on it and `hidden` on the content to the same state:

```xml tess
<contract>
{
  "name": "Details",
  "role": "generic",
  "parts": ["root", "trigger", "content"],
  "behavior": "disclosure",
  "slots": { "title": "the heading", "default": "the content" },
  "events": { "expand": "fired with { expanded, source } when the person opens or closes it" }
}
</contract>

<script>
const open = state(false)

function change(detail) {
  open.value = detail.expanded
  emit('expand', detail)
}
</script>

<template>
  <div class="root">
    <button
      class="trigger"
      type="button"
      :aria-expanded="open ? 'true' : 'false'"
      @expand="change($event)"
    >
      <slot name="title" />
    </button>
    <div class="content" :hidden="!open"><slot /></div>
  </div>
</template>
```

The trigger starts collapsed if it has no state. Arrow-key movement between the triggers of an accordion is not built.

## The components that use them

The design system's own components are built on these behaviors, and each has generated accessibility tests: `Button` (press), `Checkbox` and `Switch` (toggle), `AccordionItem` and `Accordion` (disclosure), and `TextField`. They live in the repository's `system/components`, and `tessera init` writes them into your project's `system/components` for the `tessera` and `tailwind` presets. The `none` preset has no design system, so it gets none of them: write your own, with the same behaviors, which ship with the framework.

## Generated accessibility tests

Every component in `system/components` gets tests generated from its contract. Nothing is registered; adding a component adds its tests. For each component, in the default theme and in dark:

- an axe-core run (WCAG 2.0 to 2.2 A and AA, plus best practices) for every combination of variant values, in every state the contract declares: rest, `hover`, `focus-visible`, `pressed`, `checked`, `expanded` and `disabled` (checked and expanded are reached by pressing it), created with a real mouse and keyboard in a real browser;
- the root has the role the contract declares;
- if it declares `disabled`, a disabled component says so to assistive technology;
- if it uses a behavior (`press`, `toggle` or `disclosure`): a visible focus indicator, and that behavior's full conformance suite run against the component itself (against its trigger, for a disclosure);
- every slot the contract declares is given text, so a component that needs a label has one.

Compile-time checks add to this: the compiler checks contrast between a part's color and background tokens in every theme and every variant and state combination, and the browser run measures the real rendering.

### What the tests do not cover

Automation covers only what a machine can check. These need a person:

- How a screen reader announces the component: name, role, state and value, in each reader and browser pair.
- Whether labels and content are good: axe checks that a button has a name, not that the name makes sense.
- Focus order and focus management in the context of a whole page.
- Reduced-motion behavior: the tests run with default motion preferences.
- Zoom and reflow, forced-colors (high contrast) mode, and text spacing overrides.
- Touch target sizing beyond what axe checks, and gestures.
- Real states for components whose contracts name states the test cannot create (for example drag).
- Combinations of a component with others, and content an app puts in its slots.

This list is exported as `NOT_COVERED` from `@tessera/a11y`.
