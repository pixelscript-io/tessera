# The design system as custom elements

Introduced in v0.5.

Not every team will write `.tess` files. `tessera elements` builds the design system's components as standard custom elements, so the same system, with the same tokens, themes and accessibility, works in React, Vue, Svelte, Angular or plain HTML.

```bash
npx tessera elements
```

It builds the components in `system/components` into `dist-elements`, a folder with no dependency on Tessera:

```text
dist-elements/
  elements.js           the elements, and the runtime they need, in one module
  elements.css          the design tokens (and their themes) and the components' styles
  react.js              each element as a React component (no JSX, no build step)
  react.d.ts            types for the React components
  elements.d.ts         types for the elements, and the tag map
  custom-elements.json  the manifest that editors and docs tools read
  README.md             how to use it, for the team that gets the folder
```

For the `tessera` preset that is 11 elements in about 9 kB of JavaScript and 3 kB of CSS, gzipped. Publish the folder to npm, serve it from your own host, or copy it into an app.

## Use from HTML or any framework

```text
<link rel="stylesheet" href="elements.css" />
<script type="module" src="elements.js"></script>

<t-button tone="danger">Delete</t-button>
<t-checkbox checked>Send me product news</t-checkbox>
<t-accordion-item>
  <span slot="title">What is a contract?</span>
  A component's description of itself.
</t-accordion-item>
```

The tag is the prefix, a hyphen and the component's name in kebab case: `Button` is `<t-button>`, `AccordionItem` is `<t-accordion-item>`. Change the prefix with `--prefix acme` to get `<acme-button>`.

- **Variants and props are attributes and properties.** `tone="danger"` and `el.tone = 'danger'` do the same. A boolean (`disabled`, `checked`, `open`) is on when its attribute is present, and off for `"false"`. A list, such as a combobox's `options`, is set as a property (`el.options = [...]`), or as JSON in the attribute.
- **Events are DOM events.** What a component emits (`press`, `toggle`, `select`, `dismiss`, ...) is dispatched on the element as a `CustomEvent` with the same name, and the payload is in `detail`. It bubbles. A native event of the same name from something inside the component (a text field's own `input` event) is not passed on, so you hear the component's events and not both.
- **Slots are children.** A child with `slot="title"` fills the `title` slot; everything else fills the default slot. Slot content is read when the element is added to the page and is not watched afterward.
- **It renders in the light DOM**, so the page's tokens and the component's own styles apply. The element itself takes no space (`display: contents`).

## Themes

The tokens and their themes are in `elements.css`, and they work as they do in an app: an attribute on the page turns a theme on.

```ts
document.documentElement.setAttribute('data-theme', 'dark')
```

`data-theme="auto"` follows the system setting, for a theme the tokens say follows it.

## React

```text
import { Button, Checkbox, Combobox } from './dist-elements/react.js'
import './dist-elements/elements.css'

<Button tone="danger" onPress={(event) => save(event.detail)}>Delete</Button>
<Checkbox checked={agreed} onToggle={(event) => setAgreed(event.detail.checked)}>Agree</Checkbox>
<Combobox options={fruit} onSelect={(event) => pick(event.detail.value)}>
  <span slot="label">Fruit</span>
</Combobox>
```

The wrappers set variants and props as properties (so a list or a boolean arrives as itself in any version of React), pass everything else to the element as attributes (`aria-*`, `slot`, `data-*`), turn `className` into `class`, and turn each event into an `on` prop: `press` is `onPress`, `toggle` is `onToggle`. A ref reaches the element. `react.d.ts` has the types, with each variant as a union of its values, so a wrong value is a type error. React is yours; the wrapper imports it and nothing else.

## Vue, Svelte, Angular

Custom elements work in them directly: load `elements.js` and `elements.css` once (in your entry file, and in `angular.json` for the stylesheet), then write the tags. In Vue, tell the compiler the tags are not Vue components:

```ts
app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('t-')
```

Svelte needs nothing. In Angular, add `CUSTOM_ELEMENTS_SCHEMA` to the `schemas` of the module or standalone component that uses the tags, and listen to events with the usual `(press)="save()"`; in Vue it is `@press="save"`.

`elements.d.ts` has an element type for each tag and adds them to `HTMLElementTagNameMap`, so `document.querySelector('t-button')` is typed. Listen to a component's own events with `addEventListener`, which has an overload for each of them.

## What the build does

`tessera elements` compiles each component the way the app does, with the contract, the token checks and the contrast checks, then registers it with `defineElement` and bundles the lot with the runtime. `defineElement(tag, component, spec)` is in `@pixelscriptio/tessera/core` if you want to register a single component yourself. The spec is the contract's variants, events and slots, and the props the component's script names with their defaults.

Every component that passes the [generated accessibility tests](/tutorial/08-accessibility) in an app is the same component here: the elements page of the repository's tests runs axe on the built elements in light and dark.

## What it does not do

- **It does not build your app components** unless you pass `--all`. The design system is the part other teams share.
- **Slot content is not watched.** Add or change a component's children by changing its properties, or by replacing the element.
- **There is no Shadow DOM.** That keeps the tokens and themes of the page working, and means the page's own CSS can reach the component's parts, which are the documented class names.
- **No server rendering.** The elements render when they are defined, in the browser.
- **Vue and Svelte wrappers** are not generated. They do not need them: custom elements are first-class there.

## Related

- [The design system docs](/guide/docs-app)
- [Behaviors and accessibility tests](/guide/behaviors)
- [The command line](/guide/cli)
