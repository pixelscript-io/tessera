# system/

This project started with no design tokens, themes or system components, so styles are not checked against a
design system yet. Nothing here is required. When you want one:

1. **Tokens.** Rename `tokens/base.tokens.json.example` to `tokens/base.tokens.json` and edit it. Every file named
   `*.tokens.json` in `system/tokens/` is read. The format is [DTCG](https://www.designtokens.org/); the example
   shows colors and spacing.
2. **Load them.** In `app/main.ts`, uncomment `import 'virtual:tessera/tokens.css'`.
3. **Use them.** In a `<style>` block, write `padding: $space.4;`. A raw value off the scale is then a compile
   error with the nearest token suggested.
4. **Themes.** A file in `system/tokens/themes/` that starts with `"$extends": "base"` overrides token values
   (for example for dark mode). Switch at runtime with `setTheme('dark')`.
5. **Components.** Rename `app/components/Example.tess.example` to `Example.tess` to see a component with a
   contract. Shared components can live in `system/components/` instead of `app/components/`.

`npx tessera check` validates everything. `npx tessera explain <code>` explains any error it prints.

Want a full starting system instead? Start a new project with `npx @pixelscriptio/tessera init --preset tailwind`,
which writes a complete system built from Tailwind's default theme.
