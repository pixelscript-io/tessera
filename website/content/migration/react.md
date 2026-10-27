# Coming from React with shadcn/ui

shadcn/ui's idea (components you copy into your project and own) maps closely onto `tessera eject`. The authoring model is a bigger change.

| React and shadcn/ui                           | Tessera                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| JSX in a function component                   | A `.tess` file with an HTML-like template                                          |
| `useState`                                    | `state()`: a signal that updates only what reads it                                |
| `useMemo`                                     | `derived()`                                                                        |
| `useEffect`                                   | `effect()`, `onMount`, `onCleanup`                                                 |
| Props and `children`                          | Variants and slots declared in the contract                                        |
| Callback props (`onPress`)                    | Events: `emit('press')` and `@press`                                               |
| `className`, Tailwind classes, `cva` variants | Scoped `<style>` with tokens; variants as `data-*` attributes                      |
| `variant="destructive"`                       | `tone="danger"`, checked against the contract                                      |
| shadcn `components/ui/` you own               | [Tessera UI](/guide/tessera-ui) plus `tessera eject Button` (records `forkedFrom`) |
| CSS variables for themes                      | Tokens as DTCG JSON; themes as data attributes                                     |
| Radix primitives for behavior                 | `@pixelscriptio/tessera/behavior` (`press` so far)                                 |
| Storybook                                     | A generated docs app is planned; not built yet                                     |
| React Router, Next.js routing                 | File-based pages, `<Link>`, layouts                                                |

## What you gain

- Enforcement: a raw color, an off-scale spacing or an undeclared variant is a build error with a suggested fix, not a review comment.
- Generated accessibility tests per component, per variant, state and theme.
- No re-render model: updates are fine-grained.
- A baseline, so you can adopt it in an existing app without a rewrite.

## What you give up

- Almost all of the React ecosystem: libraries, hooks, devtools, hiring pool, server components, meta-frameworks.
- Radix-level behaviors beyond `press` for now: dialogs, menus, comboboxes and so on are planned.
- JSX's flexibility. Templates are less expressive on purpose, and dynamic component names are not supported.
- Server rendering and data loading.

## Habits that change

- Components do not re-run. A signal read in the template is a subscription, not a render dependency, so no dependency arrays.
- A component's variants come from its contract, not from a helper you write.
- Styles reference tokens by name. There is no utility class layer.
- Ownership is explicit: wrap a system component, or eject it and keep the `forkedFrom` record.

## Next steps

[Extending and ejecting](/guide/design-systems/extending) and [Tutorial](/tutorial/).
