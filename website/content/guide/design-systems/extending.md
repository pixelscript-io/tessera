# Extending

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

## Copy it under another name

When wrapping is not enough, own a copy. A component from [Tessera UI](/guide/tessera-ui) is already a copy that is yours to edit; to keep both the original and a changed version, add it again under another name:

```bash
tessera add Button --as FancyButton
```

The file, the contract's `name` and the examples in its docs are renamed together, and the two do not share styles.

## Do not shadow

There is no shadowing. A component with the name of a system component is an error ([T5001](/reference/errors/T5001)) on each file, naming the others. Silent overrides are how design systems fork without anyone deciding to.

## Next steps

[Versioning and deprecation](/guide/design-systems/versioning).
