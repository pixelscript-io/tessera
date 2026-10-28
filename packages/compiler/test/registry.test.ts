import { describe, expect, it } from 'vitest'
import { ComponentRegistry, compile, formatDiagnostic, relativeImport } from '../src'

const component = (name: string, extra = '') => `<contract>
{ "name": "${name}", "role": "group", "parts": ["root"], "variants": { "tone": ["primary", "danger"] }, "slots": { "default": "content" }${extra} }
</contract>
<template><div class="root"></div></template>`

const files = [
  { file: '/proj/system/components/Button.tess', source: component('Button') },
  { file: '/proj/system/components/forms/Field.tess', source: component('Field') },
  { file: '/proj/app/components/Card.tess', source: component('Card') },
]
const display = (f: string) => f.replace('/proj/', '')

describe('relativeImport', () => {
  it('walks up and down between folders', () => {
    expect(relativeImport('/p/app/components/Card.tess', '/p/system/components/Button.tess')).toBe(
      '../../system/components/Button.tess',
    )
    expect(relativeImport('/p/app/components/Card.tess', '/p/app/components/Chip.tess')).toBe(
      './Chip.tess',
    )
    expect(relativeImport('/p/app/components/a/Card.tess', '/p/app/components/Chip.tess')).toBe(
      '../Chip.tess',
    )
    expect(relativeImport('/p/app/Page.tess', '/p/app/components/forms/Field.tess')).toBe(
      './components/forms/Field.tess',
    )
  })

  it('treats windows and posix separators alike', () => {
    expect(relativeImport('C:\\p\\app\\Card.tess', 'C:\\p\\system\\Button.tess')).toBe(
      '../system/Button.tess',
    )
  })
})

