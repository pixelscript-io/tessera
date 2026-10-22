# Enforcement

Introduced in v0.1 (Milestones 6 and 11).

Hard errors work when there is a way in for existing code, a way to fix, and a visible way out. Without those, enforcement becomes a wall that people route around. Tessera is strict, but accountable.

## What is an error

Anything in a component's `<style>` that leaves the system:

| Rule                                                                         | Code                             |
| ---------------------------------------------------------------------------- | -------------------------------- |
| A raw color where a token belongs                                            | [T2101](/reference/errors/T2101) |
| A value off the scale for a governed property                                | [T2102](/reference/errors/T2102) |
| A token of the wrong type for the property                                   | [T2103](/reference/errors/T2103) |
| An unknown token                                                             | [T2104](/reference/errors/T2104) |
| Text and background with too little contrast, in any theme, state or variant | [T2107](/reference/errors/T2107) |

Contract and template errors (an unknown variant value, a missing contract) are never baselined or exempted.

## A way to fix

Every violation names the closest valid alternative: the nearest token for a typo, the nearest color token by perceptual distance, the nearest scale step for a length. `tessera check --fix` applies a fix only when it is unambiguous (the value is exactly one token, or a typo has one candidate) and never changes how the default theme renders. A suggestion that would change the result is left as a suggestion.

## A way in: the baseline

`tessera baseline` records the violations an existing codebase has, per file and per rule. Builds and `check` then fail only on violations beyond those counts, so adoption starts with zero errors. The counts can only go down: fixing a violation leaves room that `tessera baseline --prune` takes back. The baseline file is committed.

## A way out: exceptions that are visible

There are two, and both are counted by `tessera report`.

**`raw()`** is for one value. It needs a reason and may have an expiry; past it, it is an error ([T2110](/reference/errors/T2110)).

```text
padding: raw(13px, "legacy modal spacing", "2027-03-01");
```

**Severity per path** is for a folder, in `tessera.config.ts`. A rule lowered to `warn` or `off` needs a `reason`, and may have `expires`; after that date the path is held to `error` again.

```text
severity: [{ files: 'app/legacy/**', rules: 'T2102', level: 'warn', reason: 'old screens', expires: '2027-03-01' }]
```

An exemption applies before the baseline: a path exempted by severity does not use up its recorded counts.

## Measuring

`tessera report` measures what styles contain, not what is imported, because import counts are easy to inflate. Watch the tokenized share go up per directory, expiring exceptions, and the baseline shrink.

## Next steps

[Accessibility](/guide/design-systems/accessibility).
