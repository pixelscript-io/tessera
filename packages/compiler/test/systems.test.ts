import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { activeSystemFolder, validateConfig } from '../src'
import { Project, systemTokensDir } from '../src/project-entry'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A project folder with token folders at the given paths (relative to the project). */
function project(...tokenFolders: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'tessera-systems-'))
  roots.push(root)
  for (const folder of tokenFolders) {
    mkdirSync(join(root, folder), { recursive: true })
    writeFileSync(join(root, folder, 'base.tokens.json'), '{}')
  }
  return root
}

const rel = (root: string, dir: string | undefined) =>
  dir?.slice(root.length + 1).replaceAll('\\', '/')

describe('activeSystemFolder', () => {
  it('is undefined when the config names no system', () => {
    expect(activeSystemFolder({})).toBeUndefined()
  })

  it('is the first system when no default is set', () => {
    expect(
      activeSystemFolder({
        systems: [
          { name: 'Tailwind', path: '/tailwind' },
          { name: 'Tessera', path: '/tessera' },
        ],
      }),
    ).toBe('tailwind')
  })

  it('finds the default system by name, ignoring case, and returns its folder', () => {
    expect(
      activeSystemFolder({
        systems: [
          { name: 'Tailwind', path: '/tailwind' },
          { name: 'Tessera', path: 'tessera-look' },
        ],
        defaultSystem: 'tessera',
      }),
    ).toBe('tessera-look')
  })

  it('uses the lower-cased name as the folder when a system has no path', () => {
    expect(activeSystemFolder({ systems: [{ name: 'Unstyled' }] })).toBe('unstyled')
  })

  it('treats a default that is not in the list as a folder name', () => {
    expect(activeSystemFolder({ defaultSystem: 'tailwind' })).toBe('tailwind')
  })
})

describe('systemTokensDir', () => {
  it('finds the tokens of the named system', () => {
    const root = project('system/tailwind/tokens', 'system/tessera/tokens')
    expect(rel(root, systemTokensDir(root, 'tessera'))).toBe('system/tessera/tokens')
  })

  it('uses the only system there is when none is named', () => {
    const root = project('system/tailwind/tokens')
    expect(rel(root, systemTokensDir(root))).toBe('system/tailwind/tokens')
  })

  it('takes the first system, by name, when several exist and none is named', () => {
    const root = project('system/tessera/tokens', 'system/tailwind/tokens')
    expect(rel(root, systemTokensDir(root))).toBe('system/tailwind/tokens')
  })

  it('still finds the earlier layout, system/tokens', () => {
    const root = project('system/tokens')
    expect(rel(root, systemTokensDir(root))).toBe('system/tokens')
    expect(rel(root, systemTokensDir(root, 'tailwind'))).toBe('system/tokens')
  })

  it('prefers a named system over the earlier layout', () => {
    const root = project('system/tokens', 'system/tailwind/tokens')
    expect(rel(root, systemTokensDir(root, 'tailwind'))).toBe('system/tailwind/tokens')
  })

  it('walks up to a parent folder, like the earlier layout always did', () => {
    const root = project('system/tailwind/tokens')
    mkdirSync(join(root, 'examples', 'app'), { recursive: true })
    expect(rel(root, systemTokensDir(join(root, 'examples', 'app')))).toBe('system/tailwind/tokens')
  })

  it('is undefined when there are none, or the named system is not there', () => {
    const root = project('system/components')
    expect(systemTokensDir(root)).toBeUndefined()
    const other = project('system/tailwind/tokens')
    expect(systemTokensDir(other, 'tessera')).toBeUndefined()
  })
})

describe('Project.tokensDir', () => {
  it('follows the config: the default system decides which tokens build', () => {
    const root = project('system/tailwind/tokens', 'system/tessera/tokens')
    const config = {
      systems: [{ name: 'Tailwind' }, { name: 'Tessera' }],
      defaultSystem: 'Tessera',
    }
    expect(rel(root, new Project(root, { config }).tokensDir())).toBe('system/tessera/tokens')
  })

  it('lets the tokens option win over the config', () => {
    const root = project('system/tailwind/tokens')
    const tokens = join(root, 'elsewhere')
    expect(new Project(root, { tokens, config: { defaultSystem: 'tailwind' } }).tokensDir()).toBe(
      tokens,
    )
  })
})

describe('validateConfig: systems', () => {
  it('accepts a list of systems with a default from it', () => {
    expect(
      validateConfig({
        systems: [
          { name: 'Tailwind', path: '/tailwind' },
          { name: 'Unstyled', path: '/unstyled' },
        ],
        defaultSystem: 'Unstyled',
      }),
    ).toEqual([])
  })

  it('reports a default that is not in the list, naming the systems there are', () => {
    const [issue, ...rest] = validateConfig({
      systems: [{ name: 'Tailwind' }],
      defaultSystem: 'Tessera',
    })
    expect(rest).toEqual([])
    expect(issue!.code).toBe('T2115')
    expect(issue!.message).toContain('"Tessera"')
    expect(issue!.message).toContain('Tailwind')
  })

  it('reports two systems with the same name, or the same folder', () => {
    const names = validateConfig({ systems: [{ name: 'A' }, { name: 'a' }] })
    expect(names.map((i) => i.code)).toEqual(['T2115'])
    const folders = validateConfig({
      systems: [
        { name: 'A', path: '/shared' },
        { name: 'B', path: 'shared' },
      ],
    })
    expect(folders.map((i) => i.code)).toEqual(['T2115'])
  })

  it('reports a path that leaves the system folder', () => {
    const issues = validateConfig({ systems: [{ name: 'A', path: '../outside' }] })
    expect(issues.map((i) => i.code)).toEqual(['T2115'])
    expect(issues[0]!.message).toContain('../outside')
  })

  it('reports a system with no name', () => {
    const issues = validateConfig({ systems: [{ name: '' }] })
    expect(issues.map((i) => i.code)).toEqual(['T2115'])
  })
})
