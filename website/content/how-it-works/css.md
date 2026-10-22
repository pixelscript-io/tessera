# CSS layers and scoping

Tessera emits plain CSS: custom properties and `@layer`. There is no CSS-in-JS and no runtime style engine.

## Layers

Everything Tessera writes is in a layer, declared once in this order:

```text
@layer tessera.reset, tessera.tokens, tessera.components, tessera.overrides;
```

- **tokens**: the custom properties, on `:where(:root)` so they have no specificity, with each theme under its data attribute.
- **components**: each component's scoped styles.
- **overrides**: yours. A rule you write in this layer beats the components' regardless of specificity, which is why you never need `!important` to adjust one.

Because the layers are declared up front, the order does not depend on which stylesheet loaded first.

## Scoping

Every class the compiler sees becomes `t-<Name>__<class>`, in the CSS and in the template, whether or not the file has a `<style>` block. `.root` in `Button.tess` is `.t-Button__root`, so two components can both have a `root` part and not collide. A `class` written on a component tag (`<Button class="extra">`) is scoped with the consumer's prefix, because it refers to the consumer's own style. A page's prefix comes from its path (`t-page-blog-index__`) so two `index.tess` files cannot clash, and a layout's from its name.

Dynamic class names built at runtime cannot be scoped at compile time, which is why `:class` is a warning ([W4102](/reference/errors/W4102)). State goes in `data-*` attributes instead: variants appear as `data-tone="danger"` and behaviors set `data-state="pressed"`, and a style selects on them.

## Tokens in styles

`$space.4` in a `<style>` block becomes `var(--t-space-4)`. Because the reference is a custom property, switching a theme changes one attribute and the browser recomputes every dependent value: no JavaScript runs and nothing re-renders.

## Next steps

[Auto-import resolution](/how-it-works/auto-imports).
