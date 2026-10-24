# Testing

Introduced in v0.1 (Milestones 0 and 7).

Tessera projects use [Vitest](https://vitest.dev/). There are three kinds of test, and each runs where it needs to.

## Logic: plain Vitest

Signals and plain TypeScript run in Node or jsdom, with no browser:

```ts
import { derived, flush, state } from '@pixelscriptio/tessera/core'
import { expect, it } from 'vitest'

it('derives from state', () => {
  const count = state(1)
  const double = derived(() => count.value * 2)
  count.value = 4
  flush()
  expect(double.value).toBe(8)
})
```

Effects run in a microtask. `flush()` runs everything pending now, which is what a test wants.

## Components: Vitest browser mode

Components are compiled by the Vite plugin, so a test that mounts one needs the plugin and a real browser (Vitest's browser mode with Playwright). Mount with the renderer and read the DOM:

```ts
import { getRenderer } from '@pixelscriptio/tessera/core'
import Counter from './Counter.tess'

const r = getRenderer()
const container = document.createElement('div')
document.body.append(container)
const dispose = r.mount(container, () => Counter({}))
// ... assertions on container ...
dispose()
```

The kitchen-sink app in the repository has working examples (`examples/kitchen-sink/app/*.browser.test.ts`), including the router and layouts.

## Accessibility: generated

`defineA11ySuites` (from `@pixelscriptio/tessera/a11y`) generates a suite per component from its contract. Run `npx tessera a11y` to set it up in your project: a test file in each components folder, a Vitest browser-mode configuration and the dev dependencies. See [Accessibility tests](/tutorial/08-accessibility) and [Behaviors and accessibility tests](/guide/behaviors).

## Validation: `tessera check`

Not a test runner, but the cheapest test you have: it runs the compiler's checks on the whole project in a second or two. Run it in CI next to your tests ([Configuring CI](/cookbook/ci)).

## Next steps

[Configuring CI](/cookbook/ci).
