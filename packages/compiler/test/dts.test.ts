import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ComponentRegistry, generateComponentsDts } from '../src'

const root = fileURLToPath(new URL('../../../', import.meta.url)).replaceAll('\\', '/')
const button = readFileSync(`${root}system/components/Button.tess`, 'utf8')
const counter = readFileSync(`${root}examples/kitchen-sink/app/components/Counter.tess`, 'utf8')
const registry = ComponentRegistry.build([
  { file: `${root}system/components/Button.tess`, source: button },
  { file: `${root}examples/kitchen-sink/app/components/Counter.tess`, source: counter },
])
const dts = generateComponentsDts(registry)

/** Type-check `usage` against the generated declarations (and, optionally, the loose `*.tess` one). */
function errors(usage: string, loose = true): string[] {
  const files: Record<string, string> = {
    '/components.d.ts': dts,
    '/loose.d.ts': loose
      ? "declare module '*.tess' { const c: (input?: any) => any; export default c }"
      : '',
    '/usage.ts': usage,
  }
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    types: [],
    baseUrl: root,
    paths: { '@tessera/core': ['packages/core/src/index.ts'] },
  }
  const host = ts.createCompilerHost(options)
  const { getSourceFile, fileExists, readFile } = host
  host.getSourceFile = (name, lang, ...rest) =>
    name in files
      ? ts.createSourceFile(name, files[name]!, lang)
      : getSourceFile.call(host, name, lang, ...rest)
  host.fileExists = (name) => name in files || fileExists.call(host, name)
  host.readFile = (name) => files[name] ?? readFile.call(host, name)
  const program = ts.createProgram(['/components.d.ts', '/loose.d.ts', '/usage.ts'], options, host)
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('.tessera/components.d.ts', () => {
  it('lists every component with props, events, slots and parts', () => {
    expect(dts).toContain('interface Tags {')
    expect(dts).toContain(
      'Button: { props: ButtonProps; events: ButtonEvents; slots: ButtonSlots; parts: ButtonPart }',
    )
    expect(dts).toContain('Counter: { props: CounterProps')
    expect(dts).toContain('tone?: "primary" | "neutral" | "danger"')
    expect(dts).toContain('"press": unknown')
    expect(dts).toContain("declare module '*/Button.tess' {")
  })

  it('is a script, so wildcard module declarations are allowed', () => {
    const source = ts.createSourceFile('x.d.ts', dts, ts.ScriptTarget.ES2022)
    expect(
      source.statements.some((s) => ts.isImportDeclaration(s) || ts.isExportDeclaration(s)),
    ).toBe(false)
  })

  it('types an imported component by its file name: valid usage passes', () => {
    expect(
      errors(`
        import Button from '../system/components/Button.tess'
        import { constant } from '@tessera/core'
        Button({ props: { tone: constant('danger'), size: constant('lg') }, events: { press: (d) => d }, slots: { default: () => ['x'] } })
      `),
    ).toEqual([])
  })

  it('rejects a misspelled variant value, an unknown event and an unknown slot in TypeScript code', () => {
    const e = errors(`
      import Button from '../system/components/Button.tess'
      import { constant } from '@tessera/core'
      Button({ props: { tone: constant('dangr') } })
      Button({ events: { pres: () => {} } })
      Button({ slots: { icn: () => [] } })
    `)
    expect(e).toHaveLength(3)
    expect(e[0]).toContain('"dangr"')
    expect(e[1]).toContain("'pres' does not exist")
    expect(e[2]).toContain("'icn' does not exist")
  })

  it('keeps each component distinct', () => {
    expect(
      errors(`
        import Counter from './app/components/Counter.tess'
        import { constant } from '@tessera/core'
        Counter({ props: { tone: constant('danger') } })
      `),
    ).toEqual([expect.stringContaining('"danger"')])
  })
})
