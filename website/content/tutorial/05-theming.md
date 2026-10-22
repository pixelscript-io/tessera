# 5. Theming and dark mode

Components use semantic tokens such as `$color.surface.raised`, and a theme is a file that gives those same tokens other values. Your project already has two, in `system/tokens/themes/`: `dark` and `compact`.

```text
{
  "$extends": "base",
  "$auto": "prefers-color-scheme: dark",
  "color": { "surface": { "default": { "$value": "{color.neutral.800}" } } }
}
```

A theme can only override tokens that exist in the base ([T1011](/reference/errors/T1011) otherwise), so every theme exposes the same names. It compiles to a selector on a data attribute, and `$auto` also applies it when the user's system asks for it.

Switch at runtime with two functions:

```ts
import { setDensity, setTheme } from '@tessera/tokens'

setTheme('dark') // data-theme="dark" on the root element
setTheme(null) // back to the default
setDensity('compact') // data-density="compact"
```

No component changes. The contrast of every pair of text and background is checked in each theme when the file compiles, so a theme that makes text unreadable fails the build, not a review.

## Check

Add buttons that call `setTheme` to a page, click them, and watch the page change. Then, in `dark.tokens.json`, set the dark text color to the dark surface color and run `tessera check`: it reports [T2107](/reference/errors/T2107) for the dark theme.

## Next steps

[Pages and routing](/tutorial/06-pages).
