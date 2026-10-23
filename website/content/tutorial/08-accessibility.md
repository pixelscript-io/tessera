# 8. Accessibility tests

The contract is enough for Tessera to generate tests. A test file in the folder with your components asks for them:

```ts
/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { defineA11ySuites } from '@tessera/a11y'

defineA11ySuites({
  components: import.meta.glob('./*.tess', { eager: true, import: 'default' }),
  sources: import.meta.glob('./*.tess', { query: '?raw', eager: true, import: 'default' }),
})
```

`@tessera/a11y` is a development tool in the Tessera repository and is not in the published package yet; until it is, run these suites from a checkout, or rely on `tessera check` for the compile-time contrast checks. For each component, in each theme, the generated suites check:

- axe-core finds no violations for every combination of the contract's variant values and every declared state the test can create, using a real mouse and keyboard (hover, focus-visible, pressed, disabled);
- the element's role matches the contract;
- a disabled component is disabled to assistive technology;
- for a component with the `press` behavior, a visible focus outline and the whole press conformance suite (click, Enter, Space, other keys do nothing, `data-state`, Tab reachability, disabled and re-enabled).

Adding a component adds its tests: there is nothing to register. For the system's `Button` that is 284 tests.

What generated tests do not cover is listed in [Behaviors and accessibility tests](/guide/behaviors): reading order, the quality of labels, color alone carrying meaning, and anything a person has to judge. They reduce the number of accessibility defects a team ships; they do not certify a product.

## Check

Run the tests with `pnpm vitest run`. Make a component's text color the same as its background in a style and run them again, or run `tessera check` first: the compile-time contrast check ([T2107](/reference/errors/T2107)) fails before the browser test does.

## Next steps

[Keeping it checked](/tutorial/09-checking).
