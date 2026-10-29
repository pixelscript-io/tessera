import { defineConfig } from 'vitepress'

const guide = [
  { text: 'Reactivity', link: '/guide/reactivity' },
  { text: 'Tokens', link: '/guide/tokens' },
  { text: 'Contracts', link: '/guide/contracts' },
  { text: 'Components and templates', link: '/guide/components' },
  { text: 'Auto-imports', link: '/guide/auto-imports' },
  { text: 'Styles and enforcement', link: '/guide/styles' },
  { text: 'Behaviors and accessibility tests', link: '/guide/behaviors' },
  { text: 'Pages and routing', link: '/guide/pages-and-routing' },
  { text: 'Layouts', link: '/guide/layouts' },
  { text: 'Testing', link: '/guide/testing' },
  { text: 'Tessera UI', link: '/guide/tessera-ui' },
  { text: 'Starter presets', link: '/guide/presets' },
  { text: 'The command line', link: '/guide/cli' },
  { text: 'Every command', link: '/guide/commands' },
  { text: 'Importing and exporting tokens', link: '/guide/interchange' },
  { text: 'Importing a component from Figma', link: '/guide/figma' },
  { text: 'The design system docs', link: '/guide/docs-app' },
  { text: 'Custom elements and React', link: '/guide/elements' },
  { text: 'Linting any project', link: '/guide/lint' },
  { text: 'Fetching data', link: '/guide/data' },
  { text: 'Sharing state', link: '/guide/shared-state' },
  { text: 'Security', link: '/guide/security' },
  { text: 'Tokens in the docs', link: '/guide/system-manager' },
  { text: 'Editor support', link: '/guide/editor' },
  { text: 'AI coding tools', link: '/guide/agents' },
]

const designSystems = [
  { text: 'Overview', link: '/guide/design-systems/' },
  { text: 'Token architecture', link: '/guide/design-systems/token-architecture' },
  { text: 'Theming and brands', link: '/guide/design-systems/theming' },
  { text: 'Enforcement', link: '/guide/design-systems/enforcement' },
  { text: 'Accessibility', link: '/guide/design-systems/accessibility' },
  { text: 'Designing contracts', link: '/guide/design-systems/contracts' },
  { text: 'Extending and ejecting', link: '/guide/design-systems/extending' },
  { text: 'Versioning and deprecation', link: '/guide/design-systems/versioning' },
]

