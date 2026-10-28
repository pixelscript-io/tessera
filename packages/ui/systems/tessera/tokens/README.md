These are the tokens of your design system. They are ordinary Tessera design tokens: you own them and change them freely.

The same files style the app and the docs (`npx tessera docs`): the docs read the semantic colors, the type and the radii from here, so changing a token here changes both.

- colors.tokens.json: the palette (primitives). Components use the semantic colors, not these.
- scale.tokens.json: spacing, radii, font families, sizes and weights.
- effects.tokens.json: shadows, opacity, durations and easing.
- semantic.tokens.json: surface, text, border, action, status and focus colors (light). Keep these names if you want the docs to follow them.
- themes/dark.tokens.json: the dark overrides, applied by data-theme="dark", or by data-theme="auto" when the system asks for dark.
