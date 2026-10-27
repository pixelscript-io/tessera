# Auto-import resolution

You write `<Button>` with no import. This is resolved when the file is compiled, not when it runs.

## The registry

At startup, and again whenever a component file is added, removed or edited, the Vite plugin scans the Tessera UI library (when installed), `system/components`, the router's own `<Link>`, and `app/components`, reads each file's contract, and builds a registry from contract name to file. A duplicate name is an error on every file involved ([T5001](/reference/errors/T5001)); there is no shadowing, except that a component in your project replaces a library component of the same name.

## At compile time

When the compiler meets a tag that is not an HTML element, it looks the name up. If found, it checks the usage against that component's contract (variant values, events, slots) and adds a real `import Button from "../../system/components/Button.tess"` to the generated module, with a path relative to the file. Only components a file uses get imports.

```text
import Button from "../../system/components/Button.tess"
```

## What that buys

- **No runtime registry.** The bundler sees ordinary imports, so an unused component is not in the bundle and every page splits normally. A test builds an app with a used and an unused component and checks the unused one's text is absent.
- **Real errors.** An unknown tag is a compile error with the nearest component suggested ([T4007](/reference/errors/T4007)).
- **Types and docs.** The same registry writes `.tessera/components.d.ts`, so TypeScript sees component props, and feeds the editor extension.

Script APIs (`state`, `derived`, `effect`, `onCleanup`, `onMount`, `navigate`, `useRoute`) are handled the same way: imported for you when a `.tess` script uses them. In a plain `.ts` file there is no compiler step to add the import, so using one without importing it is [T5002](/reference/errors/T5002), naming the import to add.

`autoImports: false` in `tessera.config.ts` turns all of it off for teams that prefer explicit imports; every name must then be imported.

## Next steps

[The route manifest](/how-it-works/routes).
