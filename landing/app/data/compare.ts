/** What the comparison page says: the features people compare most, and what each framework gives for each. */

export type Status = 'built' | 'partial' | 'library' | 'planned' | 'none'

export const STATUS_LABEL: Record<Status, string> = {
  built: 'Built in',
  partial: 'Partly',
  library: 'Via a library',
  planned: 'Planned',
  none: 'No',
}

export const STATUS_MEANING: ReadonlyArray<{ status: Status; meaning: string }> = [
  { status: 'built', meaning: 'Part of the framework, or its official tooling.' },
  { status: 'partial', meaning: 'Some of it, or it comes with a limit.' },
  {
    status: 'library',
    meaning: 'A popular library or a meta-framework, such as Next.js, Nuxt or SvelteKit.',
  },
  { status: 'planned', meaning: 'On the roadmap, not built yet.' },
  { status: 'none', meaning: 'Not available, or not a goal.' },
]

export type FrameworkId = 'tessera' | 'react' | 'vue' | 'svelte'

export const FRAMEWORKS: ReadonlyArray<{ id: FrameworkId; name: string }> = [
  { id: 'tessera', name: 'Tessera' },
  { id: 'react', name: 'React' },
  { id: 'vue', name: 'Vue' },
  { id: 'svelte', name: 'Svelte' },
]

export interface Cell {
  status: Status
  /** One short line: what you get, or what you would use. */
  text: string
}

export interface Row {
  feature: string
  /** What the feature is, when the name does not say. */
  note?: string
  cells: Record<FrameworkId, Cell>
}

export interface Group {
  title: string
  rows: Row[]
}

const cell = (status: Status, text: string): Cell => ({ status, text })

