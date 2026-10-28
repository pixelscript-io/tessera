# Using Icon

A small drawing from [Lucide](https://lucide.dev/icons/) for an action or a thing.

- `name` picks one of the icons Tessera UI knows: `check`, `x`, `plus`, `search`, `chevron-down`, `trash-2`, `settings` and about sixty more. Names are Lucide's, in kebab case.
- For any other Lucide icon, import it from `lucide` in your script and pass it as `icon`. Only the icons you import are in your build.
- An icon next to text is decoration and says nothing. An icon that stands alone, such as a button with no words, needs a `label`, which becomes its accessible name. On a [Button](#/components/Button) it is the button that needs the name.
- `size` is `sm`, `md` or `lg`. The icon takes the color of the text around it.
- Put one in a component's `icon` slot: `<Icon slot="icon" name="plus" />`.

```tess live
<template>
  <div>
    <Icon name="check" />
    <Icon name="search" size="sm" />
    <Icon name="settings" size="lg" label="Settings" />
    <Button><Icon slot="icon" name="plus" />New</Button>
  </div>
</template>
```
