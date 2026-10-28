import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canStripTypes, importsNatively, loadConfigFile } from '../src/config-file'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tessera-config-'))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

describe('loading tessera.config.ts', () => {
  it('loads a TypeScript config with types in it, and separates the project options', async () => {
    const root = project({
      'tessera.config.ts': `import type { TesseraConfig } from '@tessera/compiler'
const rules: TesseraConfig['severity'] = [{ files: 'app/legacy/**', rules: '*', level: 'warn', reason: 'old', expires: '2027-01-01' }]
export default { severity: rules, contracts: 'optional' as const, tokens: 'system/tokens' } satisfies Record<string, unknown>
`,
    })
    const loaded = await loadConfigFile(root)
    expect(loaded!.options.contracts).toBe('optional')
    expect(loaded!.options.tokens).toBe(join(root, 'system', 'tokens'))
    expect(loaded!.config.severity).toHaveLength(1)
  })

  it('loads a config that uses an enum, which type stripping alone cannot read', async () => {
    const root = project({
      'tessera.config.ts': `enum Level { Warn = 'warn' }
export default { severity: [{ files: 'a/**', rules: '*', level: Level.Warn, reason: 'r', expires: '2027-01-01' }] }
`,
    })
    const loaded = await loadConfigFile(root)
    expect(loaded!.config.severity![0]!.level).toBe('warn')
  })

  it('loads a config that imports a type without the type keyword, as esbuild does', async () => {
    const root = project({
      'types.ts': 'export interface Mine { a: number }\n',
      'tessera.config.ts': `import { Mine } from './types'
const mine: Mine = { a: 1 }
export default { today: String(mine.a) }
`,
    })
    const loaded = await loadConfigFile(root)
    expect(loaded!.options.today).toBe('1')
  })

  it('loads a config next to a file it imports', async () => {
    const root = project({
      'shared.ts': "export const reason = 'because'\n",
      'tessera.config.ts': `import { reason } from './shared.ts'
export default { severity: [{ files: 'a/**', rules: '*', level: 'warn', reason, expires: '2027-01-01' }] }
`,
    })
    expect((await loadConfigFile(root))!.config.severity![0]!.reason).toBe('because')
  })

  it('loads .mjs and .js configs, and finds none when there is none', async () => {
    expect(
      (await loadConfigFile(
        project({ 'tessera.config.mjs': 'export default { today: "2026-01-01" }\n' }),
      ))!.options.today,
    ).toBe('2026-01-01')
    expect(await loadConfigFile(project({ 'app/x.txt': '' }))).toBeUndefined()
  })

  it('does not throw away an error in the config: it is the config’s error to show', async () => {
    const root = project({
      'tessera.config.ts': "throw new Error('my own mistake')\nexport default {}\n",
    })
    await expect(loadConfigFile(root)).rejects.toThrow('my own mistake')
  })

  it('leaves nothing behind in the project', async () => {
    const root = project({ 'tessera.config.ts': 'export default {}\n' })
    await loadConfigFile(root)
    const left = existsSync(join(root, '.tessera')) ? readdirSync(join(root, '.tessera')) : []
    expect(left.filter((f) => f.startsWith('config.'))).toEqual([])
  })
})

describe('a package that is not "type": "module"', () => {
  it('loads the same config twice in a row, which Node itself cannot do for a TypeScript file there', async () => {
    const root = project({
      'package.json': '{ "name": "my-app", "version": "0.0.1" }\n',
      'tessera.config.ts': 'export default { today: "2026-02-03" }\n',
    })
    expect((await loadConfigFile(root))!.options.today).toBe('2026-02-03')
    expect((await loadConfigFile(root))!.options.today).toBe('2026-02-03')
  })

  it('is imported by Node itself only when the nearest package.json says "type": "module"', () => {
    const typed = project({ 'package.json': '{ "type": "module" }\n', 'a/b.ts': '' })
    const untyped = project({ 'package.json': '{ "name": "x" }\n', 'a/b.ts': '' })
    const nested = project({
      'package.json': '{ "type": "module" }\n',
      'a/package.json': '{}\n',
      'a/b.ts': '',
    })
    const none = project({ 'a/b.ts': '' })
    expect(importsNatively(join(typed, 'a', 'b.ts'))).toBe(true)
    expect(importsNatively(join(untyped, 'a', 'b.ts'))).toBe(false)
    expect(importsNatively(join(nested, 'a', 'b.ts'))).toBe(false)
    expect(importsNatively(join(none, 'a', 'b.ts'))).toBe(false)
  })
})

describe('when Node can run TypeScript itself', () => {
  const can = (version: string, typescript: unknown) =>
    canStripTypes({ node: version }, { typescript })

  it('is true from the versions where it is on by default and no longer warns', () => {
    expect(can('24.3.0', 'strip')).toBe(true)
    expect(can('24.22.0', 'strip')).toBe(true)
    expect(can('25.0.0', 'strip')).toBe(true)
    expect(can('22.18.0', 'strip')).toBe(true)
    expect(can('26.1.0', 'transform')).toBe(true)
  })

  it('is false for older versions, and when type stripping is off', () => {
    expect(can('20.19.0', false)).toBe(false)
    expect(can('22.12.0', 'strip')).toBe(false)
    expect(can('22.17.9', 'strip')).toBe(false)
    expect(can('24.2.0', 'strip')).toBe(false)
    expect(can('24.22.0', false)).toBe(false)
    expect(can('24.22.0', undefined)).toBe(false)
  })
})
