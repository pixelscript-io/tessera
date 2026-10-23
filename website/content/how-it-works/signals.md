# The signals runtime

`@pixelscriptio/tessera/core` has no dependencies and is a few hundred lines. It is a push-pull signal graph.

- `state(value)` is a source. Writing `.value` marks everything downstream dirty.
- `derived(fn)` is a lazily computed value. It reruns only when something it read changed, and only tells its own observers if its result is different (compared with `Object.is`). That last point matters: a derived value that returns the same thing does not cause downstream work.
- `effect(fn)` runs now and again whenever a signal it read changes. Effects are queued and run in a microtask; `flush()` runs them immediately.

Dependencies are discovered by reading: whatever `.value` an effect or derived reads while it runs becomes a dependency, and they are re-collected on every run, so a branch that stops reading a signal stops depending on it.

## Ownership

Everything created inside an effect, a derived or a root belongs to it and is disposed when it reruns or is disposed. `onCleanup` registers work for that moment, `createRoot` makes a scope that you dispose yourself, and `untrack` reads without subscribing. A component is a function run inside its own scope, so the effects and cleanups in its script go away when it is removed.

## Why signals

A template expression such as `{count}` is bound to the signals it reads, so a change updates one text node and nothing else. There is no virtual DOM and no component re-render. The cost is that the unit of reactivity is a value, so the compiler (and the rules about [unwrapping](/guide/components)) has to make reads and writes look simple.

Two details worth knowing: effects that keep triggering each other are stopped after a fixed number of passes with an error rather than hanging, and a `derived` that writes to a signal is flagged as impure ([W4101](/reference/errors/W4101)).

## Next steps

[The renderer adapter](/how-it-works/renderer).
