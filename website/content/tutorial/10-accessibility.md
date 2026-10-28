# 10. Accessibility tests

The contract is enough for Tessera to generate tests. One command sets them up:

```bash
npx tessera a11y
```

It writes a test file in each components folder (`system/components`, `app/components`), a Vitest browser-mode configuration if you have none, the dev dependencies and a `test:a11y` script, and ends with the commands to run: `npm install`, `npx playwright install chromium` (once), `npm run test:a11y`. It never overwrites a file. The test file is short:

```ts
/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { defineA11ySuites } from '@pixelscriptio/tessera/a11y'

defineA11ySuites({
  components: import.meta.glob('./*.tess', { eager: true, import: 'default' }),
  sources: import.meta.glob('./*.tess', { query: '?raw', eager: true, import: 'default' }),
})
```

The test tools (`vitest` 4 or newer, `@vitest/browser-playwright`, `playwright`, `axe-core`) are yours, installed by `tessera a11y`: they are optional peers of Tessera, never dependencies. The tests run in a real browser; set `TESSERA_A11Y_CHANNEL=msedge` (or `chrome`) to use one that is already installed instead of downloading Chromium. For each component, in each theme, the generated suites check:

- axe-core finds no violations for every combination of the contract's variant values and every declared state the test can create, using a real mouse and keyboard (hover, focus-visible, pressed, checked, expanded, open, disabled);
- the element's role matches the contract;
- a disabled component is disabled to assistive technology;
- for a component with a behavior (`press`, `toggle`, `disclosure`, `dialog` or `combobox`), a visible focus outline and that behavior's whole conformance suite: keys, pointer, `data-state`, Tab reachability, disabled and re-enabled, and for a dialog the focus trap, the scroll lock and where focus returns.

A component that cannot be shown without data, such as a combobox with no options, is given some by the `preview` in its contract, and `tessera a11y` uses it.

Adding a component adds its tests: there is nothing to register. A new project runs a few hundred of them for its Button and Card, and adding a component such as `Dialog` adds its suite. They found a real mistake in the first project they were run in: the preset's `Card` declared the role `group` but did not set it, and is now `generic`.

What generated tests do not cover is listed in [Behaviors and accessibility tests](/guide/behaviors): reading order, the quality of labels, color alone carrying meaning, and anything a person has to judge. They reduce the number of accessibility defects a team ships; they do not certify a product.

## Check

Run the tests with `npm run test:a11y` (or `npx vitest run`). Make a component's text color the same as its background in a style and run them again, or run `tessera check` first: the compile-time contrast check ([T2107](/reference/errors/T2107)) fails before the browser test does.

## Next steps

[Keeping it checked](/tutorial/11-checking).
