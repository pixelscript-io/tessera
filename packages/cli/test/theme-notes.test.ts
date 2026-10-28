import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { themeOverrideNotes } from '../src/theme-notes'

// A token a theme sets for itself does not follow the base: change the base and the theme still shows the old value.
// This is what `tessera dev` says when that happens, so it is not found out by looking at the dark docs.
const cli = fileURLToPath(new URL('..', import.meta.url))
const tailwind = join(cli, 'templates', 'tailwind', 'system', 'tailwind', 'tokens')

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'tessera-notes-'))
  roots.push(root)
  mkdirSync(join(root, 'system'), { recursive: true })
  cpSync(tailwind, join(root, 'system', 'tokens'), { recursive: true })
  return root
}
const manifest = (root: string) => {
  const result = new Project(root, {}).tokens()
  if (!result?.ok) throw new Error('the tokens build')
  return result.manifest
}
const edit = (root: string, file: string, from: string, to: string) => {
  const path = join(root, 'system', 'tokens', file)
  const text = readFileSync(path, 'utf8')
  expect(text).toContain(from)
  writeFileSync(path, text.replace(from, to))
}
const PRIMARY = /("primary": \{\s*"bg": \{\s*"\$value": ")\{color\.indigo\.600\}/
const change = (root: string, file: string) => {
  const path = join(root, 'system', 'tokens', file)
  const text = readFileSync(path, 'utf8')
  expect(PRIMARY.test(text)).toBe(true)
  writeFileSync(path, text.replace(PRIMARY, '$1{color.blue.600}'))
}

describe('a token changed in the base that a theme sets for itself', () => {
  it('is named, with the theme, its file and what the theme still shows', () => {
    const root = project()
    const before = manifest(root)
    change(root, 'semantic.tokens.json')
    const notes = themeOverrideNotes(before, manifest(root), root)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('color.action.primary.bg')
    expect(notes[0]).toContain('dark theme')
    expect(notes[0]).toContain('in system/tokens/themes/dark.tokens.json,')
    expect(notes[0]).toContain('color.indigo.600')
    expect(notes[0]).toContain('Change it there too')
  })

  it('is not named when the theme changed with it', () => {
    const root = project()
    const before = manifest(root)
    change(root, 'semantic.tokens.json')
    change(root, join('themes', 'dark.tokens.json'))
    expect(themeOverrideNotes(before, manifest(root), root)).toEqual([])
  })

  it('is not named when only the theme changed, or nothing did', () => {
    const root = project()
    const before = manifest(root)
    expect(themeOverrideNotes(before, manifest(root), root)).toEqual([])
    change(root, join('themes', 'dark.tokens.json'))
    expect(themeOverrideNotes(before, manifest(root), root)).toEqual([])
  })

  it('is not named when the theme does not set the token: it follows the base', () => {
    const root = project()
    const before = manifest(root)
    // A primitive of the palette, which no theme overrides, and which the base tokens alias.
    edit(root, 'colors.tokens.json', '"white": {', '"white": {\n      "$description": "x",')
    const after = manifest(root)
    expect(themeOverrideNotes(before, after, root)).toEqual([])
  })

  it('says every token in one line each, for a change that touches several', () => {
    const root = project()
    const before = manifest(root)
    // Changing the blue the dark theme also uses moves every token that aliases it in the base only.
    const path = join(root, 'system', 'tokens', 'semantic.tokens.json')
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replaceAll('{color.indigo.600}', '{color.blue.600}'),
    )
    const notes = themeOverrideNotes(before, manifest(root), root)
    expect(notes.length).toBeGreaterThanOrEqual(1)
    expect(new Set(notes).size).toBe(notes.length)
    for (const note of notes) expect(note).toMatch(/^color\.[\w.-]+ changed/)
  })
})
