# Accessibility

Introduced in v0.1 (Milestone 7).

Accessibility in Tessera has three layers, from cheapest to most expensive. Knowing which layer catches what tells you where the gaps are.

## 1. The contract, at compile time

A contract names a component's ARIA `role` and its states. The compiler checks that the role is a real one ([T3005](/reference/errors/T3005)), that a behavior's required states and events are declared ([T3009](/reference/errors/T3009)), and that `contrast` pairings name declared parts ([T3010](/reference/errors/T3010)).

## 2. Contrast, at compile time

For every rule that sets a text token and a background token, and every pairing the contract declares, the compiler computes the WCAG contrast ratio in the base rule, in every state and variant rule (with the cascade), and in every theme. The default is AA (4.5:1). What it cannot see it does not check, and says so with [T2109](/reference/errors/T2109) when a declared pairing has no token on one side: a color set by script, a translucent background, text on a parent's background the contract does not name.

## 3. Generated tests, in a real browser

Tests are generated from the contract and run with axe-core in a real browser, per theme: every combination of variant values and every declared state the test can create, using real mouse and keyboard input; the role; disabled semantics; and, for behaviors, a visible focus outline and a conformance suite. See [Accessibility tests](/tutorial/09-accessibility).

## What none of it covers

Automation finds a minority of accessibility problems. These need a person:

- Reading order and heading structure across a page.
- Whether a label or alternative text is accurate and useful.
- Meaning carried by color, motion or position alone.
- Complex widgets' screen reader behavior (announcements, virtual cursor).
- Whether a flow is usable with a keyboard, a screen reader or zoom, end to end.
- Anything with a time limit, a captcha or an authentication step.

The exact list a generated suite does not cover is exported as `NOT_COVERED` from `@pixelscriptio/tessera/a11y` and repeated in [Behaviors and accessibility tests](/guide/behaviors). Passing generated tests is a floor, not a conformance claim.

## Routing

On each navigation the router sets the page title, announces the new page in a polite live region, moves focus to the page's root element and manages scroll. See [Pages and routing](/guide/pages-and-routing).

## Next steps

[Designing contracts](/guide/design-systems/contracts).
