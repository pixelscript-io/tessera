# 3. Props and variants through a contract

A variant is a named choice with a fixed list of values. The first value is the default.

```xml tess
<contract>
{
  "name": "Chip",
  "role": "group",
  "parts": ["root", "label"],
  "variants": {
    "tone": ["neutral", "success", "danger"],
    "size": ["sm", "md"]
  },
  "slots": { "default": "the label" }
}
</contract>

<template>
  <span class="root"><span class="label"><slot /></span></span>
</template>
```

Variants arrive on the root element as `data-tone="neutral"` attributes, which is what styles select on. Using the component, a value that is not in the list is an error with a suggestion:

```xml tess kind=page error=T4008
<template>
  <main>
    <Chip tone="sucess" size="sm">Saved</Chip>
  </main>
</template>
```

```text
ERROR  T4008  app/pages/index.tess:3:15
  Chip.tone has no value "sucess".
  Did you mean "success"?
  Run `tessera explain T4008` for details.
```

The same contract also gives TypeScript the types of the component's props, through the generated `.tessera/components.d.ts`, and an editor the completions. Nothing about `tone` is written twice.

## Check

Fix the typo, then change `sm` to `xl` in the same page. Run `tessera check`: the message is [T4008](/reference/errors/T4008) again, because `xl` is not a declared size.

## Next steps

[Styling with tokens](/tutorial/04-styling).
