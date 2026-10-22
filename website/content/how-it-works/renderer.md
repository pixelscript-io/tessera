# The renderer adapter

A compiled template is a function that calls a small set of renderer functions:

| Function                        | What it builds                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `el(tag, options, ...children)` | An element, with `attrs`, `props`, `on` handlers and `use` behaviors. A function value is bound reactively.                    |
| `text(source)`                  | A text node, bound to a signal or function when it is not constant.                                                            |
| `cond(select, branches)`        | The branch chosen by an index, rebuilt only when the index changes (`if`, `else-if`, `else`).                                  |
| `each(items, key, render)`      | A keyed list, moving nodes instead of recreating them.                                                                         |
| `slot(content, fallback)`       | The parent's slot content, or the fallback.                                                                                    |
| `view(select, onRender)`        | Whatever builder `select` returns, rebuilt only when that builder changes. The router uses it for the current page and layout. |
| `mount(container, build)`       | Builds and attaches the root, returning a disposer.                                                                            |

All of them go through a `RendererAdapter`: a handful of operations (create an element or text, insert, remove, move, set an attribute, set text, read an attribute, find a parent or sibling). The default adapter is the DOM. Because nothing above the adapter touches the DOM directly, the runtime can later be pointed at something else (server rendering, a test double, another renderer) without touching the design-system layer. The tests use this: a wrapper adapter counts exactly which nodes a change touched.

## What a component is

`defineComponent(name, variantDefaults, setup)` wraps the setup function. The setup receives a context with `props`, `emit`, `slot` and `root`. Props are read-only signals; variants become `data-*` attributes on the root, so styles and tests can select on them; attributes the parent passes that the component does not claim land on the root element. In development a component also registers itself for hot replacement, so editing a file swaps its live instances.

## Next steps

[CSS layers and scoping](/how-it-works/css).
