# Using Tooltip

A short hint for a control, shown when the pointer rests on it or it has focus.

- Put the control in the default slot and the hint in `content`. The hint is one short line of plain text. If it needs more, use a [Popover](#/components/Popover).
- **A tooltip describes, it does not name.** A control with only an icon needs its own label (`label` on an [Icon](#/components/Icon), or text); the tooltip may repeat it for sighted people but is not the only source. Screen readers read the hint after the name.
- It shows when the pointer rests on the control for a moment (`delay`, 400 ms), and at once on keyboard focus. It stays while the pointer is over it, and **Escape** hides it, so it never traps what is under it.
- If the slot has no button, link or field, the wrapper itself takes focus, so keyboard users can reach the hint too.
- Never put a link, a button or anything to press in a tooltip: it disappears when focus moves.
- `placement` is the side it prefers; the browser moves it to another side when there is no room.

```tess live
<template>
  <div>
    <Tooltip>
      <Button tone="neutral" emphasis="outline">Save</Button>
      <span slot="content">Saves your changes as a draft</span>
    </Tooltip>
    <Tooltip placement="bottom">
      <Icon name="circle-help" label="Help" />
      <span slot="content">What the fields mean</span>
    </Tooltip>
  </div>
</template>
```
