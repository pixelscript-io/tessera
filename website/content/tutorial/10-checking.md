# 10. Keeping it checked

Everything so far runs when you build. `tessera check` runs the same validations without bundling, which is what you want in CI.

```bash
tessera check
```

It exits 1 on any error. Warnings (a `raw()` in use, a pairing the compiler could not check) never fail it.

## Exceptions that are visible

When part of an app cannot meet the system yet, say so in `tessera.config.ts`, with a reason and a date:

```text
export default {
  severity: [
    {
      files: 'app/legacy/**',
      rules: 'T2102',
      level: 'warn',
      reason: 'old screens, being rebuilt',
      expires: '2027-03-01',
    },
  ],
}
```

A reason is required ([T2112](/reference/errors/T2112) without one). After the date the rule is an error again.

## Existing code

If you are adding Tessera to code that already breaks the rules, record the violations instead of fixing them first:

```bash
tessera baseline
```

`check` and builds now fail only on violations beyond the recorded counts. Fixing one makes `check` tell you the baseline can be lowered, and `tessera baseline --prune` lowers it.

## See where you are

```bash
tessera report
```

prints the share of style declarations that use tokens (in total and per directory), every `raw()` with its reason and expiry, every exemption, the baseline debt, contract coverage and where generated accessibility suites exist. `--json` is for CI.

## Next steps

You have built a themed, routed page with a token-enforced component. Read the [guides](/guide/reactivity) for each part in depth, [How it works](/how-it-works/) for the design, or the [cookbook](/cookbook/) for recipes such as [configuring CI](/cookbook/ci).
