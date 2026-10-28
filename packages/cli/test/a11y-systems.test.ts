import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { testFile } from '../src/commands/a11y'
import { component, project, read, run } from './helpers'

const two = `systems: [{ name: 'Tailwind', path: '/tailwind' }, { name: 'Unstyled', path: '/unstyled' }]`
const tokens = '{"space":{"4":{"$value":{"value":1,"unit":"rem"}}}}'
const files = () => ({
  'package.json': JSON.stringify({ name: 'mine', private: true, type: 'module' }, null, 2) + '\n',
  'app/pages/index.tess': '<template><main>Hi</main></template>\n',
  'system/components/Card.tess': component('Card'),
  'system/tailwind/tokens/space.tokens.json': tokens,
  'system/unstyled/tokens/space.tokens.json': tokens,
})
const testPath = 'system/components/a11y.browser.test.ts'

describe('the accessibility tests across design systems', () => {
  it('imports each system’s style sheet and gives them to the suites', () => {
    const text = testFile({ tokens: true, components: ['Card'], systems: ['Tailwind', 'Unstyled'] })
    expect(text).toContain(
      "import system0 from 'virtual:tessera/tokens.css?system=Tailwind&inline'",
    )
    expect(text).toContain(
      "import system1 from 'virtual:tessera/tokens.css?system=Unstyled&inline'",
    )
    expect(text).toContain('systems: { "Tailwind": system0, "Unstyled": system1 }')
    // The page does not also load the active system's sheet, which would leak into the other's run.
    expect(text).not.toContain("import 'virtual:tessera/tokens.css'")
  })

  it('writes the same file as before without --system', async () => {
    const dir = project(files(), two)
    await run(dir, 'a11y')
    const text = read(dir, testPath)
    expect(text).toContain("import 'virtual:tessera/tokens.css'")
    expect(text).not.toContain('systems:')
  })

  it('runs in every system with --system all', async () => {
    const dir = project(files(), two)
    const { code } = await run(dir, 'a11y', '--system', 'all')
    expect(code).toBe(0)
    const text = read(dir, testPath)
    expect(text).toContain('tokens.css?system=Tailwind&inline')
    expect(text).toContain('tokens.css?system=Unstyled&inline')
  })

  it('runs in one system by name, without regard to case', async () => {
    const dir = project(files(), two)
    await run(dir, 'a11y', '--system', 'unstyled')
    const text = read(dir, testPath)
    expect(text).toContain('?system=Unstyled&inline')
    expect(text).not.toContain('?system=Tailwind')
  })

  it('names the systems there are when the name is wrong, and writes nothing', async () => {
    const dir = project(files(), two)
    const { code, err } = await run(dir, 'a11y', '--system', 'Material')
    expect(code).not.toBe(0)
    expect(err).toContain('Tailwind, Unstyled')
    expect(existsSync(join(dir, testPath))).toBe(false)
  })

  it('says so when the project lists no systems', async () => {
    const dir = project(files())
    const { code, err } = await run(dir, 'a11y', '--system', 'all')
    expect(code).not.toBe(0)
    expect(err).toContain('systems')
  })

  it('says a test file that is already there was left alone, and how to change it', async () => {
    const dir = project(files(), two)
    await run(dir, 'a11y')
    const { out } = await run(dir, 'a11y', '--system', 'all')
    expect(out).toContain('delete it and run this again')
  })
})
