/** The words of the page that are lists of the same thing. */

export interface Item {
  title: string
  body: string
  cmd?: string
}

export const FEATURES: Item[] = [
  {
    title: 'The contract is the component',
    body: 'Anatomy, variants, states and accessibility, declared once and checked at every use.',
  },
  {
    title: 'Styles come from tokens',
    body: 'An off-scale value is a build error with the nearest token suggested.',
  },
  {
    title: 'A way in for existing code',
    body: 'A baseline lets an existing app turn enforcement on with zero errors.',
  },
  {
    title: 'Changes you can see coming',
    body: 'tessera diff says which changes break people. tessera codemod applies renames.',
  },
  {
    title: 'Accessibility you can run',
    body: 'tessera a11y generates axe-core tests from each contract, for every variant, state and theme.',
  },
  {
    title: 'Light to write',
    body: 'Single-file components, signals, auto-imports, file-based routing.',
  },
]

export const DOC_ITEMS: Item[] = [
  {
    title: 'A page for every component',
    body: 'A live preview with a control for each variant, the parts you may style, states, slots, events, contrast pairs, tokens used and accessibility coverage.',
  },
  {
    title: 'A page for every token group',
    body: 'Each token in every theme and density, with swatches and the alias it came from. A Contrast page checks text on surfaces.',
  },
  {
    title: 'Styled by your tokens',
    body: 'The docs read your semantic tokens for surfaces, text, borders, buttons, font and radius. Change color.surface.default and both the app and the docs change.',
  },
  {
    title: 'Tokens in and out',
    body: 'An Export page gives DTCG or Tokens Studio files. With --edit, Bring in tokens previews an import as a diff, checked by the compiler, before it is saved.',
  },
  {
    title: 'Coverage overview',
    body: 'The same numbers as tessera report: contract coverage, token usage, raw() escapes, baseline debt and deprecated uses.',
  },
  {
    title: 'Prose and live examples',
    body: 'A Name.docs.md beside a component adds guidance. tess live blocks run with your real components.',
  },
]

export const AGENT_ITEMS: Item[] = [
  {
    title: 'Manifest',
    body: 'Every component, token, route and rule in one file.',
    cmd: 'npx tessera manifest',
  },
  {
    title: 'MCP server',
    body: 'Find components, resolve raw values to tokens, validate snippets.',
    cmd: 'npx tessera mcp',
  },
  {
    title: 'AGENTS.md and llms.txt',
    body: 'Generated for tools that cannot run an MCP server.',
    cmd: 'npx tessera agent-files',
  },
]
