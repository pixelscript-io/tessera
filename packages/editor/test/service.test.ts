import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compile, formatDiagnostic } from '@tessera/compiler'
import { completeContract, getDiagnostics } from '../src'
import { EditorProject } from '../src/node'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const seededPath = `${repo}examples/kitchen-sink/app/seeded/Broken.tess`
const seeded = readFileSync(seededPath, 'utf8')

describe('diagnostics', () => {
  const source = `<contract>
{ "name": "Card", "role": "buton", "parts": ["root"] }
</contract>
<template><div class="root"></div></template>`

  it('uses the same text as the CLI', () => {
    const [d] = getDiagnostics(source, { file: 'Card.tess' })
    const [cli] = compile(source, { file: 'Card.tess' }).diagnostics
    expect(d!.formatted).toBe(formatDiagnostic(cli!))
    expect(d!.formatted).toBe(
      [
        'ERROR  T3005  Card.tess:2:27',
        '  Unknown ARIA role "buton".',
        '  Did you mean "button"?',
        '  Run `tessera explain T3005` for details.',
      ].join('\n'),
    )
    // The inline message is the middle two lines of that.
    expect(d!.message).toBe('Unknown ARIA role "buton".\nDid you mean "button"?')
    expect(d).toMatchObject({ severity: 'error', code: 'T3005' })
  })

  it('gives 0-based ranges that cover the offending word or string', () => {
    const [d] = getDiagnostics(source, { file: 'Card.tess' })
    expect(d).toMatchObject({ line: 1, column: 26, endLine: 1, endColumn: 33 })
    expect(source.split('\n')[1]!.slice(d!.column, d!.endColumn)).toBe('"buton"')
  })

  it('reports warnings as warnings', () => {
    const impure = `<contract>
{ "name": "Card", "role": "group", "parts": ["root"] }
</contract>
<script>
const a = state(0)
const d = derived(() => { a.value++ })
</script>
<template><div class="root"></div></template>`
    const diagnostics = getDiagnostics(impure, { file: 'Card.tess' })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ severity: 'warning', code: 'W4101', line: 5 })
  })

  it('is quiet for a valid file and does not throw on a half-typed one', () => {
    const ok = source.replace('buton', 'button')
    expect(getDiagnostics(ok, { file: 'Card.tess' })).toEqual([])
    for (let n = 0; n < ok.length; n += 7) {
      expect(() => getDiagnostics(ok.slice(0, n), { file: 'Card.tess' })).not.toThrow()
    }
  })
})

describe('the seeded kitchen-sink file', () => {
  const project = new EditorProject(repo)
  const diagnostics = project.diagnose(seededPath, seeded)

  it('flags the unknown variant value, using the real Counter contract', () => {
    const variant = diagnostics.find((d) => d.code === 'T4008')!
    expect(variant.message).toBe('Counter.tone has no value "primry".\nDid you mean "primary"?')
    const line = seeded.split('\n')[variant.line]!
    expect(line.slice(variant.column, variant.endColumn)).toBe('primry')
  })

  it('flags the unknown tokens against the real system tokens', () => {
    const tokens = diagnostics.filter((d) => d.code === 'T2104')
    expect(tokens.map((d) => d.message)).toEqual([
      expect.stringMatching(/^Unknown token "\$space\.9"/),
      'Unknown token "$color.surface.defalt"\nDid you mean "$color.surface.default"?',
    ])
    const line = seeded.split('\n')[tokens[1]!.line]!
    expect(line.slice(tokens[1]!.column, tokens[1]!.endColumn)).toBe('$color.surface.defalt')
  })

  it('reports nothing else', () => {
    expect(diagnostics.map((d) => d.code).sort()).toEqual(['T2104', 'T2104', 'T4008'])
  })

  it('finds no tokens, and so skips the check, outside a design system', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'tessera-'))
    expect(project.tokenPaths(join(elsewhere, 'x.tess'))).toBeUndefined()
  })

  it('picks up token changes after invalidate()', () => {
    expect(project.tokenPaths(seededPath)).toContain('color.action.primary.bg')
    project.invalidate()
    expect(project.tokenPaths(seededPath)).toContain('space.4')
  })
})

