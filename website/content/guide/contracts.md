# Contracts

Introduced in v0.1 (Milestone 3).

Every component declares a contract: its anatomy, variants, states, accessibility role, slots and events. The contract is a JSON block (comments allowed) and everything else, such as types, docs and accessibility tests, is derived from it.

```json
{
  "name": "Button",
  "role": "button",
  "parts": ["root", "icon", "label"],
  "variants": {
    "tone": ["primary", "neutral", "danger"], // first value is the default
    "size": ["sm", "md", "lg"]
  },
  "states": ["hover", "focus-visible", "pressed", "disabled"],
  "behavior": "press",
  "slots": { "default": "label content", "icon": "optional leading icon" },
  "events": { "press": "fired on click, Enter, or Space" },
  "contrast": [{ "foreground": "label", "background": "root" }]
}
```

| Field                                                             | Required | Meaning                                                                                                         |
| ----------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `name`                                                            | yes      | PascalCase; must equal the file name (`Button.tess`).                                                           |
| `role`                                                            | yes      | An ARIA role.                                                                                                   |
| `parts`                                                           | yes      | Public class names. Must include `root`; each must appear as a class in the template.                           |
| `variants`                                                        | no       | Name to allowed values. The first value is the default. Becomes typed props.                                    |
| `states`, `slots`, `events`                                       | no       | Declared states, slot names and event names.                                                                    |
| `behavior`                                                        | no       | A headless behavior (`press`, `toggle`, `disclosure`). The contract must declare the parts and events it needs. |
| `contrast`                                                        | no       | Foreground and background parts to check for contrast. Both must be declared parts.                             |
| `preview`                                                         | no       | Sample props and slot content to show the component with (see below).                                           |
| `description`, `since`, `deprecated`, `renamedFrom`, `forkedFrom` | no       | Docs and versioning.                                                                                            |

Unknown fields are errors, with a suggestion for typos.

## Showing a component: `preview`

A component that needs data or children does not look like itself without them: a `Select` with no options, an `Accordion` with no items. `preview` says what to show it with, once, in the contract:

```text
"preview": {
  "props": { "options": [{ "value": "a", "label": "Apple" }], "placeholder": "Search fruit" },
  "slots": {
    "label": "Fruit",
    "default": [
      { "component": "AccordionItem", "slots": { "title": "A question", "default": "An answer." } },
      { "tag": "input", "attrs": { "type": "date" } }
    ]
  }
}
```

- `props` gives a sample value for a variant or for a prop the script takes (`options`, `value`).
- `slots` gives content for a declared slot: text; a `{ "component", "props", "slots" }` node for another component; a `{ "tag", "attrs", "text", "children" }` node for an element; or a list of them. A slot the contract does not declare is an error, with the nearest name.

Three things read it, so they agree: the **design system docs** mount the component with it (and add a control for every variant and for every prop whose default is text, a number or on/off, and a text box for every text slot); the **generated accessibility tests** mount the component with it; and the **usage examples** in the manifest, `AGENTS.md` and the MCP server are written from it, so an AI tool is shown `<Accordion>` with its items and not `<Accordion>content</Accordion>`. A component with no `preview` is shown with its defaults, and the docs say so when it looks like it needs one.

## Errors

```text
ERROR  T3002  Button.tess:5:3
  Unknown contract field "varients".
  Did you mean "variants"?
  Run `tessera explain T3002` for details.
```

Contract codes run from T3001 to T3013.

## Editor support

`packages/contract/contract.schema.json` is a JSON Schema for the contract block, for autocomplete and inline errors. It cannot express every rule (name matches file, contrast parts exist, behavior requirements), so the compiler remains the source of truth.

## Derived types

`generateTypes(contract)` produces `ButtonProps` (variants as unions of allowed values), `ButtonSlots`, `ButtonEvents` and `ButtonPart`.
