import { effect, persisted } from '@pixelscriptio/tessera/core'
import { setTheme } from '@pixelscriptio/tessera/tokens'

/**
 * The theme the person chose, kept in the browser. This is the recipe in the cookbook ("One button that remembers"); the
 * app does not load it, so the theme bar of the kitchen sink behaves as before.
 */
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
