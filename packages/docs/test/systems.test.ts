import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { buildDocsData } from '../src'

const cli = fileURLToPath(new URL('../../cli', import.meta.url))
const ui = fileURLToPath(new URL('../../ui', import.meta.url))

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** A project with two design systems: "full" (all the unstyled tokens) and "bare" (the same, without the effects file). */
function twoSystems(config: Record<string, unknown>): Project {
  const root = mkdtempSync(join(tmpdir(), 'tessera-docs-systems-'))
  roots.push(root)
  const tokens = join(cli, 'templates', 'unstyled', 'system', 'unstyled', 'tokens')
  cpSync(tokens, join(root, 'system', 'full', 'tokens'), { recursive: true })
  cpSync(tokens, join(root, 'system', 'bare', 'tokens'), { recursive: true })
  rmSync(join(root, 'system', 'bare', 'tokens', 'effects.tokens.json'))
  mkdirSync(join(root, 'system', 'components'), { recursive: true })
  for (const file of ['Card.tess', 'Button.tess'])
    cpSync(join(ui, 'components', file), join(root, 'system', 'components', file))
  writeFileSync(join(root, 'package.json'), '{"name":"two-systems"}')
  return new Project(root, { config })
}

const build = (project: Project) => buildDocsData(project, { liveModule: () => '' })

describe('the docs of a project with several design systems', () => {
  const project = twoSystems({
    systems: [
      { name: 'Full', path: '/full' },
      { name: 'Bare', path: '/bare' },
    ],
    defaultSystem: 'Bare',
  })
  const data = build(project)

  it('lists the systems, and says which one the app uses', () => {
    expect(data.systems?.map((s) => s.name)).toEqual(['Full', 'Bare'])
    expect(data.activeSystem).toBe('Bare')
  })

  it('carries each system’s own tokens and style sheet, so the page can switch without a server', () => {
    const [full, bare] = data.systems!
    expect(full!.tokens.entries.some((t) => t.path === 'shadow.sm')).toBe(true)
    expect(bare!.tokens.entries.some((t) => t.path === 'shadow.sm')).toBe(false)
    expect(full!.css).toContain('--t-shadow-sm')
    expect(bare!.css).not.toContain('--t-shadow-sm')
    expect(full!.hasTokens && bare!.hasTokens).toBe(true)
    expect(full!.themes.map((t) => t.name)).toEqual(['dark'])
  })

  it('shows the tokens of the active system at the top level', () => {
    expect(data.tokens.entries.some((t) => t.path === 'shadow.sm')).toBe(false)
  })

  it('names, for each system, the tokens a component uses that the system does not have', () => {
    const [full, bare] = data.systems!
    expect(full!.missing['Card']).toBeUndefined()
    expect(bare!.missing['Card']).toEqual(['shadow.sm'])
  })

  it('is the same data as before for a project with one system', () => {
    const single = build(twoSystems({ systems: [{ name: 'Full', path: '/full' }] }))
    expect(single.systems).toBeUndefined()
    expect(single.activeSystem).toBeUndefined()
  })

  it('is the same data as before for a project without a systems list', () => {
    expect(build(twoSystems({})).systems).toBeUndefined()
  })
})
