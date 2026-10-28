import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { buildRegistry } from '../src/registry/build'
import { describeFit, fitOf, hasProblems, needsOf } from '../src/token-fit'

const ui = fileURLToPath(new URL('../../ui', import.meta.url))
const cli = fileURLToPath(new URL('..', import.meta.url))

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const sets = {
  tailwind: join(cli, 'templates', 'tailwind', 'system', 'tailwind', 'tokens'),
  unstyled: join(cli, 'templates', 'unstyled', 'system', 'unstyled', 'tokens'),
  tessera: join(ui, 'systems', 'tessera', 'tokens'),
}

const registry = buildRegistry({
  uiDir: ui,
  minTessera: '0.8.0',
  npmVersions: { lucide: '1.62.0' },
})
const needs = needsOf(registry.items.filter((i) => i.type === 'component').flatMap((i) => i.files))

describe('the token sets the registry serves', () => {
  for (const [name, dir] of Object.entries(sets)) {
    it(`${name} has every token every component uses, each of the type the components expect`, () => {
      const root = mkdtempSync(join(tmpdir(), 'tessera-set-'))
      roots.push(root)
      mkdirSync(join(root, 'system'), { recursive: true })
      cpSync(dir, join(root, 'system', 'tokens'), { recursive: true })
      const fits = fitOf(new Project(root, {}), needs)
      expect(fits).toHaveLength(1)
      expect(fits[0]!.broken, 'the tokens build').toBeUndefined()
      expect(describeFit(fits).join('\n')).toContain('has every token')
      expect(hasProblems(fits)).toBe(false)
    })
  }
})
