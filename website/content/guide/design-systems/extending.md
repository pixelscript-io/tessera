# Extending and ejecting

Introduced in v0.1 (Milestone 11).

There are two ways to change a system component, and one way not to.

## Wrap it

An app component can use a system component inside its own template and add behavior or layout around it. This keeps one source of truth, and the system's upgrades arrive for free.

```xml tess
<contract>
{
  "name": "SaveButton",
  "role": "group",
  "parts": ["root"],
  "events": { "save": "the user pressed save" }
}
</contract>

<script>
function save() {
  emit('save')
}
</script>

<template>
  <div class="root">
    <Button tone="primary" @press="save">Save</Button>
  </div>
</template>
```

## Eject it

When wrapping is not enough, own a copy:

```bash
tessera eject Button FancyButton
```

This copies the component into `app/components/` under the new name and records where it came from in the contract:

```text
"name": "FancyButton",
"forkedFrom": { "component": "Button", "version": "0.1.0" },
```

The copy is yours: change anything. The `forkedFrom` record is what keeps the drift visible, so a later report (`tessera diff`, planned) can say when the original has changed. Ejecting one of your own components is refused.

## Do not shadow

There is no shadowing. A component with the name of a system component is an error ([T5001](/reference/errors/T5001)) on each file, naming the others. Silent overrides are how design systems fork without anyone deciding to.

## Next steps

[Versioning and deprecation](/guide/design-systems/versioning).
