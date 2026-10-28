# Designing contracts

Introduced in v0.1 (Milestone 3).

The contract is the public face of a component. Everything derived from it (types, tests, docs, enforcement) is only as good as it is, so it is worth designing on purpose.

## Parts: the names consumers can rely on

`parts` lists the named pieces of the template. Each must appear as a class in the template ([T3011](/reference/errors/T3011)), and the root element must carry `root` ([T3013](/reference/errors/T3013)). A part is a promise: styles, tests and documentation refer to it, so renaming one is a breaking change.

Keep parts to what someone else would need to name. A wrapper `div` that exists for layout is not a part.

## Variants: closed sets

A variant is a choice with a fixed list of values, the first being the default. Prefer a few meaningful variants (`tone`, `size`, `emphasis`) over many booleans. Because the values are a closed list, a typo is a compile error and an editor can complete them.

If two variants only make sense in some combinations, that is usually two components.

## States

`states` declares the states a component can be in that styles and tests care about (`hover`, `focus-visible`, `pressed`, `disabled`). The generated accessibility tests create the ones they can and check each.

## Slots and events

Declare every slot and event the component offers, with a one-line description. A slot not in the contract is an error for the user ([T4009](/reference/errors/T4009)) and an event not in the contract is an error for the author ([T4010](/reference/errors/T4010)).

## Behavior

Use `behavior` when the interaction is standard (`press`). The behavior needs the contract to declare specific parts and events, so the contract cannot promise a button and forget the event.

## Contrast pairings

`contrast` names foreground and background parts to check across themes when the pairing is not obvious from one rule. Declare the pairings that matter.

## Naming

`name` is PascalCase and must equal the file name. Names are global across `system/components` and `app/components` ([T5001](/reference/errors/T5001)), so choose names a second team could not also want.

## Next steps

[Extending](/guide/design-systems/extending).
