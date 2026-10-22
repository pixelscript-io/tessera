import { describe, expect, it } from 'vitest'
import {
  checkTemplateParts,
  formatDiagnostic,
  parseContract,
  variantDefaults,
  type ParsedContract,
} from '../src'

const BUTTON = `{
  "name": "Button",
  "role": "button",
  "parts": ["root", "icon", "label"],
  "variants": {
    "tone": ["primary", "neutral", "danger"],   // first value is the default
    "size": ["sm", "md", "lg"],
    "emphasis": ["solid", "outline", "ghost"]
  },
  "states": ["hover", "focus-visible", "pressed", "disabled"],
  "behavior": "press",
  "slots": {
    "default": "label content",
    "icon": "optional leading icon"
  },
  "events": {
    "press": "fired on click, Enter, or Space"
  },
  /* declared pairings across parts */
  "contrast": [{ "foreground": "label", "background": "root" }],
}`

const parse = (source: string, file = 'Button.tess') => parseContract(source, { file })

/** Render every diagnostic in the format the CLI prints. */
const errors = (p: ParsedContract) => p.diagnostics.map(formatDiagnostic)

/** A valid Button with one field replaced or removed. */
const withField = (field: string, value: unknown) => {
  const base = JSON.parse(
    BUTTON.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').replace(/,(\s*[}\]])/g, '$1'),
  )
  if (value === undefined) delete base[field]
  else base[field] = value
  return JSON.stringify(base, null, 2)
}

describe('valid contracts', () => {
  it('parses the Button contract from the spec, comments and trailing comma included', () => {
    const parsed = parse(BUTTON)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.contract).toEqual({
      name: 'Button',
      role: 'button',
      parts: ['root', 'icon', 'label'],
      variants: {
        tone: ['primary', 'neutral', 'danger'],
        size: ['sm', 'md', 'lg'],
        emphasis: ['solid', 'outline', 'ghost'],
      },
      states: ['hover', 'focus-visible', 'pressed', 'disabled'],
      behavior: 'press',
      slots: { default: 'label content', icon: 'optional leading icon' },
      events: { press: 'fired on click, Enter, or Space' },
      contrast: [{ foreground: 'label', background: 'root' }],
    })
  })

  it('defaults a variant to its first value', () => {
    expect(variantDefaults(parse(BUTTON).contract!)).toEqual({
      tone: 'primary',
      size: 'sm',
      emphasis: 'solid',
    })
  })

  it('accepts a minimal contract and every optional field', () => {
    expect(
      parse('{ "name": "Card", "role": "group", "parts": ["root"] }', 'Card.tess').contract,
    ).toEqual({
      name: 'Card',
      role: 'group',
      parts: ['root'],
      variants: {},
      states: [],
      slots: {},
      events: {},
      contrast: [],
    })
    const full = parse(
      `{ "name": "Card", "role": "group", "parts": ["root"], "description": "A card", "since": "1.2.0",
         "deprecated": "Use Panel", "renamedFrom": "Tile", "forkedFrom": { "component": "Card", "version": "1.0.0" } }`,
      'app/components/Card.tess',
    )
    expect(full.diagnostics).toEqual([])
    expect(full.contract).toMatchObject({
      description: 'A card',
      since: '1.2.0',
      deprecated: 'Use Panel',
      renamedFrom: 'Tile',
      forkedFrom: { component: 'Card', version: '1.0.0' },
    })
  })

  it('reports positions inside the larger file when given an origin', () => {
    const parsed = parseContract('{\n  "name": "Buton", "role": "button", "parts": ["root"]\n}', {
      file: 'Button.tess',
      origin: { line: 10, column: 12 },
    })
    expect(parsed.diagnostics[0]).toMatchObject({ line: 11, column: 11 })
    const first = parseContract('{ "name": "Buton", "role": "button", "parts": ["root"] }', {
      file: 'Button.tess',
      origin: { line: 10, column: 12 },
    })
    expect(first.diagnostics[0]).toMatchObject({ line: 10, column: 12 + 10 })
  })
})

