# A multi-brand app

One set of components, several brands. A brand is a theme file on its own attribute.

## The files

```text
system/tokens/
  base.tokens.json
  themes/
    dark.tokens.json       data-theme="dark"
    acme.tokens.json       data-brand="acme"
    globex.tokens.json     data-brand="globex"
```

Each brand file overrides the semantic tokens that carry the brand (the action colors, the heading font) and sets its attribute:

```text
{
  "$extends": "base",
  "$attribute": "brand",
  "color": {
    "action": {
      "primary": {
        "bg": { "$value": "{color.green.600}" },
        "bg-hover": { "$value": "{color.green.700}" }
      }
    }
  }
}
```

A brand can only override tokens that exist in the base ([T1011](/reference/errors/T1011)), so every brand exposes exactly the same names and no component can depend on a token only one brand has.

## Choosing at runtime

```ts
document.documentElement.dataset.brand = 'acme'
```

Components do not change. The attribute switches the custom properties and the browser recomputes the page.

## Keep it honest

- Pairs of text and background are checked per theme. Check the brand and theme combinations you ship by looking at them, since contrast is not computed per combination.
- If two themes override the same token, the later rule in the generated CSS wins. Keep brands to tokens that themes leave alone.
- Prefer one set of semantic tokens and many value sets over many sets of tokens: the whole point is that a component is written once.

## Next steps

[Adopting in a legacy codebase](/cookbook/legacy-baseline).
