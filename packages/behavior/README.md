# @tessera/behavior

Headless interaction behaviors for Tessera components: keyboard handling, pointer handling, ARIA state and normalized events, with no styles and no framework. A component attaches one through its contract (`"behavior": "press"`) and a template listener (`@press="..."`).

Built: `press`. Reserved names with no implementation yet: `toggle` and `disclosure` (Milestone 17).

## Maintainer

**Maintainer:** joeberthelot88@gmail.com (the repository owner). One named owner is a supply-chain risk, so the rest of this file is what a second maintainer or a fork needs to carry the package on.

## Policy

**Versioning.** Semantic versioning once the package reaches 1.0. Until then a breaking change (a changed event detail, a changed attribute, a removed option) is a minor version bump and appears in the changelog. Behaviors expose state as `data-state` attributes; those values are part of the public API.

**Accessibility bugs.** A report that a behavior cannot be operated by keyboard, or announces the wrong role or state, is triaged first:

1. _Blocks use_ (a keyboard or assistive technology user cannot perform the action): fixed in the next release, and a conformance case that fails before the fix is added.
2. _Degrades use_ (the action works but state or role is wrong or misleading): fixed in the next minor release with a conformance case.
3. _Polish_: scheduled normally.

A fix is not done until its conformance case exists. The conformance suite is the specification: if a behavior and its cases disagree, the cases are right until they are changed on purpose.

**Conformance.** `src/conformance.ts` holds keyboard, pointer, disabled and ARIA cases per behavior, written once against a small harness. They run against the behavior on a native element and on a non-native one (`packages/behavior/test`), and `@tessera/a11y` runs them again against every component whose contract names the behavior, in a real browser with a real keyboard.

**Adding a behavior.**

1. Add its requirements (parts, events, states) to `src/requirements.ts`.
2. Write the conformance cases first, then the implementation in `src/<name>.ts`, which talks to the DOM only through the renderer adapter.
3. Wire its event in the compiler (`BEHAVIOR_EVENTS`) and mark it `implemented`.
4. A behavior must work with no styles applied and must not depend on a framework.

**Build or adopt.** `press` is built in-house (see the Decisions log in `SPEC.md`, Milestone 7). Complex behaviors (dialog, combobox, menu, tabs) will get a fresh build-versus-adopt spike each; Zag.js is the candidate to wrap.
