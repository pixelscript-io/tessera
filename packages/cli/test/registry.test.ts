import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { buildRegistry, writeRegistry } from '../src/registry/build'
import {
  checksum,
  itemFile,
  RegistryError,
  safePath,
  validateIndex,
  validateItem,
  type RegistryFile,
} from '../src/registry/schema'

const ui = fileURLToPath(new URL('../../ui', import.meta.url))
const cli = fileURLToPath(new URL('..', import.meta.url))

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-registry-'))
  roots.push(dir)
  return dir
}

const good = (files: RegistryFile[] = [{ path: 'Chip.tess', content: 'x' }]) => ({
  name: 'Chip',
  type: 'component',
  description: 'A chip.',
  files,
  sha256: checksum(files),
})

describe('what a registry item may contain', () => {
  it('accepts a component with its files', () => {
    const item = validateItem(
      good([
        { path: 'Chip.tess', content: 'a' },
        { path: 'Chip.docs.md', content: 'b' },
      ]),
    )
    expect(item.files.map((f) => f.path)).toEqual(['Chip.tess', 'Chip.docs.md'])
  })

  it.each([
    '../Chip.tess',
    '/etc/passwd',
    'C:\\x.tess',
    'sub/Chip.tess',
    '..\\Chip.tess',
    'Chip.tess/',
    'chip.tess',
    'Chip.js',
    'Chip.tess\0',
    '.hidden.ts',
    'package.json',
  ])('refuses the path %j', (path) => {
    expect(() => validateItem(good([{ path, content: 'x' }]))).toThrow(RegistryError)
  })

  it('lets a script sit beside the component, and a token set have a themes folder', () => {
    expect(safePath('component', 'icons.ts')).toBe(true)
    expect(safePath('tokens', 'themes/dark.tokens.json')).toBe(true)
    expect(safePath('tokens', 'TAILWIND-LICENSE')).toBe(true)
    expect(safePath('tokens', 'themes/../x.tokens.json')).toBe(false)
    expect(safePath('tokens', 'themes/sub/x.tokens.json')).toBe(false)
    expect(safePath('tokens', 'x.ts')).toBe(false)
  })

  it('refuses files whose content does not match the checksum', () => {
    const item = good()
    item.files = [{ path: 'Chip.tess', content: 'changed' }]
    expect(() => validateItem(item)).toThrow(/checksum/)
  })

  it('refuses a name that is not the one asked for, and names that are not valid', () => {
    expect(() => validateItem(good(), 'Other')).toThrow(/not "Other"/)
    expect(() => validateItem({ ...good(), name: 'chip' })).toThrow(/valid name/)
    expect(() => validateItem({ ...good(), name: '../Chip' })).toThrow(/valid name/)
    expect(() => validateItem({ ...good(), type: 'tokens', name: 'tokens:Bad Name' })).toThrow()
  })

  it('refuses duplicate paths, no files, too many files and files that are too large', () => {
    const twice = [
      { path: 'Chip.tess', content: 'a' },
      { path: 'Chip.tess', content: 'b' },
    ]
    expect(() => validateItem(good(twice))).toThrow(/twice/)
    expect(() => validateItem({ ...good(), files: [] })).toThrow()
    const many = Array.from({ length: 41 }, (_, i) => ({ path: `F${i}.ts`, content: '' }))
    expect(() => validateItem(good(many))).toThrow(/more than/)
    expect(() =>
      validateItem(good([{ path: 'Chip.tess', content: 'x'.repeat(2 * 1024 * 1024 + 1) }])),
    ).toThrow(/too large/)
  })

  it('refuses npm packages and versions that could carry a shell command', () => {
    for (const npm of [
      { 'a; rm -rf /': '1.0.0' },
      { lucide: '1.0.0 && x' },
      { lucide: '$(x)' },
      { '../x': '1' },
    ])
      expect(() => validateItem({ ...good(), npm })).toThrow()
    expect(validateItem({ ...good(), npm: { lucide: '1.62.0', '@a/b': '^2.0.0' } }).npm).toEqual({
      lucide: '1.62.0',
      '@a/b': '^2.0.0',
    })
  })

  it('refuses things that are not objects, and an index of the wrong shape', () => {
    for (const raw of [null, 'x', 3, [], { name: 3 }])
      expect(() => validateItem(raw)).toThrow(RegistryError)
    expect(() => validateIndex({ version: 2, name: 'x', items: [] })).toThrow(RegistryError)
    expect(() =>
      validateIndex({
        version: 1,
        name: 'x',
        items: [{ name: '../x', description: '', type: 'component' }],
      }),
    ).toThrow()
  })

  it('serves each item from r/<name>.json', () => {
    expect(itemFile('Button')).toBe('r/Button.json')
    expect(itemFile('tokens:tailwind')).toBe('r/tokens-tailwind.json')
  })
})

