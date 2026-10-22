# Behaviors and accessibility tests

Introduced in v0.1 (Milestone 7).

A behavior is the interaction logic of a component, separate from how it looks. `press` is built: a click, a tap, or Enter or Space, with none of the differences between them.

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

## Generated accessibility tests

Every component in `system/components` gets tests generated from its contract. Nothing is registered; adding a component adds its tests. For each component, in the default theme and in dark:

- an axe-core run (WCAG 2.0 to 2.2 A and AA, plus best practices) for every combination of variant values, in every state the contract declares: rest, `hover`, `focus-visible`, `pressed` and `disabled`, created with a real mouse and keyboard in a real browser;
- the root has the role the contract declares;
- if it declares `disabled`, a disabled component says so to assistive technology;
- if it uses `press`: a visible focus indicator, and the full `press` conformance suite run against the component itself.

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
