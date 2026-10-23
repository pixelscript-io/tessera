# Reactivity

Introduced in v0.1 (Milestone 1).

`@pixelscriptio/tessera/core` provides three primitives. A signal is read and written with `.value`.

```ts
import { state, derived, effect } from '@pixelscriptio/tessera/core'

const count = state(0)
const label = derived(() => `Clicked ${count.value} times`)

effect(() => console.log(label.value)) // logs "Clicked 0 times"
count.value++ // logs "Clicked 1 times" in the next microtask
```

- `state(initial)` is a writable signal. Setting an identical value (`Object.is`) does nothing.
- `derived(fn)` is lazy and memoized. If it recomputes to the same value, nothing downstream re-runs. Keep it pure.
- `effect(fn)` runs immediately, then again whenever a signal it read changes. Re-runs are batched into one microtask.
- `onCleanup(fn)` runs before an effect re-runs and when it is disposed. Effects created inside an effect are disposed with it.
- `createRoot(fn)` makes a scope you dispose yourself; `untrack(fn)` reads without subscribing; `flush()` runs pending effects now.

Effects that keep re-triggering each other for 1000 passes throw an error.
