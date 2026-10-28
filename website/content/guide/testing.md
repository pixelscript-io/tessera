# Testing

Introduced in v0.1 (Milestones 0 and 7).

Tessera projects use [Vitest](https://vitest.dev/) 4 or newer (browser tests also need `@vitest/browser-playwright`; `tessera a11y` adds both). There are three kinds of test, and each runs where it needs to.

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

### Start each test with the state at its first value

State in the files of `app/state` lives as long as the page, so one test's cart is still there in the next. `resetState()` puts every piece of [shared state](/guide/shared-state#keeping-state) back to the value it started with, and `persisted` and `urlState` forget what they stored and what the address said:

```ts
import { beforeEach } from 'vitest'
import { resetState } from '@pixelscriptio/tessera/core'

beforeEach(() => resetState())
```

State made inside a component is not touched.

### Wait for the page, not for a time

After a click on a link, the router loads the next page, which takes as long as it takes. A test that sleeps for a guessed time fails on a slow machine, or waits too long on a fast one. `router.settled()` resolves when no navigation is in progress, so the page that was asked for is shown:

```ts
link.click()
await router.settled()
expect(document.title).toBe('Blog')
```

The back and forward buttons deliver their event separately: wait for `popstate`, then for `settled()`. For anything else that happens by itself (an announcement that is set a moment later), poll for the result, with a limit, instead of sleeping.

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

`defineA11ySuites` (from `@pixelscriptio/tessera/a11y`) generates a suite per component from its contract. Run `npx tessera a11y` to set it up in your project: a test file in each components folder, a Vitest browser-mode configuration and the dev dependencies. See [Accessibility tests](/tutorial/10-accessibility) and [Behaviors and accessibility tests](/guide/behaviors).

## Validation: `tessera check`

Not a test runner, but the cheapest test you have: it runs the compiler's checks on the whole project in a second or two. Run it in CI next to your tests ([Configuring CI](/cookbook/ci)).

## Next steps

[Configuring CI](/cookbook/ci).
