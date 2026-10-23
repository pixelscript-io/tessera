import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTokens } from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import { project, read, run, write } from './helpers'

const files = () => ({
  'app/pages/index.tess': '<template><main>Hi</main></template>\n',
  'system/tokens/base.tokens.json': JSON.stringify({
    color: {
      $type: 'color',
      bg: { $value: { colorSpace: 'srgb', components: [1, 1, 1] } },
    },
    space: {
      $type: 'dimension',
      '4': { $value: { value: 16, unit: 'px' } },
    },
  }),
  'system/tokens/themes/dark.tokens.json': JSON.stringify({
    $extends: 'base',
    color: { bg: { $value: { colorSpace: 'srgb', components: [0, 0, 0] } } },
  }),
})

describe('tessera tokens export', () => {
  it('writes DTCG with a Resolver document into .tessera/export/dtcg by default', async () => {
    const root = project(files(), 'tokens: "system/tokens"')
    const { code, out } = await run(root, 'tokens', 'export')
    expect(code).toBe(0)
    expect(out).toContain('Exported 3 files as DTCG 2025.10 with a Resolver document')
    const resolver = JSON.parse(read(root, '.tessera/export/dtcg/tessera.resolver.json'))
    expect(Object.keys(resolver.modifiers)).toEqual(['theme'])
    expect(existsSync(join(root, '.tessera/export/dtcg/sets/base.tokens.json'))).toBe(true)
  })

  it('writes Tokens Studio sets with --format', async () => {
    const root = project(files(), 'tokens: "system/tokens"')
    const { code } = await run(root, 'tokens', 'export', '--format', 'tokens-studio', '--out', 'ts')
    expect(code).toBe(0)
    expect(JSON.parse(read(root, 'ts/$themes.json'))[0].name).toBe('dark')
    expect(JSON.parse(read(root, 'ts/base.json')).space['4'].$value).toBe('16px')
  })

  it('refuses a format it does not know', async () => {
    const root = project(files(), 'tokens: "system/tokens"')
    const { code, err } = await run(root, 'tokens', 'export', '--format', 'figma')
    expect(code).toBe(1)
    expect(err).toContain('Unknown format "figma".')
    expect(err).toContain('Formats: dtcg, tokens-studio.')
  })
})

describe('tessera tokens import', () => {
  it('round-trips an export into a new folder, reading the files the Resolver names', async () => {
    const root = project(files(), 'tokens: "system/tokens"')
    await run(root, 'tokens', 'export', '--out', 'out')
    const { code, out } = await run(
      root,
      'tokens',
      'import',
      'out/tessera.resolver.json',
      '--out',
      'back',
    )
    expect(code).toBe(0)
    expect(out).toContain('Imported 1 token file and 1 theme into back.')
    const built = buildTokens(loadTokenDir(join(root, 'back')))
    expect(built.ok).toBe(true)
    const bg = built.manifest!.tokens.find((t) => t.path === 'color.bg')!
    expect(bg.values['base']!.css).toBe('#ffffff')
    expect(bg.values['theme=dark']!.css).toBe('#000000')
  })

  it('imports a Tokens Studio file, reports what it skipped, and writes into system/tokens', async () => {
    const root = project({ 'app/pages/index.tess': '<template><main>Hi</main></template>\n' })
    write(
      root,
      'ts.json',
      JSON.stringify({
        global: {
          gap: { value: '8', type: 'spacing' },
          heading: { value: { fontSize: '24' }, type: 'typography' },
        },
        $metadata: { tokenSetOrder: ['global'] },
      }),
    )
    const { code, out } = await run(root, 'tokens', 'import', 'ts.json', '--out', 'system/tokens')
    expect(code).toBe(0)
    expect(out).toContain('WARNING  T1016')
    expect(out).toContain('The type "typography" is not supported.')
    expect(out).toContain(
      'Imported 1 token file and 0 themes into system/tokens, with 2 notes above.',
    )
    expect(JSON.parse(read(root, 'system/tokens/base.tokens.json')).gap.$value).toEqual({
      value: 8,
      unit: 'px',
    })
  })

  it('never overwrites, and --force does', async () => {
    const root = project(files(), 'tokens: "system/tokens"')
    await run(root, 'tokens', 'export', '--out', 'out')
    const refused = await run(root, 'tokens', 'import', 'out', '--out', 'system/tokens')
    expect(refused.code).toBe(1)
    expect(refused.err).toContain('already exist')
    expect(refused.err).toContain('--force')
    const forced = await run(root, 'tokens', 'import', 'out', '--out', 'system/tokens', '--force')
    expect(forced.code).toBe(0)
  })

  it('writes nothing when the import has errors, and says why', async () => {
    const root = project({ 'app/pages/index.tess': '<template><main>Hi</main></template>\n' })
    write(root, 'bad.json', '{ nope')
    const { code, err } = await run(root, 'tokens', 'import', 'bad.json', '--out', 'x')
    expect(code).toBe(1)
    expect(err).toContain('ERROR  T1001')
    expect(err).toContain('Nothing was written: the import has 1 error.')
    expect(existsSync(join(root, 'x'))).toBe(false)
  })

  it('says what to do with no file, and when the file is missing', async () => {
    const root = project(files(), 'tokens: "system/tokens"')
    expect((await run(root, 'tokens', 'import')).err).toContain(
      'Say which file or folder to import.',
    )
    expect((await run(root, 'tokens', 'import', 'gone.json')).err).toContain(
      'There is no file or folder "gone.json".',
    )
  })
})
