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
import { setDensity, setTheme } from '@pixelscriptio/tessera/tokens'

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
import { setTheme } from '@pixelscriptio/tessera/tokens'

const saved = localStorage.getItem('theme')
setTheme(saved ?? 'auto')
```

Put this in `app/main.ts`, above `createApp()`.

## One button that remembers

The same thing as shared state, with one button. `persisted` keeps the choice in the browser and reads it back, so the file needs no storage code of its own:

```ts
// app/state/theme.ts
import { effect, persisted } from '@pixelscriptio/tessera/core'
import { setTheme } from '@pixelscriptio/tessera/tokens'

export const mode = persisted<'light' | 'dark'>('theme', 'light', {
  validate: (value): value is 'light' | 'dark' => value === 'light' || value === 'dark',
})

// A prerender has no page to set the theme on.
effect(() => {
  if (typeof document !== 'undefined') setTheme(mode.value === 'dark' ? 'dark' : null)
})

export function toggle() {
  mode.value = mode.value === 'dark' ? 'light' : 'dark'
}
```

Load the file before the first render, so the page starts in the right theme and does not flash. In `app/main.ts`:

```ts
import './state/theme'
```

The button is then a component like any other, and it names `theme` with no import:

```xml tess
<contract>
{
  "name": "ThemeToggle",
  "role": "group",
  "parts": ["root"],
  "description": "A button that switches between the light and the dark theme."
}
</contract>

<template>
  <div class="root">
    <Button tone="neutral" emphasis="outline" size="sm" @press="theme.toggle">
      {theme.mode === 'dark' ? 'Light theme' : 'Dark theme'}
    </Button>
  </div>
</template>

<style>
.root {
  display: flex;
}
</style>
```

`validate` is there because the storage can hold anything: a value that is not one of the two themes starts the page in the light theme. See [Sharing state](/guide/shared-state#keeping-state) for `persisted` and its version and migration.

## Next steps

[A multi-brand app](/cookbook/multi-brand).
