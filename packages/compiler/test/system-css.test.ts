import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { tessera } from '../src/vite'

const root = mkdtempSync(join(tmpdir(), 'tessera-system-css-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const tokens = (space: number) =>
  JSON.stringify({
    space: { '4': { $type: 'dimension', $value: { value: space, unit: 'px' } } },
  })
for (const [folder, space] of [
  ['one', 4],
  ['two', 8],
] as const) {
  mkdirSync(join(root, 'system', folder, 'tokens'), { recursive: true })
  writeFileSync(join(root, 'system', folder, 'tokens', 'space.tokens.json'), tokens(space))
}

const plugin = tessera({
  config: {
    systems: [
      { name: 'One', path: '/one' },
      { name: 'Two', path: '/two' },
    ],
    defaultSystem: 'One',
  },
})
const ready = (plugin.configResolved as (c: unknown) => unknown)({ root, command: 'build' })
const resolve = (id: string) => (plugin.resolveId as (id: string) => string | null)(id)
const load = async (id: string) => {
  await ready
  return (await (plugin.load as (this: unknown, id: string) => unknown).call(
    {
      addWatchFile() {},
      error: (m: string) => {
        throw new Error(m)
      },
    },
    id,
  )) as string
}

describe('the token style sheet of one design system', () => {
  it('is the active system’s when no system is named', async () => {
    expect(await load(resolve('virtual:tessera/tokens.css')!)).toContain('--t-space-4: 4px;')
  })

  it('is the named system’s with ?system=, whatever the active one is', async () => {
    const id = resolve('virtual:tessera/tokens.css?system=Two&inline')
    expect(id).toBe('\0virtual:tessera/tokens.css?system=Two&inline')
    const css = await load(id!)
    expect(css).toContain('--t-space-4: 8px;')
    expect(css).not.toContain('4px')
  })

  it('finds the system by name without regard to case', async () => {
    expect(await load(resolve('virtual:tessera/tokens.css?system=two')!)).toContain('8px')
  })

  it('names the systems there are when the name is wrong', async () => {
    await expect(load(resolve('virtual:tessera/tokens.css?system=Three')!)).rejects.toThrow(
      /Three.*One, Two/s,
    )
  })
})