export const GROUPS: Group[] = [
  {
    title: 'Components and reactivity',
    rows: [
      {
        feature: 'Reactive state',
        cells: {
          tessera: cell('built', 'Signals: state, derived and effect.'),
          react: cell('built', 'Hooks, with components that render again.'),
          vue: cell('built', 'Refs and reactive objects.'),
          svelte: cell('built', 'Runes: $state, $derived and $effect.'),
        },
      },
      {
        feature: 'Single-file components',
        note: 'Markup, logic and styles in one file.',
        cells: {
          tessera: cell('built', '.tess: contract, script, template and style.'),
          react: cell('partial', 'JSX joins markup and logic; styles live elsewhere.'),
          vue: cell('built', '.vue files.'),
          svelte: cell('built', '.svelte files.'),
        },
      },
      {
        feature: 'Updates without a virtual DOM',
        cells: {
          tessera: cell('built', 'A change updates the one node that reads it.'),
          react: cell('none', 'A virtual DOM; the React Compiler cuts re-renders.'),
          vue: cell('partial', 'A virtual DOM with compile-time hints; Vapor Mode is opt-in.'),
          svelte: cell('built', 'Compiled to direct DOM updates.'),
        },
      },
      {
        feature: 'Slots and events',
        cells: {
          tessera: cell('built', 'Declared in the contract, so a wrong name is an error.'),
          react: cell('built', 'Children and callback props.'),
          vue: cell('built', 'Slots and emitted events.'),
          svelte: cell('built', 'Snippets and callback props.'),
        },
      },
      {
        feature: 'Type-checked templates',
        cells: {
          tessera: cell('planned', 'Props are typed from the contract; templates are not yet.'),
          react: cell('built', 'TypeScript checks JSX.'),
          vue: cell('built', 'vue-tsc checks templates.'),
          svelte: cell('built', 'svelte-check checks templates.'),
        },
      },
    ],
  },
  {
    title: 'Pages and data',
    rows: [
      {
        feature: 'Routing and layouts',
        cells: {
          tessera: cell('partial', 'File-based pages and layouts. No nested routes or guards yet.'),
          react: cell('library', 'React Router, TanStack Router or Next.js.'),
          vue: cell('library', 'Vue Router, or Nuxt.'),
          svelte: cell('library', 'SvelteKit.'),
        },
      },
      {
        feature: 'Data fetching and caching',
        cells: {
          tessera: cell('built', 'get and post: cached, shared, retried and cancelled.'),
          react: cell('library', 'TanStack Query or SWR.'),
          vue: cell('library', 'TanStack Query, or useFetch in Nuxt.'),
          svelte: cell('library', 'SvelteKit load functions, or TanStack Query.'),
        },
      },
      {
        feature: 'Checked API calls',
        note: 'A wrong path, parameter or field is caught before the app runs.',
        cells: {
          tessera: cell('built', 'From an API description, or an imported OpenAPI file.'),
          react: cell('library', 'Generated clients, or tRPC.'),
          vue: cell('library', 'Generated clients, or tRPC.'),
          svelte: cell('library', 'Generated clients, or tRPC.'),
        },
      },
      {
        feature: 'Shared state',
        cells: {
          tessera: cell('built', 'A file in app/state, read-only outside it.'),
          react: cell('library', 'Context, or Redux Toolkit, Zustand or Jotai.'),
          vue: cell('library', 'Pinia, the official store.'),
          svelte: cell('built', 'Stores, and runes in shared modules.'),
        },
      },
      {
        feature: 'Forms and validation',
        cells: {
          tessera: cell('none', 'Not yet. Two-way binding on inputs only.'),
          react: cell('library', 'React Hook Form or Formik.'),
          vue: cell('library', 'VeeValidate or FormKit.'),
          svelte: cell('partial', 'SvelteKit form actions; Superforms to validate.'),
        },
      },
      {
        feature: 'Server rendering',
        cells: {
          tessera: cell('partial', 'Prerendered static pages. No hydration yet.'),
          react: cell('library', 'Next.js or React Router.'),
          vue: cell('library', 'Nuxt.'),
          svelte: cell('library', 'SvelteKit.'),
        },
      },
      {
        feature: 'Server code',
        cells: {
          tessera: cell('none', 'No. It is frontend only, by design.'),
          react: cell('library', 'Server Components with Next.js.'),
          vue: cell('library', 'Nuxt server routes.'),
          svelte: cell('library', 'SvelteKit endpoints.'),
        },
      },
      {
        feature: 'Translations',
        cells: {
          tessera: cell('none', 'Not yet.'),
          react: cell('library', 'react-i18next or FormatJS.'),
          vue: cell('library', 'Vue I18n, the official library.'),
          svelte: cell('library', 'Paraglide or svelte-i18n.'),
        },
      },
      {
        feature: 'Animation',
        cells: {
          tessera: cell('none', 'Motion tokens only. No enter or leave animation.'),
          react: cell('partial', 'View Transitions; Motion for the rest.'),
          vue: cell('built', 'Transition and TransitionGroup.'),
          svelte: cell('built', 'transition: and animate: directives.'),
        },
      },
    ],
  },
  {
    title: 'Styling and design systems',
    rows: [
      {
        feature: 'Scoped styles',
        cells: {
          tessera: cell('built', 'Classes are scoped to the component.'),
          react: cell('library', 'CSS Modules, Tailwind or CSS-in-JS.'),
          vue: cell('built', 'Scoped style blocks.'),
          svelte: cell('built', 'Styles are scoped by default.'),
        },
      },
      {
        feature: 'Design tokens',
        cells: {
          tessera: cell('built', 'Token files, themes and aliases, read by the compiler.'),
          react: cell('library', 'Style Dictionary, Tailwind or your own CSS variables.'),
          vue: cell('library', 'Style Dictionary, Tailwind or your own CSS variables.'),
          svelte: cell('library', 'Style Dictionary, Tailwind or your own CSS variables.'),
        },
      },
      {
        feature: 'Off-system values rejected',
        note: 'padding: 13px is an error, with the nearest token suggested.',
        cells: {
          tessera: cell('built', 'Checked by the compiler, in every style block.'),
          react: cell('library', 'Stylelint rules can approximate it.'),
          vue: cell('library', 'Stylelint rules can approximate it.'),
          svelte: cell('library', 'Stylelint rules can approximate it.'),
        },
      },
      {
        feature: 'Component variants and contracts',
        cells: {
          tessera: cell('built', 'Variants, parts, slots and events declared once, and checked.'),
          react: cell('library', 'Variant helpers such as CVA, or by hand.'),
          vue: cell('library', 'Variant helpers such as CVA, or by hand.'),
          svelte: cell('library', 'Variant helpers such as CVA, or by hand.'),
        },
      },
      {
        feature: 'Light and dark themes',
        cells: {
          tessera: cell('built', 'Theme files override tokens; one call switches.'),
          react: cell('library', 'CSS variables, a theme library or Tailwind.'),
          vue: cell('library', 'CSS variables, a theme library or Tailwind.'),
          svelte: cell('library', 'CSS variables, a theme library or Tailwind.'),
        },
      },
      {
        feature: 'Custom elements',
        note: 'Use your components in any framework.',
        cells: {
          tessera: cell(
            'built',
            'The design system builds as custom elements, with React wrappers.',
          ),
          react: cell('partial', 'Uses custom elements; does not build them.'),
          vue: cell('built', 'defineCustomElement.'),
          svelte: cell('built', 'The customElement option.'),
        },
      },
    ],
  },
  {
    title: 'Quality and accessibility',
    rows: [
      {
        feature: 'Accessibility tests',
        cells: {
          tessera: cell(
            'built',
            'Generated from the contract: every variant and state, per theme.',
          ),
          react: cell('library', 'Testing Library and axe-core, written by hand.'),
          vue: cell('library', 'Testing Library and axe-core, written by hand.'),
          svelte: cell('library', 'Testing Library and axe-core, written by hand.'),
        },
      },
      {
        feature: 'Contrast checked at compile time',
        cells: {
          tessera: cell('built', 'Text against its background, in each theme.'),
          react: cell('none', 'Not built in.'),
          vue: cell('none', 'Not built in.'),
          svelte: cell('partial', 'The compiler warns about some accessibility mistakes.'),
        },
      },
      {
        feature: 'Testing your components',
        cells: {
          tessera: cell('partial', 'Vitest in a real browser. No mount helper for apps yet.'),
          react: cell('library', 'Testing Library with Vitest or Jest.'),
          vue: cell('built', 'Vue Test Utils, the official library.'),
          svelte: cell('library', 'Testing Library with Vitest.'),
        },
      },
      {
        feature: 'Browser dev tools',
        cells: {
          tessera: cell('none', 'Not yet.'),
          react: cell('built', 'React DevTools.'),
          vue: cell('built', 'Vue DevTools.'),
          svelte: cell('built', 'Svelte DevTools.'),
        },
      },
    ],
  },
  {
    title: 'Tooling and AI',
    rows: [
      {
        feature: 'Dev server with hot updates',
        cells: {
          tessera: cell('built', 'Vite underneath, with no config file to write.'),
          react: cell('library', 'Vite, or a framework such as Next.js.'),
          vue: cell('built', 'Vite, through create-vue.'),
          svelte: cell('built', 'Vite, through SvelteKit.'),
        },
      },
      {
        feature: 'Editor support',
        cells: {
          tessera: cell(
            'partial',
            'A VS Code extension, run from the repository. Not published yet.',
          ),
          react: cell('built', 'TypeScript understands JSX in any editor.'),
          vue: cell('built', 'The official Vue extension.'),
          svelte: cell('built', 'The official Svelte extension.'),
        },
      },
      {
        feature: 'Ready for AI coding tools',
        note: 'A new project explains itself to a model.',
        cells: {
          tessera: cell(
            'built',
            'AGENTS.md, an MCP server and the docs, offline, in every new project.',
          ),
          react: cell('library', 'Rule files and MCP servers you add yourself.'),
          vue: cell('library', 'Rule files and MCP servers you add yourself.'),
          svelte: cell('library', 'Rule files and MCP servers you add yourself.'),
        },
      },
    ],
  },
  {
    title: 'Ecosystem',
    rows: [
      {
        feature: 'Libraries, tutorials and people who know it',
        cells: {
          tessera: cell('none', 'New. You will write some things yourself.'),
          react: cell('built', 'The largest ecosystem.'),
          vue: cell('built', 'A large, well-documented ecosystem.'),
          svelte: cell('built', 'A smaller ecosystem that is growing.'),
        },
      },
    ],
  },
]

/** What Tessera does not try to be, said plainly. */
export const NOT_ITS_GOAL: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'A meta-framework',
    body: 'Tessera is frontend only. There is no server code, no server rendering with hydration and no nested routes yet, and it will not grow into Next.js, Nuxt or SvelteKit.',
  },
  {
    title: 'A big ecosystem',
    body: 'It is new. It works with any library you can import, but there is no library of Tessera-specific add-ons, and fewer people to ask.',
  },
  {
    title: 'For every team',
    body: 'It is for teams that have, or want, a design system, and want the compiler to hold the app to it, with accessibility and AI tools included.',
  },
]
