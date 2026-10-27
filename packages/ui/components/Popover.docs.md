# Using Popover

A panel that opens next to a button and holds more than a tooltip can: text, a short form, a few actions.

- The `trigger` slot is the text of the button. The button says whether the panel is open, and opening it is a click, Enter or Space.
- The panel is in the browser's top layer, so nothing clips it and nothing covers it. **Escape** and a **click outside** close it, and focus goes back to the button.
- It is placed next to the button by the browser, and moves to the other side when there is no room. `placement` picks the side it prefers: `bottom`, `top`, `right` or `left`.
- The panel has a name: the button's, or the `label` prop if you give one. Use `label` when the button's text does not name the panel well.
- `change` fires with `{ open }` when it opens or closes, from any cause. The `open` prop opens or closes it from outside.
- A popover is not a dialog: the page behind it stays usable. For something the person must answer first, use a [Dialog](#/components/Dialog). For a one-line hint, use a [Tooltip](#/components/Tooltip).

```tess live
<template>
  <div>
    <Popover>
      <span slot="trigger">Share</span>
      <strong>Share this page</strong>
      <p>Anyone with the link can read it.</p>
    </Popover>
    <Popover placement="right">
      <span slot="trigger">Filters</span>
      <p>Show only items from this week.</p>
    </Popover>
  </div>
</template>
```
