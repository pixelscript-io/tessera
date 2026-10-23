import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import {
  applyPlan,
  checkSources,
  planContractChange,
  planNewComponent,
  StaleError,
  undoApplied,
} from '../src/edit/plan'

const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const made: string[] = []
afterAll(() =>
  made.forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })),
)

/** The kitchen-sink app in a throwaway folder, with the system Button as one of its own components. */
function app(): { root: string; project: () => Project; read: (f: string) => string } {
  const root = mkdtempSync(join(tmpdir(), 'tessera-edit-')).replaceAll('\\', '/')
  made.push(root)
  cpSync(join(repo, 'examples/kitchen-sink/app'), join(root, 'app'), {
    recursive: true,
    filter: (src) => !/(\.browser\.test\.ts|__screenshots__|seeded|\.d\.ts)/.test(src),
  })
  cpSync(join(repo, 'system/components/Button.tess'), join(root, 'app/components/Button.tess'))
  const tokens = join(repo, 'system/tokens').replaceAll('\\', '/')
  writeFileSync(
    join(root, 'tessera.config.ts'),
    `export default { tokens: ${JSON.stringify(tokens)} }\n`,
  )
  writeFileSync(join(root, 'package.json'), '{ "name": "scratch" }\n')
  return {
    root,
    project: () => new Project(root, { tokens, today: '2026-10-22' }),
    read: (f) => readFileSync(join(root, f), 'utf8'),
  }
}

const BUTTON = 'app/components/Button.tess'

describe('planning a contract change', () => {
  it('changes only the contract block, and the project still checks clean', () => {
    const a = app()
    const before = a.read(BUTTON)
    const plan = planContractChange(a.project(), 'Button', {
      kind: 'description',
      value: 'Starts something.',
    })
    expect(plan.summary).toBe('Change the description of Button')
    expect(plan.blocking).toEqual([])
    expect(plan.files).toHaveLength(1)
    expect(plan.changes).toEqual([])
    applyPlan(plan)
    const after = a.read(BUTTON)
    expect(after).toBe(
      before.replace(
        '"Triggers an action. Press it with a mouse, a finger, Enter or Space."',
        '"Starts something."',
      ),
    )
    expect([...checkSources(a.project(), new Map()).values()]).toEqual([])
  })

  it('refuses a change that would break a use, with the compiler’s message, and writes nothing', () => {
    const a = app()
    const before = a.read(BUTTON)
    const plan = planContractChange(a.project(), 'Button', {
      kind: 'removeValue',
      variant: 'tone',
      value: 'danger',
    })
    // The use in ConfirmBar, and Button's own style that still selects the value.
    expect(plan.blocking.map((p) => [p.code, p.file]).sort()).toEqual([
      ['T2114', 'app/components/Button.tess'],
      ['T4008', 'app/components/ConfirmBar.tess'],
    ])
    expect(plan.blocking.find((p) => p.code === 'T4008')!.message).toBe(
      'Button.tone has no value "danger".',
    )
    // The removal is breaking, and the plan says how many uses it touches.
    expect(plan.changes.map((c) => c.message)).toEqual(['Button.tone lost the value "danger".'])
    expect(plan.usage[0]!.uses).toEqual([{ file: 'app/components/ConfirmBar.tess', count: 1 }])
    expect(() => applyPlan(plan)).toThrow(
      'This change would break the project, so it was not saved.',
    )
    expect(a.read(BUTTON)).toBe(before)
  })

  it('shows an unused removal as breaking, and allows it', () => {
    const a = app()
    applyPlan(
      planContractChange(a.project(), 'Button', {
        kind: 'addValue',
        variant: 'tone',
        value: 'zzz',
      }),
    )
    const plan = planContractChange(a.project(), 'Button', {
      kind: 'removeValue',
      variant: 'tone',
      value: 'zzz',
    })
    expect(plan.blocking).toEqual([])
    expect(plan.changes.map((c) => `${c.kind}: ${c.message}`)).toEqual([
      'breaking: Button.tone lost the value "zzz".',
    ])
    applyPlan(plan)
    expect(a.read(BUTTON)).not.toContain('zzz')
  })

  it('a rename carries the codemod: the contract, every use and the component’s own styles change together', () => {
    const a = app()
    const plan = planContractChange(a.project(), 'Button', {
      kind: 'renameValue',
      variant: 'tone',
      from: 'danger',
      to: 'destructive',
    })
    expect(plan.blocking).toEqual([])
    expect(plan.files.map((f) => f.file).sort()).toEqual([
      'app/components/Button.tess',
      'app/components/ConfirmBar.tess',
    ])
    expect(plan.codemod).toEqual({ edits: 5, files: 2 })
    expect(plan.changes.map((c) => `${c.kind}: ${c.message}`)).toContain(
      'breaking: Button.tone value "danger" was renamed to "destructive".',
    )
    applyPlan(plan)
    expect(a.read('app/components/ConfirmBar.tess')).toContain('<Button tone="destructive"')
    expect(a.read(BUTTON)).toContain("&[data-tone='destructive']")
    expect(a.read(BUTTON)).toContain('"renamedValues": { "tone": { "danger": "destructive" } }')
    // The project checks exactly as clean as it did.
    expect([...checkSources(a.project(), new Map()).values()]).toEqual([])
  })

  it('a deprecation is a warning, not a block, and is classified', () => {
    const a = app()
    const plan = planContractChange(a.project(), 'Button', {
      kind: 'deprecateValue',
      variant: 'tone',
      value: 'neutral',
      message: 'Use primary.',
    })
    expect(plan.blocking).toEqual([])
    expect(plan.changes.map((c) => c.message)).toEqual([
      'Button.tone "neutral" is now deprecated: Use primary.',
    ])
    expect(plan.usage[0]!.uses.map((u) => u.file)).toEqual([
      'app/components/ConfirmBar.tess',
      'app/components/SiteNav.tess',
    ])
  })

  it('says which uses a new default changes', () => {
    const a = app()
    const plan = planContractChange(a.project(), 'Button', {
      kind: 'setDefault',
      variant: 'tone',
      value: 'neutral',
    })
    expect(plan.changes.map((c) => c.kind)).toEqual(['breaking'])
    expect(plan.usage[0]!.label).toBe('Uses that do not set tone and will change')
  })

  it('errors the project already had do not block an unrelated change', () => {
    const a = app()
    writeFileSync(
      join(a.root, 'app/components/Broken.tess'),
      '<contract>\n{ "name": "Broken", "role": "nope", "parts": ["root"] }\n</contract>\n<template><div class="root"></div></template>\n',
    )
    expect(checkSources(a.project(), new Map()).size).toBeGreaterThan(0)
    const plan = planContractChange(a.project(), 'Button', { kind: 'description', value: 'Fine.' })
    expect(plan.blocking).toEqual([])
    applyPlan(plan)
  })

  it('refuses a change a contract cannot take, naming the problem', () => {
    const a = app()
    const plan = planContractChange(a.project(), 'Button', { kind: 'since', value: 'soon' })
    expect(plan.blocking.map((p) => p.code)).toEqual(['T3003'])
    expect(plan.blocking[0]!.message).toContain('"since"')
    expect(() =>
      planContractChange(a.project(), 'Nope', { kind: 'since', value: '1.0.0' }),
    ).toThrow('There is no component named Nope.')
    expect(() =>
      planContractChange(a.project(), 'Button', { kind: 'addValue', variant: 'x', value: 'y' }),
    ).toThrow('x is not a variant')
  })

  it('does not edit a component that comes from an installed package', () => {
    const a = app()
    // The router's Link is found through the package, not this project.
    expect(() =>
      planContractChange(a.project(), 'Link', { kind: 'description', value: 'x' }),
    ).toThrow('comes from an installed package')
  })
})

