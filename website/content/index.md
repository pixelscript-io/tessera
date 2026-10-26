---
layout: home
hero:
  name: Tessera
  text: A design-system-first frontend framework
  tagline: Tokens, accessibility, variants and docs are built in and enforced at compile time.
  actions:
    - theme: brand
      text: Quick start
      link: /quick-start
    - theme: alt
      text: What is Tessera?
      link: /introduction/
features:
  - title: The contract is the component
    details: A component declares its anatomy, variants, states and accessibility in a contract. The compiler checks every use against it.
    link: /guide/contracts
  - title: Styles come from tokens
    details: A raw color or an off-scale spacing value is a build error with the nearest valid token suggested, and an autofix when it is unambiguous.
    link: /guide/styles
  - title: A way in for existing code
    details: A baseline records today's violations so an existing app can turn enforcement on with zero errors and fail only on new ones.
    link: /guide/cli
  - title: Light to write
    details: Single-file components with HTML-like templates, signals, auto-imported components, file-based routing and layouts.
    link: /tutorial/
---

Status: early development (v0.6). `@pixelscriptio/tessera` 0.6.7 is on npm. See [Releases](/releases/) for what exists and [the roadmap](/releases/roadmap) for what does not.