describe('the registry built from packages/ui', () => {
  const registry = buildRegistry({
    uiDir: ui,
    tokenSets: [
      {
        name: 'tailwind',
        description: 'Tailwind values.',
        dir: join(cli, 'templates/tailwind/system/tailwind/tokens'),
      },
      {
        name: 'unstyled',
        description: 'Plain values.',
        dir: join(cli, 'templates/unstyled/system/unstyled/tokens'),
      },
    ],
    minTessera: '0.9.0',
    npmVersions: { lucide: '1.62.0' },
  })
  const item = (name: string) => registry.items.find((i) => i.name === name)!

  it('has an item for every component in the catalogue, and the token sets', () => {
    const names = registry.items.map((i) => i.name)
    expect(names).toContain('Button')
    expect(names).toContain('Accordion')
    expect(names).toContain('tokens:tailwind')
    expect(names).toContain('tokens:unstyled')
    expect(registry.index.items.map((i) => i.name)).toEqual(names)
    expect(registry.index.items.every((i) => i.files.every((f) => typeof f === 'string'))).toBe(
      true,
    )
  })

  it('gives a component its source and its docs file', () => {
    expect(item('Button').files.map((f) => f.path)).toEqual(['Button.tess', 'Button.docs.md'])
    expect(item('Button').files[0]!.content).toBe(
      readFileSync(join(ui, 'components/Button.tess'), 'utf8'),
    )
    expect(item('Button').minTessera).toBe('0.9.0')
  })

  it('finds, from the template, the components a component needs', () => {
    expect(item('Accordion').components).toEqual(['AccordionItem'])
    expect(item('Button').components).toBeUndefined()
  })

  it('finds, from the scripts, the npm packages and ships the icon set beside Icon', () => {
    expect(item('Icon').npm).toEqual({ lucide: '1.62.0' })
    expect(item('Icon').files.map((f) => f.path)).toContain('icons.ts')
    expect(item('Button').npm).toBeUndefined()
  })

  it('lists the tokens a component’s styles use', () => {
    expect(item('Card').tokens).toContain('color.surface.raised')
    expect(item('Card').tokens).toContain('shadow.sm')
  })

  it('carries the files of a token set, with its themes', () => {
    const paths = item('tokens:unstyled').files.map((f) => f.path)
    expect(paths).toContain('colors.tokens.json')
    expect(paths).toContain('themes/dark.tokens.json')
    expect(item('tokens:tailwind').files.map((f) => f.path)).toContain('TAILWIND-LICENSE')
  })

  it('passes its own validation, item by item, after a trip through JSON', () => {
    for (const i of registry.items)
      expect(() => validateItem(JSON.parse(JSON.stringify(i)), i.name)).not.toThrow()
  })

  it('refuses a component whose contract name is not its file name', () => {
    const dir = scratch()
    mkdirSync(join(dir, 'components'))
    writeFileSync(
      join(dir, 'components', 'Chip.tess'),
      '<contract>\n{ "name": "Other", "role": "generic", "description": "x", "parts": ["root"] }\n</contract>\n<template><span class="root"><slot /></span></template>\n',
    )
    expect(() => buildRegistry({ uiDir: dir, minTessera: '0.9.0' })).toThrow(/named "Chip"/)
  })

  it('refuses an import with no version to install', () => {
    const dir = scratch()
    mkdirSync(join(dir, 'components'))
    writeFileSync(
      join(dir, 'components', 'Chip.tess'),
      '<contract>\n{ "name": "Chip", "role": "generic", "description": "x", "parts": ["root"] }\n</contract>\n<script>\nimport { x } from \'left-pad\'\n</script>\n<template><span class="root"><slot /></span></template>\n',
    )
    expect(() => buildRegistry({ uiDir: dir, minTessera: '0.9.0' })).toThrow(/left-pad/)
  })

  it('writes index.json and r/<item>.json', () => {
    const out = scratch()
    writeRegistry(registry, join(out, 'reg'))
    const index = JSON.parse(readFileSync(join(out, 'reg', 'index.json'), 'utf8'))
    expect(index.items.length).toBe(registry.items.length)
    const button = JSON.parse(readFileSync(join(out, 'reg', 'r', 'Button.json'), 'utf8'))
    expect(validateItem(button, 'Button').name).toBe('Button')
    expect(() => readFileSync(join(out, 'reg', 'r', 'tokens-unstyled.json'), 'utf8')).not.toThrow()
  })
})
