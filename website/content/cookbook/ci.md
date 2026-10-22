# Configuring CI

Three commands cover a Tessera project. Run them in any CI system; this is a generic shell sequence.

```bash
pnpm install --frozen-lockfile
node node_modules/.bin/tessera check
pnpm vitest run
pnpm build
```

(`tessera check` is also available as the `check` script a new project has: `pnpm check`.)

## What each catches

- **`tessera check`** runs the compiler's validation on the whole project without bundling: tokens, contracts, templates, styles, contrast in every theme, links, layouts, route conflicts, and auto-imports in `.ts` files. It exits 1 on any error. It is fast, so run it first.
- **`vitest run`** runs your tests, including the generated accessibility suites if you have them. Those need a browser (Playwright), so install one in CI.
- **`build`** proves the app bundles.

## Reports in CI

`tessera report --json` prints machine-readable metrics. A simple use is to keep the tokenized share from regressing:

```bash
tessera report --json > report.json
```

and compare `styles.ratio` and `baseline.violations` against the last run, in whatever your CI offers for artifacts and thresholds.

## Fail on expired exceptions

An expired `raw()` or severity exemption is an error in `check`, so a date passing turns the build red without a separate job. `tessera report` lists upcoming expiries if you want a warning earlier.

## Next steps

[The command line](/guide/cli).
