# 1. A first component

A component is one `.tess` file. Create one with the CLI:

```bash
tessera new component Greeting
```

That writes `app/components/Greeting.tess` with a valid starter. Replace its contents with this:

```xml tess
<contract>
{
  "name": "Greeting",
  "role": "group",
  "parts": ["root"],
  "slots": { "default": "who to greet" }
}
</contract>

<template>
  <p class="root">Hello, <slot />!</p>
</template>
```

Three blocks, and the one you may not know is the `<contract>`: it says what the component is. Its `name` must match the file name, `role` is the ARIA role, and `parts` lists the named pieces of its template. The element carrying `class="root"` is the root part.

Use it in a page. There is no import:

```xml tess kind=page
<template>
  <main>
    <Greeting>world</Greeting>
  </main>
</template>
```

## Check

Run the check, then misspell the tag in the page (`<Greting>`) and run it again:

```bash
tessera check
```

```text
ERROR  T4007  app/pages/index.tess:3:6
  Unknown component <Greting>.
  Did you mean <Greeting>?
  Run `tessera explain T4007` for details.
```

## Next steps

[State and templates](/tutorial/02-state-and-templates).
