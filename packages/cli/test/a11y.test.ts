import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { A11Y_DEV_DEPENDENCIES, VITEST_CONFIG, testFile } from '../src/commands/a11y'
import { component, project, read, run } from './helpers'

const withPackage = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: 'mine', private: true, type: 'module', ...extra }, null, 2) + '\n'

describe('the test file it writes', () => {
  it('asks for the generated tests and imports the tokens when the project has them', () => {
    const text = testFile({ tokens: true, components: ['Button'] })
    expect(text).toContain("import 'virtual:tessera/tokens.css'")
    expect(text).toContain("import { defineA11ySuites } from '@pixelscriptio/tessera/a11y'")
    expect(text).toContain("import.meta.glob('./*.tess', { eager: true, import: 'default' })")
    expect(text).not.toContain('fixtures')
  })

  it('leaves the token import out for a project without tokens', () => {
    expect(testFile({ tokens: false, components: ['Button'] })).not.toContain('tokens.css')
  })

  it('says where a component gets its sample data: the preview in its contract, not a fixture', () => {
    const text = testFile({ tokens: true, components: ['Button', 'Combobox', 'Select'] })
    expect(text).toContain('"preview"')
    expect(text).not.toContain('fixtures')
    expect(text).not.toContain('options')
  })
})

describe('tessera a11y', () => {
  const files = () => ({
    'package.json': withPackage(),
    'app/pages/index.tess': '<template><main>Hi</main></template>\n',
    'system/components/Card.tess': component('Card'),
    'system/components/Combobox.tess': component('Combobox'),
  })

  it('writes a test file per components folder, a Vitest configuration and the dev setup', async () => {
    const dir = project({
      ...files(),
      'app/components/Note.tess': component('Note'),
    })
    const { code, out } = await run(dir, 'a11y')
    expect(code).toBe(0)
    expect(out).toContain('Set up the generated accessibility tests.')
    expect(out).toContain('npm install')
    expect(out).toContain('npx playwright install chromium')
    expect(out).toContain('npm run test:a11y')
    expect(read(dir, 'system/components/a11y.browser.test.ts')).not.toContain('fixtures')
    expect(read(dir, 'app/components/a11y.browser.test.ts')).not.toContain('fixtures')
    expect(read(dir, 'vitest.config.ts')).toBe(VITEST_CONFIG)
    expect(read(dir, 'vitest.config.ts')).toContain('provider: playwright(')
    expect(read(dir, 'vitest.config.ts')).toContain("optimizeDeps: { include: ['axe-core'] }")
    const manifest = JSON.parse(read(dir, 'package.json')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(manifest.scripts['test:a11y']).toBe('vitest run')
    expect(manifest.devDependencies).toEqual(A11Y_DEV_DEPENDENCIES)
  })

  it('keeps what the package.json already has, and does not move a dependency the project chose', async () => {
    const dir = project({
      ...files(),
      'package.json': withPackage({
        scripts: { dev: 'tessera dev' },
        devDependencies: { vitest: '^2.0.0', prettier: '^3.0.0' },
      }),
    })
    await run(dir, 'a11y')
    const manifest = JSON.parse(read(dir, 'package.json')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(manifest.scripts.dev).toBe('tessera dev')
    expect(manifest.devDependencies.vitest).toBe('^2.0.0')
    expect(manifest.devDependencies.prettier).toBe('^3.0.0')
    expect(Object.keys(manifest.devDependencies)).toEqual(
      Object.keys(manifest.devDependencies).slice().sort(),
    )
  })

  it('never overwrites a file, and a second run changes nothing', async () => {
    const dir = project(files())
    await run(dir, 'a11y')
    const before = {
      test: read(dir, 'system/components/a11y.browser.test.ts'),
      manifest: read(dir, 'package.json'),
    }
    writeFileSync(join(dir, 'system/components/a11y.browser.test.ts'), '// mine\n')
    const second = await run(dir, 'a11y')
    expect(second.out).toContain(
      'Left alone (already there): system/components/a11y.browser.test.ts',
    )
    expect(second.out).not.toContain('Wrote:')
    expect(read(dir, 'system/components/a11y.browser.test.ts')).toBe('// mine\n')
    expect(read(dir, 'package.json')).toBe(before.manifest)
    void before.test
  })

  it('leaves an existing Vitest configuration alone and says what to add to it', async () => {
    const dir = project({ ...files(), 'vitest.config.ts': 'export default {}\n' })
    const { out } = await run(dir, 'a11y')
    expect(read(dir, 'vitest.config.ts')).toBe('export default {}\n')
    expect(out).toContain('vitest.config.ts already exists, so it was left alone')
  })

  it('has nothing to set up in a project without components, and says so', async () => {
    const dir = project({
      'package.json': withPackage(),
      'app/pages/index.tess': '<template></template>\n',
    })
    mkdirSync(join(dir, 'system', 'components'), { recursive: true })
    const { code, out } = await run(dir, 'a11y')
    expect(code).toBe(1)
    expect(out).toContain('There are no components with a .tess file')
    expect(existsSync(join(dir, 'vitest.config.ts'))).toBe(false)
  })

  it('works in a project with no package.json, writing only the test files', async () => {
    const dir = project({
      'system/components/Card.tess': component('Card'),
      'app/pages/index.tess': '<template><main>Hi</main></template>\n',
    })
    const { code } = await run(dir, 'a11y')
    expect(code).toBe(0)
    expect(existsSync(join(dir, 'package.json'))).toBe(false)
    expect(existsSync(join(dir, 'system/components/a11y.browser.test.ts'))).toBe(true)
  })
})

describe('the setup, in the preset projects', () => {
  it('is the same call the repository runs on its own components', () => {
    const own = readFileSync(
      new URL('../../../packages/ui/components/a11y.browser.test.ts', import.meta.url),
      'utf8',
    )
    const generated = testFile({ tokens: true, components: ['Combobox', 'Select'] })
    for (const line of [
      'defineA11ySuites({',
      "components: import.meta.glob('./*.tess', { eager: true, import: 'default' }),",
      "sources: import.meta.glob('./*.tess', { query: '?raw', eager: true, import: 'default' }),",
    ]) {
      expect(own, line).toContain(line)
      expect(generated, line).toContain(line)
    }
  })
})
