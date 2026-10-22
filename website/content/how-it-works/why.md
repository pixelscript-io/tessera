# Why contracts and enforcement

## One source of truth

A component's public surface is described in several places in most codebases: a props type, a Storybook story, a documentation page, a test, a changelog entry. Each is written by hand and each drifts. A contract is a single place, and the rest is derived from it, so there is nothing to forget to update: types, tests and the manifest come from the contract, and styles and tokens are checked against it.

## Why the compiler

A rule that a person has to remember is a rule that gets broken, then excused, then dropped. A check that runs in review runs late, after the code is written, and costs a conversation each time. A compiler check runs while the code is written, names the file and line, and can suggest the fix. The goal is to make the right thing the easy thing: `$space.4` is shorter to write than guessing a number, and the editor completes it.

## Why strict, and why accountable

Strictness alone fails in a known way: an existing codebase meets a wall of errors, and the response is to turn the rule off. So each hard error has a way around it that is visible and counted:

- **A baseline**, so existing code starts at zero errors and the count can only go down.
- **A suggested fix**, and an autofix only when it cannot change the result.
- **Exceptions that need a reason and can expire**, listed by `tessera report`.

The aim is that bypassing the system is possible, honest and tracked, instead of silent. Adoption is measured from what styles actually contain, not from import counts, because import counts are easy to inflate.

## Why standards

Tokens are DTCG JSON, themes are data attributes and custom properties, layers are CSS `@layer`, state is `data-*`, accessibility is ARIA and axe-core. Where a standard exists, Tessera uses it, so the pieces work with tools that do not know Tessera exists and the skills transfer.

## Why a small runtime behind an adapter

The runtime is intentionally minimal and sits behind an adapter, because the part that makes Tessera different is the design-system layer, not the renderer. A small renderer is easy to understand, test and replace. Competing with mature frameworks on rendering performance is a non-goal.

## What this costs

The enforcement is the point and also the price: it is an opinionated system, it needs a design system to be worth much, and it is a young project with a small ecosystem. See [What is Tessera?](/introduction/) for who it is for and who it is not.
