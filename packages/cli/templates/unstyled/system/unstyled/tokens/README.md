These tokens have plain values on purpose: black on white, square corners, no shadows. Every component in `system/components` is styled from them, so they are the one place to make the design your own. Nothing here is required to stay as it is.

- `colors.tokens.json`: surface, text, border, action, focus and status colors (light).
- `themes/dark.tokens.json`: the dark values, applied by `data-theme="dark"`, or by `data-theme="auto"` when the system asks for dark.
- `scale.tokens.json`: spacing, corner radius, type sizes, weights and families.
- `effects.tokens.json`: shadows, motion and opacity.

Examples of changing the design, each in one place:

- **Round the corners.** In `scale.tokens.json`, set `radius.md` to `{ "value": 0.5, "unit": "rem" }`. Buttons, fields and cards follow.
- **Use your brand color.** In `colors.tokens.json`, set `color.action.primary.bg`, and `fg` for the text on it. `npx @pixelscriptio/tessera check` fails if the text on it is too faint to read.
- **Lift the cards.** In `effects.tokens.json`, replace the value of `shadow.sm` with a real shadow.
- **Slow the motion.** In `effects.tokens.json`, raise `motion.duration.fast`.

To start from a fuller design, add one: `npx @pixelscriptio/tessera add tokens:tailwind`, or `tokens:tessera`. They are installed beside this one in `system/`, and `defaultSystem` in `tessera.config.ts` chooses which the app uses.
