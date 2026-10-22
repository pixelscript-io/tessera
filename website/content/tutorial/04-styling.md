# 4. Styling with tokens

Styles are plain CSS with nesting. Values for spacing, color, radius and the like come from design tokens, written `$group.name`.

```xml tess
<contract>
{
  "name": "Panel",
  "role": "group",
  "parts": ["root"],
  "variants": { "tone": ["neutral", "primary"] },
  "slots": { "default": "content" }
}
</contract>

<template>
  <div class="root"><slot /></div>
</template>

<style>
.root {
  padding: $space.4;
  border-radius: $radius.md;
  background: $color.surface.raised;
  color: $color.text.default;

  &[data-tone='primary'] {
    background: $color.surface.default;
  }
}
</style>
```

## Cause an error, then fix it

Change the padding to a value that is not on the scale:

```xml tess error=T2102
<contract>
{ "name": "Panel", "role": "group", "parts": ["root"] }
</contract>

<template>
  <div class="root"></div>
</template>

<style>
.root {
  padding: 13px;
}
</style>
```

```text
ERROR  T2102  app/components/Panel.tess:11:12
  Raw length "13px" in "padding" is off the scale.
  Did you mean "$space.3" (12px)? Or write raw(13px, "reason") to keep it.
  Run `tessera explain T2102` for details.
```

13px is not a step, and 12px is: the nearest step is suggested. Run `tessera check --fix` and, because `12px` is not what you wrote, it will leave your `13px` alone: a fix is applied only when the value is exactly one token, so it never changes how the page looks. Change it to `12px` and run the fix again to see it become `$space.3`.

If you really need 13px, say why, and say until when:

```text
padding: raw(13px, "legacy modal spacing", "2027-03-01");
```

That is allowed, counted in `tessera report`, and an error after the date.

## Check

`tessera check` exits 0 on the first sample, and 1 with T2102 on the second. Run `tessera explain T2102` for the same explanation offline.

## Next steps

[Theming and dark mode](/tutorial/05-theming).
