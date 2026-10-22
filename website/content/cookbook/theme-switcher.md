# A theme and density switcher

Themes and density are data attributes on the root element, so switching them is one function call and nothing re-renders. This is the switcher in the kitchen-sink app, as a component:

```xml tess
<contract>
{
  "name": "ThemeBar",
  "role": "group",
  "parts": ["root"],
  "description": "Buttons that switch the theme and the density."
}
</contract>

<script>
import { setDensity, setTheme } from '@tessera/tokens'

const light = () => setTheme(null)
const dark = () => setTheme('dark')
const comfortable = () => setDensity(null)
const compact = () => setDensity('compact')
</script>

<template>
  <div class="root">
    <Button tone="neutral" emphasis="outline" size="sm" @press="light">Light</Button>
    <Button tone="neutral" emphasis="outline" size="sm" @press="dark">Dark</Button>
    <Button tone="neutral" emphasis="outline" size="sm" @press="comfortable">Comfortable</Button>
    <Button tone="neutral" emphasis="outline" size="sm" @press="compact">Compact</Button>
  </div>
</template>

<style>
.root {
  display: flex;
  gap: $space.2;
}
</style>
```

`setTheme(null)` removes the attribute, which returns to the base values. `setTheme('dark')` sets `data-theme="dark"`.

## Following the system, and remembering a choice

A theme file with `"$auto": "prefers-color-scheme: dark"` also applies under `data-theme="auto"`, which follows the operating system. To remember a user's choice, store it yourself and call `setTheme` at startup, before the first render so there is no flash:

```ts
import { setTheme } from '@tessera/tokens'

const saved = localStorage.getItem('theme')
setTheme(saved ?? 'auto')
```

Put this in `app/main.ts`, above `createApp()`.

## Next steps

[A multi-brand app](/cookbook/multi-brand).
