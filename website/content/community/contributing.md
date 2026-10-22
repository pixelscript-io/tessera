# Contributing

## Setting up

```bash
pnpm install
pnpm build
pnpm test
```

`pnpm test` builds the packages that Node needs, then runs every test: unit tests in Node and jsdom, and browser tests in a real browser (Playwright using an installed Edge, so no download is needed). `pnpm run ci` runs what CI runs: lint, formatting, type-checking, tests and the docs build.

## How the work is organized

The repository is a pnpm workspace: `packages/` (the framework), `system/` (the design system, which dogfoods the framework), `examples/kitchen-sink/` (a real app) and `website/` (this site). `SPEC.md` at the root is the specification, built milestone by milestone, and its Decisions log records every choice the spec left open.

## Rules

- Read `SPEC.md` first, and work on one milestone at a time.
- Tests come first. Error messages are product: tests assert their exact text.
- Do not add a runtime dependency without discussing it.
- Anything that can be generated must not also be written by hand.
- Every documentation sample is compiled in CI, and every link is checked.

## Documentation

Pages are Markdown in `website/content/`. A fenced block needs a language. `.tess` samples are written as ` ```xml tess `: they are compiled against the kitchen-sink project, and a sample that is meant to fail says which code it produces (`error=T2102`). A page that links to something that does not exist fails the docs build. The reference pages are generated (`pnpm --filter website generate`); fix the source, not the output.