describe('contract completion', () => {
  const at = (text: string) => {
    const marker = text.indexOf('|')
    const source = `<contract>\n${text.replace('|', '')}\n</contract>\n<template><div></div></template>`
    return completeContract(source, '<contract>\n'.length + marker)
  }
  const labels = (text: string) => at(text)?.items.map((i) => i.label)

  it('is only active inside the contract block', () => {
    const source = '<contract>{}</contract>\n<template><div>|</div></template>'
    expect(completeContract(source.replace('|', ''), source.indexOf('|'))).toBeUndefined()
    expect(completeContract('<template></template>', 5)).toBeUndefined()
  })

  it('suggests field names, skipping ones already present', () => {
    expect(labels('{ |')).toEqual(allFields)
    expect(labels('{ "name": "A", |')).not.toContain('name')
    expect(labels('{ "name": "A", |')).toContain('role')
  })

  it('inserts a quoted key with a colon when typing a bare word', () => {
    const result = at('{ "name": "A", ro| }')!
    expect(result.items.map((i) => i.label)).toEqual(['role'])
    expect(result.items[0]!.insert).toBe('"role": ')
    expect(result.replaceEnd - result.replaceStart).toBe(2)
  })

  it('completes inside a key string', () => {
    const result = at('{ "va|" }')!
    expect(result.items.map((i) => i.label)).toContain('variants')
    expect(result.items[0]!.insert).toBe(result.items[0]!.label)
  })

  it('describes fields from the schema', () => {
    expect(at('{ |')!.items.find((i) => i.label === 'parts')!.detail).toContain(
      'Must include "root"',
    )
  })

  it('suggests ARIA roles and behaviors as values', () => {
    expect(labels('{ "role": "|" }')).toContain('button')
    expect(labels('{ "role": "tool|" }')).toContain('toolbar')
    expect(labels('{ "behavior": "|" }')).toEqual([
      'press',
      'toggle',
      'disclosure',
      'dialog',
      'combobox',
    ])
    expect(at('{ "role": |}')!.items[0]!.insert).toMatch(/^"/)
  })

  it('suggests the declared parts inside a contrast pairing', () => {
    expect(labels('{ "parts": ["root", "label"], "contrast": [{ "foreground": "|" }] }')).toEqual([
      'root',
      'label',
    ])
    expect(labels('{ "contrast": [{ |')).toEqual(['foreground', 'background'])
    expect(labels('{ "forkedFrom": { |')).toEqual(['component', 'version'])
  })

  it('stays quiet where names are free-form', () => {
    expect(at('{ "variants": { |')).toBeUndefined()
    expect(at('{ "slots": { "default": "|" } }')).toBeUndefined()
  })
})

const allFields = [
  'name',
  'role',
  'description',
  'parts',
  'variants',
  'states',
  'behavior',
  'slots',
  'events',
  'contrast',
  'since',
  'deprecated',
  'renamedFrom',
  'deprecatedValues',
  'renamedValues',
  'forkedFrom',
]

describe('components resolved without imports', () => {
  const project = new EditorProject(repo)
  const confirm = `${repo}examples/kitchen-sink/app/components/ConfirmBar.tess`
  const source = readFileSync(confirm, 'utf8')

  it('is clean for ConfirmBar, which uses Button with no import', () => {
    expect(source).not.toContain('import')
    expect(project.diagnose(confirm, source)).toEqual([])
  })

  it('checks Button usage against its contract, with a suggestion', () => {
    const bad = source.replace('tone="danger"', 'tone="dangr"')
    const [d] = project.diagnose(confirm, bad)
    expect(d).toMatchObject({
      code: 'T4008',
      message: 'Button.tone has no value "dangr".\nDid you mean "danger"?',
    })
  })

  it('reports a misspelled tag and a duplicated name', () => {
    const typo = source.replace(/<Button /g, '<Buton ').replace(/<\/Button>/g, '</Buton>')
    expect(project.diagnose(confirm, typo)[0]).toMatchObject({
      code: 'T4007',
      message: 'Unknown component <Buton>.\nDid you mean <Button>?',
    })
  })

  it('finds the project of a file from the nearest app/components, not the workspace root', () => {
    const other = new EditorProject('/somewhere/else')
    expect(other.diagnose(confirm, source)).toEqual([])
  })
})