describe('ComponentRegistry', () => {
  it('registers every component by contract name, in any subfolder', () => {
    const registry = ComponentRegistry.build(files, display)
    expect(registry.names()).toEqual(['Button', 'Field', 'Card'])
    expect(registry.get('Field')!.file).toBe('/proj/system/components/forms/Field.tess')
    expect(registry.diagnostics).toEqual([])
  })

  it('leaves out files whose contracts do not parse, without a diagnostic of its own', () => {
    const registry = ComponentRegistry.build(
      [
        ...files,
        {
          file: '/proj/app/components/Broken.tess',
          source: '<contract>{ nope </contract><template><div></div></template>',
        },
      ],
      display,
    )
    expect(registry.names()).not.toContain('Broken')
    expect(registry.diagnostics).toEqual([])
  })

  it('reports a duplicate name in each file, naming both, and keeps the first as the definition', () => {
    const registry = ComponentRegistry.build(
      [...files, { file: '/proj/app/components/Button.tess', source: component('Button') }],
      display,
    )
    expect(registry.get('Button')!.file).toBe('/proj/system/components/Button.tess')
    expect(registry.diagnostics.map((d) => [d.file, d.message])).toEqual([
      [
        'system/components/Button.tess',
        'Duplicate component name "Button". It is also defined in app/components/Button.tess.',
      ],
      [
        'app/components/Button.tess',
        'Duplicate component name "Button". It is also defined in system/components/Button.tess.',
      ],
    ])
  })

  it('names every file when there are three', () => {
    const registry = ComponentRegistry.build(
      [
        { file: '/proj/system/components/Same.tess', source: component('Same') },
        { file: '/proj/app/components/one/Same.tess', source: component('Same') },
        { file: '/proj/app/components/two/Same.tess', source: component('Same') },
      ],
      display,
    )
    expect(registry.diagnosticsFor('/proj/app/components/two/Same.tess')[0]!.message).toBe(
      'Duplicate component name "Same". It is also defined in system/components/Same.tess and app/components/one/Same.tess.',
    )
  })

  it('shows the duplicate error at the contract name, in the compiler format, when the file compiles', () => {
    const duplicate = { file: '/proj/app/components/Button.tess', source: component('Button') }
    const registry = ComponentRegistry.build([...files, duplicate], display)
    const result = compile(duplicate.source, {
      file: 'app/components/Button.tess',
      path: duplicate.file,
      registry,
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('')
    expect(formatDiagnostic(result.diagnostics[0]!)).toBe(
      [
        'ERROR  T5001  app/components/Button.tess:2:11',
        '  Duplicate component name "Button". It is also defined in system/components/Button.tess.',
        '  Component names are global and cannot shadow each other. Rename one of them, or use the system component through a wrapper.',
        '  Run `tessera explain T5001` for details.',
      ].join('\n'),
    )
  })

  it('suggests the closest name', () => {
    const registry = ComponentRegistry.build(files, display)
    expect(registry.suggest('Buton')).toBe('Button')
    expect(registry.suggest('Zzzzzzzz')).toBeUndefined()
  })
})

describe('using the registry in a template', () => {
  const registry = ComponentRegistry.build(files, display)
  const page = (template: string, script = '') => `<contract>
{ "name": "Page", "role": "group", "parts": ["root"], "events": { "go": "g" } }
</contract>
${script ? `<script>\n${script}\n</script>` : ''}
<template><div class="root">${template}</div></template>`
  const compileAs = (source: string, options: Partial<Parameters<typeof compile>[1]> = {}) =>
    compile(source, {
      file: 'app/components/Page.tess',
      path: '/proj/app/components/Page.tess',
      registry,
      ...options,
    })

  it('imports a component the template uses, with no import written', () => {
    const result = compileAs(page('<Button tone="danger">Delete</Button>'))
    expect(result.diagnostics).toEqual([])
    expect(result.code).toContain('import Button from "../../system/components/Button.tess"')
    expect(result.code).toContain('Button({ props: { "tone": $constant("danger") }')
  })

  it('imports only the components that are used', () => {
    const result = compileAs(page('<Card />'))
    expect(result.code).toContain('import Card from "./Card.tess"')
    expect(result.code).not.toContain('Button')
    expect(result.code).not.toContain('Field')
  })

  it('imports a component from a subfolder', () => {
    const result = compileAs(page('<Field />'))
    expect(result.code).toContain('import Field from "../../system/components/forms/Field.tess"')
  })

  it('checks variant values against the registered contract', () => {
    const [d] = compileAs(page('<Button tone="dangr">x</Button>')).diagnostics
    expect(d).toMatchObject({
      code: 'T4008',
      message: 'Button.tone has no value "dangr".',
      hint: 'Did you mean "danger"?',
    })
  })

  it('reports a misspelled tag with a suggestion, in the compiler format', () => {
    const result = compileAs(page('<Buton>x</Buton>'))
    expect(formatDiagnostic(result.diagnostics[0]!)).toMatch(
      /^ERROR {2}T4007 {2}app\/components\/Page\.tess:\d+:\d+\n {2}Unknown component <Buton>\.\n {2}Did you mean <Button>\?\n {2}Run `tessera explain T4007` for details\.$/,
    )
  })

  it('lets an explicit import take precedence, and does not import twice', () => {
    const explicit = {
      resolve: (tag: string) =>
        tag === 'Button'
          ? { contract: registry.get('Button')!.contract, importPath: './OtherButton.tess' }
          : undefined,
      names: () => ['Button'],
    }
    const result = compileAs(page('<Button />', "import Button from './OtherButton.tess'"), {
      components: explicit,
    })
    expect(result.code.match(/import Button from/g)).toHaveLength(1)
    expect(result.code).toContain("import Button from './OtherButton.tess'")
  })

  it('does not import a name the script declares itself', () => {
    const result = compileAs(page('<Card />', 'const Card = 1'))
    expect(result.code).not.toContain('Card.tess')
  })

  describe('with autoImports off', () => {
    it('makes a component without an import an error that says which import to add', () => {
      const [d] = compileAs(page('<Button>x</Button>'), { autoImports: false }).diagnostics
      expect(d).toMatchObject({
        code: 'T4007',
        message: 'Unknown component <Button>.',
        hint: 'Auto-imports are off, so import it: import Button from "../../system/components/Button.tess"',
      })
    })

    it('accepts an explicit import', () => {
      const explicit = {
        resolve: (tag: string) =>
          tag === 'Button'
            ? {
                contract: registry.get('Button')!.contract,
                importPath: '../../system/components/Button.tess',
              }
            : undefined,
        names: () => ['Button'],
      }
      const result = compileAs(
        page('<Button>x</Button>', "import Button from '../../system/components/Button.tess'"),
        {
          autoImports: false,
          components: explicit,
        },
      )
      expect(result.diagnostics).toEqual([])
    })

    it('makes a script API without an import an error naming the import', () => {
      const source = page('', 'const n = state(0)')
      const result = compileAs(source, { autoImports: false })
      expect(formatDiagnostic(result.diagnostics[0]!)).toMatch(
        /^ERROR {2}T5003 {2}app\/components\/Page\.tess:\d+:\d+\n {2}"state" is not defined\. Auto-imports are off, so it must be imported\.\n {2}Add: import \{ state \} from "@pixelscriptio\/tessera\/core"\n/,
      )
      expect(result.ok).toBe(false)
    })

    it('accepts script APIs that are imported, and does not add imports of its own', () => {
      const source = page(
        '',
        "import { state, derived } from '@tessera/core'\nconst n = state(0)\nconst d = derived(() => n.value)",
      )
      const result = compileAs(source, { autoImports: false })
      expect(result.diagnostics).toEqual([])
      expect(result.code.split('\n')[0]).not.toContain(', state')
      expect(result.code.match(/import \{ state, derived \}/g)).toHaveLength(1)
    })
  })

  it('with autoImports on, script APIs need no import', () => {
    const result = compileAs(page('', 'const n = state(0)'))
    expect(result.diagnostics).toEqual([])
    expect(result.code.split('\n')[0]).toContain(', state }')
  })
})

describe('ComponentRegistry: no shadowing', () => {
  it('reports a system and an app component with one name, in both files, whatever the order', () => {
    const system = { file: '/proj/system/components/Button.tess', source: component('Button') }
    const own = { file: '/proj/app/components/Button.tess', source: component('Button') }
    for (const order of [
      [system, own],
      [own, system],
    ]) {
      const registry = ComponentRegistry.build(order, display)
      expect(registry.diagnostics).toHaveLength(2)
      expect(
        registry.diagnostics.every((d) => d.message.includes('Duplicate component name "Button"')),
      ).toBe(true)
    }
  })
})
