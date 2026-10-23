# Auto-imports

Introduced in v0.1 (Milestone 8).

In a `.tess` file you do not import components or the script APIs. The compiler resolves them.

```xml tess kind=page
<script>
const count = state(0)
</script>

<template>
  <div class="root">
    <Button tone="danger" @press="count++">Delete</Button>
  </div>
</template>
```

## Components

Every `.tess` file in `system/components/**` and `app/components/**` is registered under its contract `name`, which must match the file name. Subfolders are only organization.

- Names are global across both folders. A repeated name is an error on each file that repeats it, naming the others (T5001). There is no shadowing: to change a system component, wrap it, or `tessera eject` it under a new name.
- Resolution happens at compile time. The compiler finds the component tags a file uses and emits a real `import` for each of those, and only those. There is no runtime registry, so an unused component is not in your bundle and each page splits normally.
- An unknown tag is an error with a suggestion: `Unknown component <Buton>. Did you mean <Button>?`
- Tags are checked against the registered contract: variant values, events and slots (`Button.tone has no value "dangr". Did you mean "danger"?`).
- An explicit `import Button from './Button.tess'` still works and takes precedence.
- Dynamic components (a tag name chosen from a variable) are not supported.

## Script APIs

`state`, `derived`, `effect`, `onCleanup` and `onMount` are imported for you when a `.tess` script uses them (and `props` and `emit` are always available). `navigate` and `useRoute` join them with routing.

Outside `.tess` files there is nothing to add the import, so using one in a plain `.ts` file is an error that names the import:

```text
ERROR  T5002  app/utils/nav.ts:2:17
  Unresolved identifier "useRoute" in app/utils/nav.ts. Auto-imports only apply inside .tess files; import it from "@pixelscriptio/tessera/router".
```

This check looks for a call to the name in a file that never imports, declares or takes it as a parameter. It is not a type checker, so a shadowed name it cannot see is not reported.

## Turning it off

```ts
tessera({ config: { autoImports: false } })
```

Then every name must be imported, in components and scripts. A missing component says which line to add:

```text
ERROR  T4007  app/components/Card.tess:6:6
  Unknown component <Button>.
  Auto-imports are off, so import it: import Button from "../../system/components/Button.tess"
```

Components stay registered for the docs and the manifest.

## Types and editors

The plugin writes `.tessera/components.d.ts` (add it to `.gitignore`). It lists every component tag with its props, events, slots and parts, and types each `.tess` import by file name, so TypeScript code that calls a component gets variant values checked. The editor extension reads the same registry, so a misspelled tag or variant shows inline.

## Hot updates

Adding, removing, renaming or editing a component file updates the registry and the types, and recompiles the components that might use it, without restarting the dev server.
