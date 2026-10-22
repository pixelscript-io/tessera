/**
 * SPIKE (Milestone 5): can template expressions be type-checked by feeding the compiler's own output to
 * TypeScript? This file is the experiment and its record. It does not ship; the decision is in SPEC.md.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { compile, extractContract } from '@tessera/compiler'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const counter = readFileSync(`${repo}examples/kitchen-sink/app/components/Counter.tess`, 'utf8')

interface TypeError {
  message: string
  /** The generated text the error points at. */
  text: string
}

const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
  skipLibCheck: true,
  types: [],
  baseUrl: repo,
  paths: { '@tessera/core': ['packages/core/src/index.ts'] },
}

/** Type-check generated module text as `/Generated.ts`, with the real @tessera/core types. */
function typecheck(code: string): TypeError[] {
  const host = ts.createCompilerHost(options)
  const { getSourceFile, fileExists, readFile } = host
  host.getSourceFile = (name, lang, ...rest) =>
    name === '/Generated.ts'
      ? ts.createSourceFile(name, code, lang)
      : getSourceFile.call(host, name, lang, ...rest)
  host.fileExists = (name) => name === '/Generated.ts' || fileExists.call(host, name)
  host.readFile = (name) => (name === '/Generated.ts' ? code : readFile.call(host, name))
  const program = ts.createProgram(['/Generated.ts'], options, host)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === '/Generated.ts')
    .map((d) => ({
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      text: code.slice(d.start, (d.start ?? 0) + (d.length ?? 0)),
    }))
}

const generated = (source: string) => {
  const result = compile(source, { file: 'Counter.tess' })
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return result.code
}

describe('spike: type-checking the compiler output', () => {
  it('the unmodified Counter output is type-clean', () => {
    const started = performance.now()
    const errors = typecheck(generated(counter))
    const ms = performance.now() - started
    console.log(`first program (loads lib.d.ts and core): ${ms.toFixed(0)} ms`)
    expect(errors).toEqual([])
  })

  it('catches a type error in a template expression', () => {
    const errors = typecheck(generated(counter.replace('{label}', '{count.toFixed(1).bad}')))
    expect(errors.map((e) => e.message)).toEqual([
      "Property 'bad' does not exist on type 'string'.",
    ])
    expect(errors[0]!.text).toBe('bad')
  })

  it('catches a type error in a handler, and a wrong call', () => {
    const errors = typecheck(generated(counter.replace('@click="inc"', '@click="inc(1)"')))
    expect(errors.map((e) => e.message)).toEqual(['Expected 0 arguments, but got 1.'])
  })

  it('catches a type error in the script block', () => {
    const errors = typecheck(
      generated(counter.replace('const count = state(0)', "const count = state<number>('x')")),
    )
    expect(
      errors.some((e) =>
        e.message.includes("'string' is not assignable to parameter of type 'number'"),
      ),
    ).toBe(true)
  })

  it('types each-loop items through the list type', () => {
    const errors = typecheck(generated(counter.replace('{todo.text}', '{todo.txt}')))
    // TypeScript's own "Did you mean" comes with it.
    expect(errors.map((e) => e.message)).toEqual([
      "Property 'txt' does not exist on type '{ id: number; text: string; }'. Did you mean 'text'?",
    ])
  })

  it('maps an error back to the source by searching the original text (what a real mapping would replace)', () => {
    const source = counter.replace('{todo.text}', '{todo.txt}')
    const [error] = typecheck(generated(source))
    // The generated text is `.txt`'s property name. Searching the template recovers the line, but only
    // because the name is unique; two expressions using the same name would be ambiguous.
    const index = source.indexOf(error!.text)
    expect(source.slice(0, index).split('\n').length).toBe(
      source.split('\n').findIndex((l) => l.includes('todo.txt')) + 1,
    )
    expect(source.indexOf(error!.text, index + 1)).toBe(-1)
  })

  it('types props from the defaults passed to props()', () => {
    const withProp = `<contract>
{ "name": "Card", "role": "group", "parts": ["root"] }
</contract>
<script>
const { open } = props({ open: false })
</script>
<template><div class="root">{open.nope}</div></template>`
    const result = compile(withProp, { file: 'Card.tess' })
    expect(result.diagnostics).toEqual([])
    expect(typecheck(result.code).map((e) => e.message)).toEqual([
      "Property 'nope' does not exist on type 'boolean'.",
    ])
  })

  it('does not check props given to another component: call sites take untyped records of signals', () => {
    const outer = `<contract>
{ "name": "Card", "role": "group", "parts": ["root"] }
</contract>
<script>
import Button from './Button.tess'
</script>
<template><div class="root"><Button :tone="12">x</Button></div></template>`
    const button = readFileSync(`${repo}packages/compiler/test/fixtures/Button.tess`, 'utf8')
    const result = compile(outer, {
      file: 'Card.tess',
      components: {
        resolve: (tag) =>
          tag === 'Button'
            ? { contract: extractContract(button, 'Button.tess')!, importPath: './Button.tess' }
            : undefined,
        names: () => ['Button'],
      },
    })
    expect(result.diagnostics).toEqual([])
    // A number where the tone must be one of three strings compiles and type-checks. Types generated
    // from contracts (components.d.ts, Milestone 8) are what would catch it.
    const stubbed = result.code.replace(
      "import Button from './Button.tess'",
      'declare const Button: import("@tessera/core").Component',
    )
    expect(typecheck(stubbed)).toEqual([])
  })

  it('times repeated full checks, for the decision record', () => {
    const code = generated(counter)
    typecheck(code)
    const runs = 5
    const started = performance.now()
    for (let i = 0; i < runs; i++) typecheck(code)
    const each = (performance.now() - started) / runs
    console.log(`full re-check, no program reuse: ${each.toFixed(0)} ms`)
    expect(each).toBeLessThan(2000)
  })
})
