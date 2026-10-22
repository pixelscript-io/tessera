# Adopting in a legacy codebase with a baseline

You have an app whose styles were written before the design system. You want enforcement on without fixing everything first.

## 1. Set up the system

Run `tessera init` in a scratch folder and copy `system/`, `tessera.config.ts` and the Vite plugin registration into your project, or follow the [Quick start](/quick-start) and move your app code into it. Put your existing tokens in DTCG form in `system/tokens`.

## 2. See where you are

```bash
tessera check
tessera report
```

`check` lists every violation; `report` says what share of style declarations already use tokens, per directory.

## 3. Record the debt

```bash
tessera baseline
```

writes `tessera.baseline.json`: per file and per rule, how many violations exist today. Commit it. `check` and builds now fail only on violations beyond those counts, so the project is at zero errors.

Contract errors are never baselined. A component without a valid contract is an error whatever the baseline says; if you have many, relax the requirement for `app/components` while you migrate:

```text
export default { contracts: 'optional' }
```

Components without a contract are counted by `tessera report` as missing coverage.

## 4. Stop it getting worse

Run `tessera check` in CI ([Configuring CI](/cookbook/ci)). A new violation fails; fixing one is rewarded:

```text
0 errors, 0 warnings in 142 files.
38 existing violations are covered by the baseline.
The baseline can be lowered: run `tessera baseline --prune`.
```

## 5. Pay it down

Fix what you touch. `tessera check --fix` applies the unambiguous fixes across the project (a raw value that is exactly one token). When a part of the app will take longer, give it a visible, dated exception instead of leaving it in the baseline:

```text
severity: [{ files: 'app/legacy/**', rules: 'T2102', level: 'warn', reason: 'rebuilt in Q2', expires: '2027-06-30' }]
```

After the date the path is held to the rule again, and `tessera report` lists the exception and its date until then. Run `tessera baseline --prune` after a round of fixes so the recorded counts drop with them.

## Next steps

[Configuring CI](/cookbook/ci).
