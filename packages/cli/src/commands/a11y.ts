import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Args } from '../args'
import type { Io } from '../io'
import { openProject } from '../project'

/** The dev dependencies the generated tests need, at the versions Tessera is tested with. */
export const A11Y_DEV_DEPENDENCIES: Readonly<Record<string, string>> = {
  '@vitest/browser': '^3.2.7',
  'axe-core': '^4.14.0',
  playwright: '^1.64.1',
  vitest: '^3.2.7',
}

const VITEST_CONFIGS = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.workspace.ts',
  'vitest.workspace.js',
]

/** The Vitest configuration that runs the generated tests in a real browser, using the project's own Tessera plugin. */
export const VITEST_CONFIG = `import { defineConfig } from 'vitest/config'
import { tessera } from '@pixelscriptio/tessera/vite'

// The generated accessibility tests run in a real browser (Vitest browser mode, with Playwright).
// Install a browser once with \`npx playwright install chromium\`, or set TESSERA_A11Y_CHANNEL=msedge (or chrome)
// to use one that is already installed.
export default defineConfig({
  plugins: [tessera()],
  // axe-core is not an ES module, so the browser needs Vite to convert it first.
  optimizeDeps: { include: ['axe-core'] },
  test: {
    include: ['{app,system}/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: 'playwright',
      instances: [
        { browser: 'chromium', launch: { channel: process.env.TESSERA_A11Y_CHANNEL || undefined } },
      ],
    },
  },
})
`

/** Components that cannot be shown without data are given some, so their tests have something to test. */
const FIXTURE_COMPONENTS = ['Combobox', 'Select']

const FIXTURES = `  // A list for the components that need one. The first two share their opening letters, which the combobox
  // tests type to narrow the list.
  fixtures: {
@COMPONENTS@
  },
`

/** The test file for one folder of components. */
export function testFile(options: { tokens: boolean; components: string[] }): string {
  const needs = FIXTURE_COMPONENTS.filter((c) => options.components.includes(c))
  const fixtures = needs.length
    ? FIXTURES.replace(
        '@COMPONENTS@',
        needs.map((c) => `    ${c}: { props: { options } },`).join('\n'),
      )
    : ''
  return [
    '/// <reference types="vite/client" />',
    ...(options.tokens ? ["import 'virtual:tessera/tokens.css'"] : []),
    "import { defineA11ySuites } from '@pixelscriptio/tessera/a11y'",
    '',
    ...(needs.length
      ? [
          'const options = [',
          "  { value: 'apple', label: 'Apple' },",
          "  { value: 'apricot', label: 'Apricot' },",
          "  { value: 'banana', label: 'Banana' },",
          "  { value: 'blueberry', label: 'Blueberry' },",
          ']',
          '',
        ]
      : []),
    '// Every component in this folder that has a contract gets accessibility tests generated from it. Adding a',
    '// component adds its tests; there is nothing to register.',
    'defineA11ySuites({',
    "  components: import.meta.glob('./*.tess', { eager: true, import: 'default' }),",
    "  sources: import.meta.glob('./*.tess', { query: '?raw', eager: true, import: 'default' }),",
    ...(fixtures ? [fixtures.trimEnd()] : []),
    '})',
    '',
  ].join('\n')
}

const FOLDERS = ['system/components', 'app/components']

/**
 * `tessera a11y`: set up the generated accessibility tests in a project. It writes a test file in each components
 * folder, a Vitest browser-mode configuration if the project has none, the dev dependencies and a script in
 * `package.json`, and says what to install. It never overwrites a file.
 */
export async function a11y(args: Args, io: Io): Promise<number> {
  const project = await openProject(io.cwd, args)
  const root = project.root
  const hasTokens = !!project.tokensDir()
  const ui = io.ui
  const wrote: string[] = []
  const left: string[] = []
  const put = (file: string, content: string) => {
    const path = join(root, file)
    if (existsSync(path)) {
      left.push(file)
      return
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    wrote.push(file)
  }

  const folders = FOLDERS.filter((f) => {
    const dir = join(root, f)
    return existsSync(dir) && readdirSync(dir).some((n) => n.endsWith('.tess'))
  })
  if (!folders.length) {
    io.out(
      ui
        ? ui.warn(
            'There are no components with a .tess file in system/components or app/components yet.',
          )
        : 'There are no components with a .tess file in system/components or app/components yet.',
    )
    return 1
  }

  for (const folder of folders) {
    const components = readdirSync(join(root, folder))
      .filter((n) => n.endsWith('.tess'))
      .map((n) => n.replace(/\.tess$/, ''))
    put(`${folder}/a11y.browser.test.ts`, testFile({ tokens: hasTokens, components }))
  }

  // Vitest: write a configuration only where there is none; otherwise say what to add.
  const configured = VITEST_CONFIGS.find((c) => existsSync(join(root, c)))
  if (!configured) put('vitest.config.ts', VITEST_CONFIG)

  // package.json: the dev dependencies that are missing, and the script.
  const manifestPath = join(root, 'package.json')
  const added: string[] = []
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, any>
    manifest.devDependencies ??= {}
    for (const [name, range] of Object.entries(A11Y_DEV_DEPENDENCIES)) {
      const have = manifest.dependencies?.[name] ?? manifest.devDependencies[name]
      if (have === undefined) {
        manifest.devDependencies[name] = range
        added.push(name)
      }
    }
    manifest.devDependencies = Object.fromEntries(
      Object.entries(manifest.devDependencies as Record<string, string>).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    )
    manifest.scripts ??= {}
    if (manifest.scripts['test:a11y'] === undefined) {
      manifest.scripts['test:a11y'] = 'vitest run'
      added.push('script "test:a11y"')
    }
    if (added.length) {
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      wrote.push(`package.json (added ${added.join(', ')})`)
    }
  }

  const next = ['npm install', 'npx playwright install chromium', 'npm run test:a11y']
  if (ui) {
    io.out(ui.ok(ui.bold('Set up the generated accessibility tests')))
    io.out('')
    for (const file of wrote) io.out(`  ${ui.green(ui.sym.ok)} ${file}`)
    for (const file of left) io.out(`  ${ui.dim(`${ui.sym.bullet} ${file} (already there)`)}`)
    io.out('')
    if (configured) {
      io.out(
        ui.warn(
          `${configured} already exists, so it was left alone. Run the tests in a browser project: add the plugin, \`include: ['{app,system}/**/*.browser.test.ts']\` and the \`browser\` block from the guide.`,
        ),
      )
      io.out('')
    }
    io.out(ui.heading('Next'))
    io.out(next.map((s, i) => `  ${ui.dim(String(i + 1))}  ${ui.bold(s)}`).join('\n'))
    io.out('')
    io.out(
      ui.dim(
        'Already have a browser installed? Set TESSERA_A11Y_CHANNEL=msedge (or chrome) and skip step 2.',
      ),
    )
    return 0
  }
  io.out('Set up the generated accessibility tests.')
  if (wrote.length) io.out(`Wrote: ${wrote.join(', ')}`)
  if (left.length) io.out(`Left alone (already there): ${left.join(', ')}`)
  if (configured) {
    io.out(
      `${configured} already exists, so it was left alone. Run the tests in a browser project: add the plugin, include: ['{app,system}/**/*.browser.test.ts'] and the browser block from the guide.`,
    )
  }
  io.out('')
  io.out('Next:')
  for (const step of next) io.out(`  ${step}`)
  io.out('')
  io.out(
    'Already have a browser installed? Set TESSERA_A11Y_CHANNEL=msedge (or chrome) and skip step 2.',
  )
  return 0
}
