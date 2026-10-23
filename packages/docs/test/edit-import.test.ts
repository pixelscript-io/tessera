import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { exportTokens, type InterchangeFile } from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import { planTokenImport } from '../src/edit/import-plan'
import { applyPlan, checkSources, undoApplied } from '../src/edit/plan'

const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const made: string[] = []
afterAll(() =>
  made.forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })),
)

/** The kitchen-sink app with its own copy of the repository tokens, so an import can replace them. */
function app() {
  const root = mkdtempSync(join(tmpdir(), 'tessera-import-test-')).replaceAll('\\', '/')
  made.push(root)
  cpSync(join(repo, 'examples/kitchen-sink/app'), join(root, 'app'), {
    recursive: true,
    filter: (src) => !/(\.browser\.test\.ts|__screenshots__|seeded|\.d\.ts)/.test(src),
  })
  cpSync(join(repo, 'system/components/Button.tess'), join(root, 'app/components/Button.tess'))
  cpSync(join(repo, 'system/tokens'), join(root, 'system/tokens'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{ "name": "scratch" }\n')
  const project = () => new Project(root, { today: '2026-10-22' })
  const read = (f: string) => readFileSync(join(root, f), 'utf8')
  // An export of the tokens as they are now: the starting point for "a new export".
  const exported = (): InterchangeFile[] =>
    exportTokens(loadTokenDir(join(root, 'system/tokens')), 'dtcg').files
  return { root, project, read, exported }
}

/** Change a file of an export by editing its JSON. */
function change(
  files: InterchangeFile[],
  path: string,
  edit: (doc: any) => void,
): InterchangeFile[] {
  return files.map((f) => {
    if (f.path !== path) return f
    const doc = JSON.parse(f.content)
    edit(doc)
    return { path: f.path, content: JSON.stringify(doc, null, 2) }
  })
}

describe('planning a token import', () => {
  it('shows a changed value as cosmetic, and writes only the files that changed', () => {
    const a = app()
    const files = change(a.exported(), 'sets/base.tokens.json', (d) => {
      d.color.blue['300'].$value.components = [0.6, 0.78, 0.99]
    })
    const plan = planTokenImport(a.project(), files)
    expect(plan.blocking).toEqual([])
    expect(new Set(plan.changes.map((c) => c.kind))).toEqual(new Set(['cosmetic']))
    expect(plan.changes.map((c) => c.name)).toContain('$color.blue.300')
    expect(plan.files.map((f) => f.file)).toEqual(['system/tokens/base.tokens.json'])
    applyPlan(plan)
    expect(a.read('system/tokens/base.tokens.json')).toContain('0.99')
    expect([...checkSources(a.project(), new Map()).values()]).toEqual([])
  })

  it('shows a value that flips contrast as breaking, and refuses it where a component declares the pair', () => {
    const a = app()
    // The default surface becomes dark, so the dark text on it no longer passes.
    const files = change(a.exported(), 'sets/base.tokens.json', (d) => {
      d.color.neutral['0'].$value.components = [0.05, 0.05, 0.1]
    })
    const plan = planTokenImport(a.project(), files)
    // The compiler's own contrast check fails for the components that declare a pair, so the save is refused...
    expect(plan.blocking.map((p) => p.code)).toContain('T2107')
    // ...and the change is classified as breaking, with the pair and the numbers, before anything is written.
    const breaking = plan.changes.filter((c) => c.kind === 'breaking').map((c) => c.message)
    expect(breaking.length).toBeGreaterThan(0)
    expect(breaking[0]).toMatch(
      /^Contrast of \$color\.\S+ on \$color\.\S+ in the default theme fell from/,
    )
  })

  it('refuses an import that removes a token the project still uses, naming where', () => {
    const a = app()
    // Taken out of the base and out of the theme that overrides it, as a real export without it would be.
    const files = a.exported().map((f) => {
      const doc = JSON.parse(f.content)
      delete doc.space?.['4']
      return { path: f.path, content: JSON.stringify(doc, null, 2) }
    })
    const plan = planTokenImport(a.project(), files)
    expect(plan.blocking.length).toBeGreaterThan(0)
    expect(plan.blocking.every((p) => p.code === 'T2104')).toBe(true)
    expect(plan.blocking.map((p) => p.message)).toContain('Unknown token "$space.4"')
    expect(plan.changes.some((c) => c.message === '$space.4 was removed.')).toBe(true)
    expect(() => applyPlan(plan)).toThrow('would break the project')
  })

  it('lists token files the import does not produce as deletions, and undo brings everything back', () => {
    const a = app()
    const before = a.read('system/tokens/base.tokens.json')
    const exported = a.exported()
    // A token file the new export has no counterpart for.
    writeFileSync(
      join(a.root, 'system/tokens/stale.tokens.json'),
      '{ "stale": { "$type": "number", "x": { "$value": 1 } } }\n',
    )
    const files = change(exported, 'sets/base.tokens.json', (d) => {
      d.color.blue['300'].$value.components = [0.6, 0.78, 0.99]
    })
    const plan = planTokenImport(a.project(), files)
    const stale = plan.files.find((f) => f.file === 'system/tokens/stale.tokens.json')!
    expect(stale.after).toBeNull()
    const applied = applyPlan(plan)
    expect(() => a.read('system/tokens/stale.tokens.json')).toThrow()
    undoApplied(applied)
    expect(a.read('system/tokens/stale.tokens.json')).toContain('"stale"')
    expect(a.read('system/tokens/base.tokens.json')).toBe(before)
  })

  it('reports an import that fails, with its message, and has nothing to save', () => {
    const a = app()
    const plan = planTokenImport(a.project(), [{ path: 'broken.json', content: '{ nope' }])
    expect(plan.files).toEqual([])
    expect(plan.blocking.map((p) => p.code)).toEqual(['T1001'])
    expect(() => planTokenImport(a.project(), [])).toThrow(
      'Choose the files of a token export first.',
    )
  })

  it('carries the import’s own notes (what it skipped) with the plan', () => {
    const a = app()
    const files: InterchangeFile[] = [
      {
        path: 'brand.json',
        content: JSON.stringify({
          color: {
            $type: 'color',
            neutral: { '0': { $value: '#ffffff' } },
          },
          heading: { $type: 'typography', $value: { fontSize: '16px' } },
        }),
      },
    ]
    const plan = planTokenImport(a.project(), files)
    expect(plan.notes.some((n) => n.includes('The type "typography" is not supported.'))).toBe(true)
  })

  it('says so when an import would change nothing', () => {
    const a = app()
    const first = planTokenImport(a.project(), a.exported())
    applyPlan(first)
    const again = planTokenImport(a.project(), a.exported())
    expect(again.files).toEqual([])
    expect(again.notes).toContain('Nothing would change: the project already has these tokens.')
  })
})
