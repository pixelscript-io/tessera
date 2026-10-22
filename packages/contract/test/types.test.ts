import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ARIA_ROLES, contractSchema, generateTypes, parseContract } from '../src'

const BUTTON = `{
  "name": "Button",
  "role": "button",
  "parts": ["root", "icon", "label"],
  "variants": { "tone": ["primary", "neutral", "danger"], "size": ["sm", "md", "lg"] },
  "states": ["hover", "pressed", "disabled"],
  "behavior": "press",
  "slots": { "default": "label content", "icon": "optional leading icon" },
  "events": { "press": "fired on click, Enter, or Space" }
}`

const contract = parseContract(BUTTON, { file: 'Button.tess' }).contract!

/** Type-check `usage` against `declarations` in memory and return the error messages. */
function typeErrors(declarations: string, usage: string): string[] {
  const files: Record<string, string> = { '/Button.d.ts': declarations, '/usage.ts': usage }
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  }
  const host = ts.createCompilerHost(options)
  const { getSourceFile, fileExists, readFile } = host
  host.getSourceFile = (name, lang, ...rest) =>
    name in files
      ? ts.createSourceFile(name, files[name]!, lang)
      : getSourceFile.call(host, name, lang, ...rest)
  host.fileExists = (name) => name in files || fileExists.call(host, name)
  host.readFile = (name) => files[name] ?? readFile.call(host, name)
  const program = ts.createProgram(['/usage.ts'], options, host)
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('derived types', () => {
  it('generates props, slots, events and parts', () => {
    expect(generateTypes(contract)).toBe(`// Generated from the Button contract. Do not edit.

export interface ButtonProps {
  /** Default: "primary" */
  tone?: "primary" | "neutral" | "danger"
  /** Default: "sm" */
  size?: "sm" | "md" | "lg"
}

export interface ButtonSlots {
  /** label content */
  "default"?: unknown
  /** optional leading icon */
  "icon"?: unknown
}

export interface ButtonEvents {
  /** fired on click, Enter, or Space */
  "press": unknown
}

export type ButtonPart = "root" | "icon" | "label"
`)
  })

  it('round-trips: valid usage type-checks and a misspelled variant value does not', () => {
    const declarations = generateTypes(contract)
    const usage = `
      import type { ButtonProps, ButtonPart, ButtonSlots, ButtonEvents } from './Button'
      export const ok: ButtonProps = { tone: 'danger', size: 'lg' }
      export const part: ButtonPart = 'label'
      export const slots: ButtonSlots = { icon: 1 }
      export const events: ButtonEvents = { press: undefined }
      export const bad: ButtonProps = { tone: 'dangr' }
      export const unknownProp: ButtonProps = { colour: 'red' }
    `
    const errors = typeErrors(declarations, usage)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain(
      `Type '"dangr"' is not assignable to type '"primary" | "neutral" | "danger"`,
    )
    expect(errors[1]).toContain(`'colour' does not exist in type 'ButtonProps'`)
  })

  it('handles a contract with no variants, slots or events', () => {
    const card = parseContract('{ "name": "Card", "role": "group", "parts": ["root"] }', {
      file: 'Card.tess',
    }).contract!
    expect(
      typeErrors(
        generateTypes(card),
        `import type { CardProps } from './Button'\nexport const p: CardProps = {}`,
      ),
    ).toEqual([])
  })
})

describe('contract.schema.json', () => {
  const path = fileURLToPath(new URL('../contract.schema.json', import.meta.url))
  const expected = JSON.stringify(contractSchema, null, 2) + '\n'

  it('is published and in sync with the schema in code (run with UPDATE_SCHEMA=1 to refresh)', () => {
    if (process.env.UPDATE_SCHEMA) writeFileSync(path, expected)
    expect(readFileSync(path, 'utf8')).toBe(expected)
  })

  it('describes the same fields and roles that the validator accepts', () => {
    expect(Object.keys(contractSchema.properties)).toEqual([
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
      'forkedFrom',
    ])
    expect(contractSchema.properties.role.enum).toEqual([...ARIA_ROLES])
    expect(contractSchema.required).toEqual(['name', 'role', 'parts'])
  })
})
