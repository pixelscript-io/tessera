export interface IoNode {
  id: string
  side: 'in' | 'out'
  label: string
  cmd: string
  points: string[]
}

export const IO_NODES: IoNode[] = [
  {
    id: 'dtcg',
    side: 'in',
    label: 'DTCG files',
    cmd: 'npx tessera tokens import tokens.json',
    points: [
      'Plain W3C DTCG token files.',
      'The result is built first; with errors, nothing is written.',
      'Never overwrites. Use --out or --force.',
    ],
  },
  {
    id: 'resolver',
    side: 'in',
    label: 'Resolver document',
    cmd: 'npx tessera tokens import tokens.resolver.json',
    points: [
      'Each set becomes a base file of its own.',
      'The default context is the base; other contexts become themes.',
      'The modifier name becomes the theme attribute.',
    ],
  },
  {
    id: 'ts',
    side: 'in',
    label: 'Tokens Studio',
    cmd: 'npx tessera tokens import path/to/export \\\n  --out system/tokens',
    points: [
      'Types and string values are mapped to strict DTCG.',
      'References are kept, including the older $spacing.base form.',
      'Or use Bring in tokens in tessera docs --edit, with a diff preview.',
    ],
  },
  {
    id: 'penpot',
    side: 'in',
    label: 'Penpot',
    cmd: 'npx tessera tokens import path/to/penpot-export',
    points: [
      'Penpot writes the same shape as Tokens Studio.',
      'Types and values are mapped to strict DTCG.',
      'Themes come from $themes.',
    ],
  },
  {
    id: 'figma',
    side: 'in',
    label: 'Figma variables',
    cmd: '# export with a plugin, then\nnpx tessera tokens import path/to/figma-export',
    points: [
      'Collections become token groups.',
      'Modes become themes, like data-theme="dark".',
      'Aliases are never flattened.',
    ],
  },
  {
    id: 'css',
    side: 'out',
    label: 'CSS custom properties',
    cmd: '@layer tessera.tokens {\n  --t-color-action-primary-bg: var(--t-color-blue-600);\n}',
    points: [
      'What the compiler writes for the browser.',
      'Aliases stay as var() references.',
      'Themes switch by data attribute.',
    ],
  },
  {
    id: 'dtcg-out',
    side: 'out',
    label: 'DTCG + Resolver',
    cmd: 'npx tessera tokens export',
    points: [
      'Strict DTCG 2025.10 files and a Resolver document.',
      'One modifier per attribute, a context per theme.',
      'Skipped tokens from an import are put back.',
    ],
  },
  {
    id: 'ts-out',
    side: 'out',
    label: 'Tokens Studio / Penpot',
    cmd: 'npx tessera tokens export \\\n  --format tokens-studio --out tokens',
    points: [
      'One file per set, $themes.json and $metadata.json.',
      'The plugin reads it back into Figma variables.',
      'Also on the docs Export page, as a zip.',
    ],
  },
  {
    id: 'manifest',
    side: 'out',
    label: 'Manifest for AI tools',
    cmd: 'npx tessera manifest',
    points: [
      'Each token with its tier, description and value in every theme.',
      'Read by the MCP server and AGENTS.md.',
      'The same data drives the generated token docs.',
    ],
  },
]