export default defineConfig({
  title: 'Tessera',
  description: 'A design-system-first frontend framework',
  cleanUrls: true,
  lastUpdated: false,
  // The default GitHub code themes have colors under 4.5:1 on the surfaces the site uses; these are the high-contrast pair.
  markdown: { theme: { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' } },
  head: [
    ['link', { rel: 'icon', href: 'data:,' }],
    // Apply the dark Tessera theme before first paint, as VitePress does for its own dark class.
    [
      'script',
      {},
      "(()=>{try{var a=localStorage.getItem('vitepress-theme-appearance')||'auto';if(a==='dark'||(a==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark')}catch(e){}})()",
    ],
  ],
  async buildEnd(siteConfig) {
    const { writeMachineReadable } = await import('./machine-readable')
    writeMachineReadable(siteConfig.srcDir, siteConfig.outDir)
  },
  themeConfig: {
    search: { provider: 'local' },
    nav: [
      { text: 'Introduction', link: '/introduction/' },
      { text: 'Quick start', link: '/quick-start' },
      { text: 'Tutorial', link: '/tutorial/' },
      { text: 'Guide', link: '/guide/reactivity' },
      { text: 'How it works', link: '/how-it-works/' },
      { text: 'Reference', link: '/reference/' },
      {
        text: 'More',
        items: [
          { text: 'Cookbook', link: '/cookbook/' },
          { text: 'Migration', link: '/migration/' },
          { text: 'Examples', link: '/examples/' },
          { text: 'Releases', link: '/releases/' },
          { text: 'Community', link: '/community/' },
        ],
      },
    ],
    sidebar: {
      '/introduction/': [
        { text: 'Introduction', items: [{ text: 'What is Tessera?', link: '/introduction/' }] },
      ],
      '/tutorial/': [
        {
          text: 'Tutorial',
          items: [
            { text: 'Overview', link: '/tutorial/' },
            { text: '1. A first component', link: '/tutorial/01-first-component' },
            { text: '2. State and templates', link: '/tutorial/02-state-and-templates' },
            { text: '3. Contracts and variants', link: '/tutorial/03-contracts' },
            { text: '4. Styling with tokens', link: '/tutorial/04-styling' },
            { text: '5. Theming', link: '/tutorial/05-theming' },
            { text: '6. Pages and routing', link: '/tutorial/06-pages' },
            { text: '7. Layouts', link: '/tutorial/07-layouts' },
            { text: '8. Data from an API', link: '/tutorial/08-data' },
            { text: '9. Sharing state', link: '/tutorial/09-shared-state' },
            { text: '10. Accessibility tests', link: '/tutorial/10-accessibility' },
            { text: '11. Keeping it checked', link: '/tutorial/11-checking' },
          ],
        },
      ],
      '/guide/design-systems/': [
        { text: 'Guide: design systems', items: designSystems },
        { text: 'Guide: essentials', link: '/guide/reactivity', items: [] },
      ],
      '/guide/': [
        { text: 'Guide: essentials', items: guide },
        { text: 'Guide: design systems', link: '/guide/design-systems/', items: [] },
      ],
      '/how-it-works/': [
        {
          text: 'How it works',
          items: [
            { text: 'Overview', link: '/how-it-works/' },
            { text: 'The compile pipeline', link: '/how-it-works/compile-pipeline' },
            { text: 'The signals runtime', link: '/how-it-works/signals' },
            { text: 'The renderer adapter', link: '/how-it-works/renderer' },
            { text: 'CSS layers and scoping', link: '/how-it-works/css' },
            { text: 'Auto-import resolution', link: '/how-it-works/auto-imports' },
            { text: 'The route manifest', link: '/how-it-works/routes' },
            { text: 'Why contracts', link: '/how-it-works/why' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Overview', link: '/reference/' },
            { text: 'API', link: '/reference/api/' },
            { text: 'CLI', link: '/reference/cli' },
            { text: 'MCP server', link: '/reference/mcp' },
            { text: 'tessera.config.ts', link: '/reference/config' },
            { text: 'Contract', link: '/reference/contract' },
            { text: 'Token format', link: '/reference/tokens' },
            { text: 'Errors and warnings', link: '/reference/errors/' },
            { text: 'Template syntax', link: '/reference/template-syntax' },
            { text: 'Glossary', link: '/reference/glossary' },
          ],
        },
      ],
      '/cookbook/': [
        {
          text: 'Cookbook',
          items: [
            { text: 'Overview', link: '/cookbook/' },
            { text: 'Theme switcher', link: '/cookbook/theme-switcher' },
            { text: 'Multi-brand app', link: '/cookbook/multi-brand' },
            { text: 'Legacy codebase', link: '/cookbook/legacy-baseline' },
            { text: 'Form field', link: '/cookbook/form-field' },
            { text: 'Configuring CI', link: '/cookbook/ci' },
          ],
        },
      ],
      '/migration/': [
        {
          text: 'Migration',
          items: [
            { text: 'Overview', link: '/migration/' },
            { text: 'From Vue', link: '/migration/vue' },
            { text: 'From Svelte', link: '/migration/svelte' },
            { text: 'From React and shadcn/ui', link: '/migration/react' },
          ],
        },
      ],
      '/releases/': [
        {
          text: 'Releases',
          items: [
            { text: 'Releases', link: '/releases/' },
            { text: 'Roadmap', link: '/releases/roadmap' },
          ],
        },
      ],
      '/community/': [
        {
          text: 'Community',
          items: [
            { text: 'Overview', link: '/community/' },
            { text: 'Contributing', link: '/community/contributing' },
            { text: 'Reporting bugs', link: '/community/bugs' },
            { text: 'Governance', link: '/community/governance' },
            { text: 'Code of conduct', link: '/community/conduct' },
            { text: 'Accessibility statement', link: '/community/accessibility' },
          ],
        },
      ],
    },
  },
})