describe('invalid contracts', () => {
  it('reports JSON syntax errors with a position', () => {
    expect(errors(parse('{\n  "name": "Button",\n  "role" "button"\n}'))).toEqual([
      [
        'ERROR  T3001  Button.tess:3:10',
        '  Expected ":" after the property name',
        '  Run `tessera explain T3001` for details.',
      ].join('\n'),
    ])
    expect(parse('{ "name": ').diagnostics[0]!.message).toBe('Unexpected end of contract')
    expect(parse('{ "a": 1 } x').diagnostics[0]!.message).toBe(
      'Unexpected content after the contract object',
    )
    expect(parse('{ "a": "x').diagnostics[0]!.message).toBe('Unterminated string')
    expect(parse('[]').diagnostics[0]!.message).toBe('A contract must be a JSON object.')
  })

  it('rejects an unknown field with a suggestion, in the spec error format', () => {
    const source =
      '{\n  "name": "Button",\n  "role": "button",\n  "parts": ["root"],\n  "varients": {}\n}'
    expect(errors(parse(source))).toEqual([
      [
        'ERROR  T3002  Button.tess:5:3',
        '  Unknown contract field "varients".',
        '  Did you mean "variants"?',
        '  Run `tessera explain T3002` for details.',
      ].join('\n'),
    ])
    expect(
      parse('{ "name": "Button", "role": "button", "parts": ["root"], "zzzzzzzz": 1 }')
        .diagnostics[0]!.hint,
    ).toBe(
      'Known fields: "name", "role", "parts", "variants", "states", "behavior", "slots", "events", "description", "contrast", "since", "deprecated", "renamedFrom", "forkedFrom".',
    )
  })

  it('reports missing required fields', () => {
    expect(parse('{}').diagnostics.map((d) => d.message)).toEqual([
      'Missing required field "name".',
      'Missing required field "role".',
      'Missing required field "parts".',
    ])
  })

  it('reports a name that does not match the file', () => {
    expect(errors(parse(withField('name', 'Buton')))[0]).toBe(
      [
        'ERROR  T3004  Button.tess:2:11',
        '  Contract name "Buton" does not match the file name "Button.tess".',
        '  Rename the contract to "Button" or rename the file.',
        '  Run `tessera explain T3004` for details.',
      ].join('\n'),
    )
    expect(parse(BUTTON, 'system/components/Other.tess').diagnostics[0]!.message).toBe(
      'Contract name "Button" does not match the file name "Other.tess".',
    )
  })

  it('requires a PascalCase name', () => {
    const d = parse(withField('name', 'button'), 'button.tess').diagnostics
    expect(d.map((x) => [x.code, x.message, x.hint])).toEqual([
      [
        'T3003',
        '"name" must be PascalCase (for example "Button"), got "button".',
        'Did you mean "Button"?',
      ],
    ])
  })

  it('rejects an unknown ARIA role with a suggestion', () => {
    const d = parse(withField('role', 'buton')).diagnostics
    expect(d.map((x) => [x.code, x.message, x.hint])).toEqual([
      ['T3005', 'Unknown ARIA role "buton".', 'Did you mean "button"?'],
    ])
  })

  it('requires the root part', () => {
    const d = parse(withField('parts', ['icon', 'label'])).diagnostics.filter(
      (x) => x.code === 'T3006',
    )
    expect(d.map((x) => x.message)).toEqual([
      'The parts list must include "root", the part carried by the component\'s root element. Found: "icon", "label".',
    ])
  })

  it('rejects invalid and duplicate parts', () => {
    const noContrast = (parts: string[]) =>
      JSON.stringify({ ...JSON.parse(withField('parts', parts)), contrast: [] })
    expect(parse(noContrast(['root', 'Icon'])).diagnostics.map((x) => x.message)).toEqual([
      'A part name must be a lowercase name using letters, numbers and "-", got "Icon".',
    ])
    expect(parse(noContrast(['root', 'icon', 'icon'])).diagnostics.map((x) => x.message)).toEqual([
      'Duplicate part "icon".',
    ])
  })

  it('rejects duplicate variant values at the second occurrence', () => {
    const source = withField('variants', { size: ['sm', 'md', 'sm'] })
    const [d] = parse(source).diagnostics
    expect(d).toMatchObject({ code: 'T3007', message: 'Duplicate value "sm" in variant "size".' })
    expect(source.split('\n')[d!.line - 1]!.slice(d!.column - 1, d!.column + 3)).toBe('"sm"')
  })

  it('rejects empty, malformed and badly named variants', () => {
    expect(parse(withField('variants', { size: [] })).diagnostics.map((x) => x.message)).toEqual([
      'Variant "size" must list at least one value. The first value is the default.',
    ])
    expect(parse(withField('variants', { size: 'sm' })).diagnostics.map((x) => x.message)).toEqual([
      'Variant "size" must be an array of allowed values.',
    ])
    expect(
      parse(withField('variants', { Size: ['sm'] })).diagnostics.map((x) => x.message),
    ).toEqual(['Variant name "Size" must be camelCase, starting with a lowercase letter.'])
    expect(
      parse(withField('variants', { size: ['s m'] })).diagnostics.map((x) => x.message),
    ).toEqual(['A value of variant "size" must be letters, numbers, "-" and "_", got "s m".'])
  })

  it('reports duplicate fields and duplicate states', () => {
    expect(
      parse(
        '{ "name": "Card", "role": "group", "role": "group", "parts": ["root"] }',
        'Card.tess',
      ).diagnostics.map((x) => x.message),
    ).toEqual(['Duplicate field "role".'])
    expect(
      parse(withField('states', ['hover', 'hover'])).diagnostics.map((x) => x.message),
    ).toEqual(['Duplicate state "hover".'])
  })

  it('rejects an unknown behavior with a suggestion', () => {
    const d = parse(withField('behavior', 'pres')).diagnostics
    expect(d.map((x) => [x.code, x.message, x.hint])).toEqual([
      [
        'T3008',
        'Unknown behavior "pres". Known behaviors: "press", "toggle", "disclosure".',
        'Did you mean "press"?',
      ],
    ])
  })

  it('checks that the contract satisfies its behavior', () => {
    const noPress = parse(withField('events', {})).diagnostics
    expect(noPress.map((x) => [x.code, x.message, x.hint])).toEqual([
      [
        'T3009',
        'Behavior "press" requires the event "press", which is not in events.',
        'Add "press" to events.',
      ],
    ])
    const disclosure = parse(
      '{ "name": "Details", "role": "group", "parts": ["root"], "behavior": "disclosure", "events": { "toggle": "t" } }',
      'Details.tess',
    )
    expect(disclosure.diagnostics.map((x) => x.message)).toEqual([
      'Behavior "disclosure" requires the part "trigger", which is not in parts.',
      'Behavior "disclosure" requires the part "content", which is not in parts.',
    ])
  })

  it('accepts a behavior table from @tessera/behavior', () => {
    const behaviors = { longpress: { parts: ['root'], events: [], states: ['pressed'] } }
    const ok = parseContract(withField('behavior', 'longpress'), { file: 'Button.tess', behaviors })
    expect(ok.diagnostics).toEqual([])
    expect(ok.contract!.behavior).toBe('longpress')

    const missing = parseContract(
      JSON.stringify({ ...JSON.parse(withField('behavior', 'longpress')), states: [] }),
      { file: 'Button.tess', behaviors },
    )
    expect(missing.diagnostics.map((x) => x.message)).toEqual([
      'Behavior "longpress" requires the state "pressed", which is not in states.',
    ])
  })

  it('fails a contrast pairing that names an undeclared part', () => {
    const source = withField('contrast', [{ foreground: 'labl', background: 'root' }])
    const [d] = parse(source).diagnostics
    expect(formatDiagnostic(d!)).toBe(
      [
        `ERROR  T3010  Button.tess:${d!.line}:${d!.column}`,
        '  Contrast "foreground" names "labl", which is not a declared part.',
        '  Did you mean "label"?',
        '  Run `tessera explain T3010` for details.',
      ].join('\n'),
    )
    expect(source.split('\n')[d!.line - 1]!.slice(d!.column - 1)).toMatch(/^"labl"/)
    expect(
      parse(withField('contrast', [{ foreground: 'label', background: 'rot' }])).diagnostics[0]!
        .hint,
    ).toBe('Did you mean "root"?')
    expect(
      parse(withField('contrast', [{ foreground: 'label', background: 'zzzzzz' }])).diagnostics[0]!
        .hint,
    ).toBe('Declared parts: "root", "icon", "label".')
  })

  it('validates the shape of a contrast pairing', () => {
    expect(
      parse(withField('contrast', [{ foreground: 'label' }])).diagnostics.map((x) => x.message),
    ).toEqual(['A contrast pairing is missing "background".'])
    expect(
      parse(withField('contrast', [{ foreground: 'label', backgroud: 'root' }])).diagnostics.map(
        (x) => [x.message, x.hint],
      ),
    ).toEqual([
      ['Unknown contrast field "backgroud".', 'Did you mean "background"?'],
      ['A contrast pairing is missing "background".', undefined],
    ])
    expect(parse(withField('contrast', ['label'])).diagnostics.map((x) => x.message)).toEqual([
      'A contrast pairing must be an object like { "foreground": "label", "background": "root" }.',
    ])
  })

  it('validates since, renamedFrom and forkedFrom', () => {
    expect(parse(withField('since', '1.2')).diagnostics.map((x) => x.message)).toEqual([
      '"since" must be a version such as "1.2.0", got "1.2".',
    ])
    expect(parse(withField('renamedFrom', 'tile')).diagnostics.map((x) => x.message)).toEqual([
      '"renamedFrom" must be a PascalCase component name, got "tile".',
    ])
    expect(
      parse(withField('forkedFrom', { component: 'Button' })).diagnostics.map((x) => x.message),
    ).toEqual(['"forkedFrom" is missing "version".'])
    expect(parse(withField('forkedFrom', 'Button')).diagnostics.map((x) => x.message)).toEqual([
      '"forkedFrom" must be an object like { "component": "Button", "version": "1.2.0" }.',
    ])
  })

  it('reports slots and events with wrong shapes', () => {
    expect(parse(withField('slots', { Default: 'x' })).diagnostics.map((x) => x.message)).toEqual([
      'Slot name "Default" must start with a lowercase letter and use only letters, numbers and "-".',
    ])
    expect(parse(withField('events', { press: 1 })).diagnostics.map((x) => x.message)).toEqual([
      'The description of event "press" must be a string.',
    ])
    expect(parse(withField('slots', [])).diagnostics.map((x) => x.message)).toEqual([
      '"slots" must be an object of slot names to descriptions.',
    ])
  })

  it('returns no contract object when anything is wrong', () => {
    expect(parse(withField('role', 'buton')).contract).toBeUndefined()
  })
})

