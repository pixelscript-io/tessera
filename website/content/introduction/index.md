# What is Tessera?

Tessera is a frontend framework in which the design system is the core abstraction, not an add-on. A component is one small file with a contract, a template and token-constrained styles. The compiler checks the system, so drifting from it is a build error rather than a review comment.

```xml tess
<contract>
{
  "name": "Badge",
  "role": "status",
  "parts": ["root"],
  "variants": { "tone": ["neutral", "success", "danger"] },
  "slots": { "default": "label" }
}
</contract>

<template>
  <span class="root"><slot /></span>
</template>

<style>
.root {
  padding: $space.1 $space.2;
  border-radius: $radius.md;
  background: $color.surface.raised;
  color: $color.text.default;
}
</style>
```

From that file the compiler knows what `<Badge tone="success">` may be, what its tokens are, and that `<Badge tone="sucess">` is wrong:

```text
ERROR  T4008  app/pages/index.tess:5:18
  Badge.tone has no value "sucess".
  Did you mean "success"?
  Run `tessera explain T4008` for details.
```

## Why

Most frameworks make the component the core abstraction and leave the design system to other tools: tokens in one place, accessibility in a library, documentation in a separate app, enforcement in a linter that nobody runs. The result is drift, and drift is found in review, late and by hand.

Tessera puts those concerns in the compiler:

- **Tokens** are [DTCG](https://www.designtokens.org/) JSON compiled to CSS custom properties in `@layer`. Styles use `$space.4`; a value off the scale is an error.
- **Contracts** declare a component's parts, variants, states, slots, events, role and behavior once. Types, tests and documentation are derived from them.
- **Accessibility** is checked by tests generated from the contract and run with axe-core, for every variant, state and theme.
- **Enforcement is accountable.** Hard errors come with a suggested fix, an autofix where it is safe, a [baseline](/guide/cli) for existing code, and exceptions that need a reason and can expire.

## Who it is for

- Teams that build a design system and want it enforced where the code is written, not just documented.
- Teams adopting a design system in an existing app, who need to turn enforcement on without a wall of errors.
- People who like single-file components and want fewer moving parts than a framework plus a token tool plus a docs tool plus a linter.

## Who it is not for

- Anyone who needs a mature ecosystem, server rendering, a data layer or a large library of third-party components today. Tessera is early, and these are non-goals for v0.x.
- Projects where the design system is not a goal. The enforcement is the point, and without a design system it is overhead.

## How it compares

This is a short, honest comparison, not a claim of superiority.

|                                      | Tessera                                              | Vue, Svelte                       | React with shadcn/ui                 |
| ------------------------------------ | ---------------------------------------------------- | --------------------------------- | ------------------------------------ |
| Authoring                            | Single-file components, HTML-like templates, signals | Single-file components, templates | JSX, components in code              |
| Design system                        | In the compiler: tokens, contracts, enforcement      | Not part of the framework         | A set of components you copy and own |
| Accessibility tests                  | Generated from contracts, run with axe-core          | Written by hand                   | Written by hand                      |
| Ecosystem, tooling, performance work | Very small, early                                    | Large, mature                     | Very large, mature                   |
| Rendering                            | A small signals runtime behind an adapter            | Highly optimized                  | Highly optimized                     |

Tessera's runtime is deliberately small and sits behind an adapter so it can change. It does not try to compete with these frameworks on renderer performance or ecosystem. Tools such as Storybook and token pipelines solve parts of the same problem as separate programs; Tessera's bet is that having the compiler know the system makes enforcement cheap enough to be on by default. Whether that bet is right is for people using it to find out.

## Status

Tessera is at v0.1: the pieces in this site exist and are tested, and the first release is on npm, but the API will change, and the in-browser playground, versioned docs and a hosted site are deferred. [Releases](/releases/) lists what each milestone delivered and [the roadmap](/releases/roadmap) what is next.

## Non-goals for v0.x

- Competing with React, Vue or Svelte on renderer performance or ecosystem.
- Server rendering, hydration, streaming and islands. The design leaves room for them; they are not built.
- A full-stack or backend framework.
- Native mobile targets.
- A visual editor or Figma plugin. Tokens move in and out as files.
- A global store or data-fetching layer. Routing and single-level layouts are included; nested routes, guards and data loaders are not.

## Next steps

- [Quick start](/quick-start): a running project in a few commands.
- [Tutorial](/tutorial/): build a themed, routed page with a token-enforced component.
- [How it works](/how-it-works/): the compile pipeline and the runtime.
