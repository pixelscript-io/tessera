export type Layer = 'start' | 'tools' | 'compile' | 'run'

export interface Pkg {
  id: string
  scope: string
  short: string
  layer: Layer
  summary: string
  points: string[]
  snippet: string
  /** Ids of the packages it depends on. */
  deps: string[]
}

export const LAYERS: ReadonlyArray<{ id: Layer; label: string }> = [
  { id: 'start', label: 'Get started' },
  { id: 'tools', label: 'Tools' },
  { id: 'compile', label: 'Compile and verify' },
  { id: 'run', label: 'Runtime and system' },
]

export const PACKAGES: Pkg[] = [
  {
    id: 'tessera',
    scope: '@pixelscriptio/',
    short: 'tessera',
    layer: 'start',
    summary:
      'The published package. It bundles the runtime, router, behaviors, tokens, Vite plugin, Prettier plugin and command line behind one install.',
    points: [
      'Subpath exports: /core, /router, /behavior, /tokens, /vite, /cli, /prettier, /a11y.',
      'Ships the tessera binary. Node.js 20 or newer.',
    ],
    snippet: 'npm install @pixelscriptio/tessera',
    deps: ['core', 'router', 'behavior', 'tokens', 'compiler', 'cli'],
  },
  {
    id: 'create',
    scope: '@pixelscriptio/',
    short: 'create-tessera',
    layer: 'start',
    summary:
      'Creates a project folder, asks which starting point you want, and writes the project into it.',
    points: ['Presets: tessera (the default), tailwind or none.'],
    snippet: 'npm create @pixelscriptio/tessera my-app',
    deps: ['tessera'],
  },
  {
    id: 'cli',
    scope: '@tessera/',
    short: 'cli',
    layer: 'tools',
    summary:
      'The tessera command: init, dev, build, check, lint, format, baseline, report, diff, codemod, docs, elements, a11y, tokens, manifest and mcp.',
    points: [
      'dev and build supply the Vite config and index.html.',
      'lint checks the CSS of any project against your tokens; elements builds custom elements with React wrappers.',
      'build --prerender writes static HTML for pages.',
    ],
    snippet: 'npx tessera check --fix',
    deps: ['agent', 'compiler', 'docs', 'contract', 'router', 'tokens'],
  },
  {
    id: 'editor',
    scope: '@tessera/',
    short: 'editor',
    layer: 'tools',
    summary:
      'Syntax highlighting, inline diagnostics and contract completion, from the same compiler as the CLI.',
    points: [
      'A Prettier plugin that formats each block with the right parser.',
      'tessera format runs it without an editor, with --check for CI.',
    ],
    snippet: '{ "plugins": ["@pixelscriptio/tessera/prettier"] }',
    deps: ['compiler', 'contract', 'tokens'],
  },
  {
    id: 'docs',
    scope: '@tessera/',
    short: 'docs',
    layer: 'tools',
    summary:
      'A documentation app generated from your contracts and tokens, so it cannot drift from the code.',
    points: [
      'Styled by your own semantic tokens, so the app and docs share one set of files.',
      'Token export, and Bring in tokens with --edit.',
    ],
    snippet: 'npx tessera docs --static',
    deps: ['compiler', 'tokens'],
  },
  {
    id: 'agent',
    scope: '@tessera/',
    short: 'agent',
    layer: 'tools',
    summary:
      'The manifest, the MCP server and AGENTS.md, so AI tools know the project and can ask the compiler.',
    points: [
      'A read-only MCP server over the project.',
      'validate_snippet returns what tessera check would print.',
    ],
    snippet: 'npx tessera mcp',
    deps: ['compiler'],
  },
  {
    id: 'compiler',
    scope: '@tessera/',
    short: 'compiler',
    layer: 'compile',
    summary:
      'A pure function from a .tess file to a TypeScript module, scoped CSS and a list of diagnostics.',
    points: [
      'No Node APIs, so it runs in a browser too.',
      'Checks styles against tokens and contrast in every theme.',
    ],
    snippet: "import { tessera } from '@pixelscriptio/tessera/vite'",
    deps: ['contract', 'tokens', 'behavior', 'router', 'core'],
  },
  {
    id: 'a11y',
    scope: '@tessera/',
    short: 'a11y',
    layer: 'compile',
    summary:
      'Accessibility tests generated from each contract and run with axe-core, for every variant, state and theme.',
    points: [
      'tessera a11y writes the tests into your project; the test tools are yours.',
      'Real mouse and keyboard in a real browser. NOT_COVERED lists what still needs a person.',
    ],
    snippet: "import { defineA11ySuites } from '@pixelscriptio/tessera/a11y'",
    deps: ['behavior', 'compiler', 'core', 'tokens'],
  },
  {
    id: 'core',
    scope: '@tessera/',
    short: 'core',
    layer: 'run',
    summary:
      'A push-pull signals runtime with no dependencies, a few hundred lines long. No virtual DOM.',
    points: [
      'state, derived and effect in every script.',
      'A change updates one text node and nothing else.',
    ],
    snippet: 'const count = state(0)',
    deps: [],
  },
  {
    id: 'router',
    scope: '@tessera/',
    short: 'router',
    layer: 'run',
    summary: 'File-based routes from app/pages, shared by the compiler, dev server and browser.',
    points: [
      'A link to a route that does not exist fails to compile.',
      'Keeps title, focus and scroll in sync.',
    ],
    snippet: 'app/pages/blog/[slug].tess  →  /blog/:slug',
    deps: ['core'],
  },
  {
    id: 'behavior',
    scope: '@tessera/',
    short: 'behavior',
    layer: 'run',
    summary:
      'Interaction logic separate from how a component looks: press, toggle, disclosure, dialog and combobox.',
    points: [
      'Declared in the contract, checked by the compiler.',
      'Each ships a conformance suite: keys, pointer, focus, and for a dialog the focus trap and scroll lock.',
    ],
    snippet: '"behavior": "press"',
    deps: ['core'],
  },
  {
    id: 'tokens',
    scope: '@tessera/',
    short: 'tokens',
    layer: 'run',
    summary:
      'DTCG JSON compiled to CSS custom properties in @layer, with themes as data attributes.',
    points: ['Aliases stay as var() references.', 'Switching a theme re-renders nothing.'],
    snippet: "setTheme('dark')",
    deps: [],
  },
  {
    id: 'contract',
    scope: '@tessera/',
    short: 'contract',
    layer: 'run',
    summary: 'Parses and validates the <contract> block, and derives types from it.',
    points: [
      'Unknown fields are errors, with a suggestion.',
      'A JSON Schema for editor autocomplete.',
    ],
    snippet: '"variants": { "tone": ["primary", "danger"] }',
    deps: [],
  },
]

export const byId = (id: string): Pkg => PACKAGES.find((p) => p.id === id)!

/** The packages that depend on `id`. */
export const usedBy = (id: string): string[] =>
  PACKAGES.filter((p) => p.deps.includes(id)).map((p) => p.id)

/** Package names as a sentence part: "core, router" or "nothing". */
export function names(ids: string[], none: string): string {
  return ids.length ? ids.map((i) => byId(i).short).join(', ') : none
}