describe('contract against its template', () => {
  const parsed = parse(BUTTON)

  it('passes when every part is a class and the root carries "root"', () => {
    expect(
      checkTemplateParts(parsed, {
        classes: ['root', 'icon', 'label', 'helper'],
        rootClasses: ['root'],
      }),
    ).toEqual([])
  })

  it('fails a declared part missing from the template, at its position in parts', () => {
    const [d, ...rest] = checkTemplateParts(parsed, { classes: ['root', 'label'] })
    expect(rest).toEqual([])
    expect(formatDiagnostic(d!)).toBe(
      [
        'ERROR  T3011  Button.tess:4:21',
        '  Part "icon" is declared in the contract, but no element in the template has class="icon".',
        '  Add class="icon" to an element, or remove "icon" from parts.',
        '  Run `tessera explain T3011` for details.',
      ].join('\n'),
    )
  })

  it('suggests a near-miss class', () => {
    const [d] = checkTemplateParts(parsed, { classes: ['root', 'lable', 'icon'] })
    expect(d!.hint).toBe('Did you mean class="lable"?')
  })

  it('fails when the root element does not carry the root part', () => {
    const [d] = checkTemplateParts(parsed, {
      classes: ['root', 'icon', 'label'],
      rootClasses: ['icon'],
    })
    expect(d).toMatchObject({
      code: 'T3013',
      message: 'The template\'s root element must carry class="root".',
      hint: 'Add class="root" to the outermost element.',
    })
  })

  it('does nothing for an invalid contract', () => {
    expect(checkTemplateParts(parse('{}'), { classes: [] })).toEqual([])
  })
})