describe('saving and undoing', () => {
  it('refuses to save when a file changed on disk after the plan was made', () => {
    const a = app()
    const plan = planContractChange(a.project(), 'Button', { kind: 'description', value: 'Mine.' })
    writeFileSync(join(a.root, BUTTON), a.read(BUTTON) + '\n<!-- someone else -->\n')
    expect(() => applyPlan(plan)).toThrow(StaleError)
    expect(() => applyPlan(plan)).toThrow('changed on disk after this change was prepared')
    expect(a.read(BUTTON)).toContain('someone else')
    expect(a.read(BUTTON)).not.toContain('Mine.')
  })

  it('undoes the last save, and refuses if the files changed since', () => {
    const a = app()
    const before = a.read(BUTTON)
    const applied = applyPlan(
      planContractChange(a.project(), 'Button', { kind: 'description', value: 'Temp.' }),
    )
    expect(a.read(BUTTON)).not.toBe(before)
    undoApplied(applied)
    expect(a.read(BUTTON)).toBe(before)

    const again = applyPlan(
      planContractChange(a.project(), 'Button', { kind: 'description', value: 'Temp.' }),
    )
    writeFileSync(join(a.root, BUTTON), a.read(BUTTON) + '\n')
    expect(() => undoApplied(again)).toThrow('changed after it was saved')
  })

  it('creates a component from the starter, and undo removes it', () => {
    const a = app()
    const plan = planNewComponent(a.project(), 'Panel', 'A panel.')
    expect(plan.files[0]).toMatchObject({ file: 'app/components/Panel.tess', before: null })
    expect(plan.blocking).toEqual([])
    expect(plan.changes.map((c) => c.message)).toEqual(['Panel was added: A panel.'])
    const applied = applyPlan(plan)
    expect(a.read('app/components/Panel.tess')).toContain('"name": "Panel"')
    expect(a.read('app/components/Panel.tess')).toContain('padding: $space.4;')
    undoApplied(applied)
    expect(() => a.read('app/components/Panel.tess')).toThrow()
    expect(() => planNewComponent(a.project(), 'Button', '')).toThrow(
      'A component named Button already exists.',
    )
    expect(() => planNewComponent(a.project(), 'panel', '')).toThrow(
      'is not a valid component name',
    )
  })

  it('leaves no temporary files behind', () => {
    const a = app()
    applyPlan(planContractChange(a.project(), 'Button', { kind: 'description', value: 'Clean.' }))
    mkdirSync(join(a.root, 'x'), { recursive: true })
    const names = (dir: string) => readdirSyncNames(join(a.root, dir))
    expect(names('app/components').filter((n) => n.endsWith('.tmp'))).toEqual([])
    expect(dirname(BUTTON)).toBe('app/components')
  })
})

import { readdirSync } from 'node:fs'
const readdirSyncNames = (dir: string) => readdirSync(dir)
