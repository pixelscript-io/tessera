The tokens in this folder are derived from the default theme of Tailwind CSS 4.3.3 (https://tailwindcss.com), which is MIT licensed. The license is in TAILWIND-LICENSE.

They are ordinary Tessera design tokens: you own them, change them freely, and your project does not depend on Tailwind.

- colors.tokens.json: every Tailwind color (all palettes and shades, plus black and white). Primitives: components use the semantic colors in semantic.tokens.json.
- scale.tokens.json: spacing, radii, font families, sizes, line heights, weights, letter spacing.
- effects.tokens.json: shadows, blur, durations, easing and opacity.
- layout.tokens.json: breakpoints, containers, perspective and aspect ratio.
- semantic.tokens.json: surface, text, border, action, focus and brand colors (light).
- themes/dark.tokens.json: the dark overrides, applied by data-theme="dark", or by data-theme="auto" when the system asks for dark.

Not included: Tailwind's animation shorthands (spin, ping, pulse, bounce), which need keyframes rather than values.
