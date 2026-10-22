import { describe, expect, it } from 'vitest'
import { buildTokens, formatDiagnostic, type BuildInput } from '../src'

const srgb = (...components: number[]) => ({ colorSpace: 'srgb', components })

const build = (base: unknown, themes: Array<[string, unknown]> = []) =>
  buildTokens({
    base: [{ file: 'base.tokens.json', content: base }],
    themes: themes.map(([file, content]) => ({ file, content })),
  } satisfies BuildInput)

const messages = (r: ReturnType<typeof build>) =>
  r.diagnostics.map((d) =>
    `${d.code} ${d.path ?? ''} ${d.message}${d.hint ? ` | ${d.hint}` : ''}`
      .replace(/\s+/g, ' ')
      .trim(),
  )

describe('parsing', () => {
  it('inherits $type from groups and supports $root', () => {
    const r = build({
      space: {
        $type: 'dimension',
        $root: { $value: { value: 4, unit: 'px' } },
        2: { $value: { value: 8, unit: 'px' } },
      },
    })
    expect(r.ok).toBe(true)
    // JS orders integer-like keys first, so compare sorted.
    expect(r.manifest!.tokens.map((t) => [t.path, t.type, t.cssVar]).sort()).toEqual([
      ['space.$root', 'dimension', '--t-space'],
      ['space.2', 'dimension', '--t-space-2'],
    ])
  })

  it('reports a token with no type', () => {
    const r = build({ a: { $value: 1 } })
    expect(messages(r)).toEqual([
      'T1003 a Token "a" has no $type. Set "$type" on the token or on a parent group.',
    ])
  })

  it('rejects names that cannot be CSS custom properties', () => {
    const r = build({ $type: 'number', 'a b': { $value: 1 } })
    expect(messages(r)).toEqual([
      'T1002 a b Invalid token name "a b". Names may only contain letters, numbers, "-" and "_" so they can become CSS custom properties.',
    ])
  })

  it('rejects group $extends and $ref instead of ignoring them', () => {
    const r = build({ g: { $extends: '{h}' }, t: { $ref: '#/x' } })
    expect(messages(r)).toEqual([
      'T1009 g Group "$extends" is not supported yet. Write the tokens out in the group instead.',
      'T1009 t JSON Pointer "$ref" is not supported yet. Use a {group.token} alias instead.',
    ])
  })

  it('reports invalid JSON text', () => {
    const r = build('{ nope')
    expect(r.diagnostics[0]!.code).toBe('T1001')
    expect(r.diagnostics[0]!.message).toMatch(/^Could not parse as JSON/)
  })

  it('reports a token defined in two files', () => {
    const r = buildTokens({
      base: [
        { file: 'a.tokens.json', content: { n: { $type: 'number', $value: 1 } } },
        { file: 'b.tokens.json', content: { n: { $type: 'number', $value: 2 } } },
      ],
    })
    expect(messages(r)).toEqual(['T1013 n Token "n" is already defined in a.tokens.json.'])
  })
})

describe('aliases', () => {
  const tokens = {
    color: {
      $type: 'color',
      blue: { 500: { $value: srgb(0, 0, 1) } },
      action: { bg: { $value: '{color.blue.500}' } },
      deep: { bg: { $value: '{color.action.bg}' } },
    },
  }

  it('keeps aliases as var() in css and inlines them in resolved', () => {
    const r = build(tokens)
    const deep = r.manifest!.tokens.find((t) => t.path === 'color.deep.bg')!
    expect(deep.values.base).toEqual({
      css: 'var(--t-color-action-bg)',
      resolved: '#0000ff',
      alias: 'color.action.bg',
    })
    expect(r.css).toContain('--t-color-deep-bg: var(--t-color-action-bg);')
  })

  it('infers the type of an untyped alias from its target', () => {
    const r = build({
      a: { $type: 'number', $value: 1 },
      b: { $value: '{a}' },
    })
    expect(r.manifest!.tokens.find((t) => t.path === 'b')!.type).toBe('number')
  })

  it('suggests the closest token for an unknown reference', () => {
    const r = build({ ...tokens, bad: { $type: 'color', $value: '{color.blue.50}' } })
    expect(messages(r)).toEqual([
      'T1006 bad Unknown token "{color.blue.50}" | Did you mean "{color.blue.500}"?',
    ])
  })

  it('formats diagnostics like the compiler errors', () => {
    const r = build({ ...tokens, bad: { $type: 'color', $value: '{color.blue.50}' } })
    expect(formatDiagnostic(r.diagnostics[0]!)).toBe(
      [
        'ERROR  T1006  base.tokens.json  bad',
        '  Unknown token "{color.blue.50}"',
        '  Did you mean "{color.blue.500}"?',
        '  Run `tessera explain T1006` for details.',
      ].join('\n'),
    )
  })

  it('reports every token in a cycle', () => {
    const r = build({
      $type: 'number',
      a: { $value: '{b}' },
      b: { $value: '{c}' },
      c: { $value: '{a}' },
    })
    expect(messages(r)).toEqual([
      'T1007 a Circular reference: a -> b -> c -> a',
      'T1007 b Circular reference: a -> b -> c -> a',
      'T1007 c Circular reference: a -> b -> c -> a',
    ])
  })

  it('reports a self reference', () => {
    const r = build({ $type: 'number', a: { $value: '{a}' } })
    expect(messages(r)).toEqual(['T1007 a Circular reference: a -> a'])
  })

  it('reports an alias to a token of another type', () => {
    const r = build({
      n: { $type: 'number', $value: 1 },
      c: { $type: 'color', $value: '{n}' },
    })
    expect(messages(r)).toEqual(['T1008 c "{n}" has type "number", but "c" needs "color".'])
  })
})

describe('values', () => {
  const css = (type: string, value: unknown) => {
    const r = build({ t: { $type: type, $value: value } })
    return r.ok ? r.manifest!.tokens[0]!.values.base!.css : messages(r)[0]
  }

  it('serializes colors', () => {
    expect(css('color', srgb(1, 0, 1))).toBe('#ff00ff')
    expect(css('color', { ...srgb(0, 0, 0), alpha: 0.2 })).toBe('rgb(0 0 0 / 0.2)')
    expect(css('color', srgb(0.5, 0.5, 0.5))).toBe('rgb(127.5 127.5 127.5)')
    expect(css('color', { colorSpace: 'hsl', components: [210, 50, 40] })).toBe('hsl(210 50% 40%)')
    expect(css('color', { colorSpace: 'oklch', components: [0.7, 0.1, 'none'] })).toBe(
      'oklch(0.7 0.1 none)',
    )
    expect(css('color', { colorSpace: 'display-p3', components: [1, 0.5, 0], alpha: 0.5 })).toBe(
      'color(display-p3 1 0.5 0 / 0.5)',
    )
    expect(css('color', { colorSpace: 'srgb', components: ['none', 0, 1] })).toBe(
      'color(srgb none 0 1)',
    )
  })

  it('rejects invalid colors with specific messages', () => {
    expect(css('color', { colorSpace: 'rgb', components: [0, 0, 0] })).toMatch(
      /^T1005 t Unknown colorSpace "rgb"\. Expected one of: srgb,/,
    )
    expect(css('color', srgb(0, 0, 2))).toBe(
      'T1005 t Color component 2 (2) is outside the srgb range 0 to 1.',
    )
    expect(css('color', { colorSpace: 'hsl', components: [360, 0, 0] })).toBe(
      'T1005 t Color component 0 (360) is outside the hsl range 0 to 360 (exclusive).',
    )
    expect(css('color', { colorSpace: 'srgb', components: [0, 0] })).toBe(
      'T1005 t A color "components" value must be an array of exactly 3 numbers or "none".',
    )
    expect(css('color', { ...srgb(0, 0, 0), alpha: 2 })).toBe(
      'T1005 t Color "alpha" must be a number from 0 to 1, got 2.',
    )
    expect(css('color', { ...srgb(0, 0, 0), hex: '#fff' })).toBe(
      'T1005 t Color "hex" must be a 6-digit hex string such as "#ff00ff", got "#fff".',
    )
    expect(css('color', '#ff0000')).toBe(
      'T1005 t A color value must be an object with "colorSpace" and "components".',
    )
  })

  it('serializes dimensions, durations, numbers, weights, families, easing', () => {
    expect(css('dimension', { value: 1.5, unit: 'rem' })).toBe('1.5rem')
    expect(css('duration', { value: 200, unit: 'ms' })).toBe('200ms')
    expect(css('number', 0.4)).toBe('0.4')
    expect(css('fontWeight', 'bold')).toBe('700')
    expect(css('fontWeight', 450)).toBe('450')
    expect(css('fontFamily', ['Segoe UI', 'Inter', 'sans-serif'])).toBe(
      '"Segoe UI", Inter, sans-serif',
    )
    expect(css('cubicBezier', [0.2, 0, 0, 1])).toBe('cubic-bezier(0.2, 0, 0, 1)')
  })

  it('rejects invalid values', () => {
    expect(css('dimension', 16)).toBe(
      'T1005 t A dimension value must be an object like { "value": 16, "unit": "px" }.',
    )
    expect(css('dimension', { value: 16, unit: 'em' })).toBe(
      'T1005 t Dimension unit must be "px" or "rem", got "em".',
    )
    expect(css('duration', { value: 1, unit: 'min' })).toBe(
      'T1005 t Duration unit must be "ms" or "s", got "min".',
    )
    expect(css('number', '4')).toBe('T1005 t A number value must be a finite number, got "4".')
    expect(css('fontWeight', 'Bold')).toMatch(
      /^T1005 t fontWeight must be a number from 1 to 1000 or one of: thin,/,
    )
    expect(css('cubicBezier', [2, 0, 0, 1])).toBe(
      'T1005 t The x values (index 0 and 2) of a cubicBezier must be between 0 and 1.',
    )
  })

  it('rejects unsupported types', () => {
    expect(css('typography', {})).toBe(
      'T1004 t Unsupported $type "typography". Supported types: color, dimension, duration, number, fontFamily, fontWeight, cubicBezier, strokeStyle, shadow, border, transition.',
    )
  })

  it('serializes composites, with aliases inside them', () => {
    const r = build({
      c: { $type: 'color', $value: srgb(0, 0, 0) },
      w: { $type: 'dimension', $value: { value: 1, unit: 'px' } },
      shadow: {
        $type: 'shadow',
        $value: [
          {
            color: '{c}',
            offsetX: { value: 0, unit: 'px' },
            offsetY: { value: 2, unit: 'px' },
            blur: '{w}',
            spread: { value: 0, unit: 'px' },
            inset: true,
          },
        ],
      },
      border: { $type: 'border', $value: { color: '{c}', width: '{w}', style: 'solid' } },
      transition: {
        $type: 'transition',
        $value: {
          duration: { value: 100, unit: 'ms' },
          delay: { value: 0, unit: 'ms' },
          timingFunction: [0.2, 0, 0, 1],
        },
      },
    })
    const get = (p: string) => r.manifest!.tokens.find((t) => t.path === p)!.values.base!
    expect(get('shadow').css).toBe('inset 0px 2px var(--t-w) 0px var(--t-c)')
    expect(get('shadow').resolved).toBe('inset 0px 2px 1px 0px #000000')
    expect(get('border').css).toBe('var(--t-w) solid var(--t-c)')
    expect(get('transition').css).toBe('100ms cubic-bezier(0.2, 0, 0, 1) 0ms')
  })

  it('checks the type of aliases inside composites', () => {
    const r = build({
      n: { $type: 'number', $value: 1 },
      border: {
        $type: 'border',
        $value: { color: '{n}', width: { value: 1, unit: 'px' }, style: 'solid' },
      },
    })
    expect(messages(r)).toEqual([
      'T1008 border "{n}" has type "number", but "border" needs "color".',
    ])
  })

  it('records tiers: literal is primitive, alias to primitive is semantic, then component', () => {
    const r = build({
      $type: 'number',
      a: { $value: 1 },
      b: { $value: '{a}' },
      c: { $value: '{b}' },
      d: { $value: 2, $extensions: { tessera: { tier: 'semantic' } } },
    })
    expect(r.manifest!.tokens.map((t) => [t.path, t.tier])).toEqual([
      ['a', 'primitive'],
      ['b', 'semantic'],
      ['c', 'component'],
      ['d', 'semantic'],
    ])
  })
})

describe('themes', () => {
  const base = {
    $type: 'color',
    blue: { $value: srgb(0, 0, 1) },
    red: { $value: srgb(1, 0, 0) },
    primary: { $value: '{blue}' },
    space: { $type: 'dimension', 1: { $value: { value: 4, unit: 'px' } } },
  }

  it('emits overrides scoped to a data attribute, after the base', () => {
    const r = build(base, [
      ['dark.tokens.json', { $extends: 'base', primary: { $value: '{red}' } }],
      [
        'compact.tokens.json',
        {
          $extends: 'base',
          $attribute: 'density',
          space: { 1: { $value: { value: 2, unit: 'px' } } },
        },
      ],
    ])
    expect(r.ok).toBe(true)
    expect(r.css).toBe(`@layer tessera.reset, tessera.tokens, tessera.components, tessera.overrides;

@layer tessera.tokens {
  :where(:root) {
    --t-blue: #0000ff;
    --t-red: #ff0000;
    --t-primary: var(--t-blue);
    --t-space-1: 4px;
  }
  [data-theme="dark"] {
    --t-primary: var(--t-red);
  }
  [data-density="compact"] {
    --t-space-1: 2px;
  }
}
`)
    const primary = r.manifest!.tokens.find((t) => t.path === 'primary')!
    expect(primary.values['theme=dark']).toEqual({
      css: 'var(--t-red)',
      resolved: '#ff0000',
      alias: 'red',
    })
    expect(primary.values.base!.resolved).toBe('#0000ff')
  })

  it('lets a theme override a primitive and flow through semantic aliases', () => {
    const r = build(base, [
      ['dark.tokens.json', { $extends: 'base', blue: { $value: srgb(0, 1, 0) } }],
    ])
    const primary = r.manifest!.tokens.find((t) => t.path === 'primary')!
    expect(primary.values['theme=dark']!.resolved).toBe('#00ff00')
  })

  it('wraps overrides in a media query for auto mode', () => {
    const r = build(base, [
      [
        'dark.tokens.json',
        { $extends: 'base', $auto: 'prefers-color-scheme: dark', primary: { $value: '{red}' } },
      ],
    ])
    expect(r.css).toContain(
      `  @media (prefers-color-scheme: dark) {
    [data-theme="auto"] {
      --t-primary: var(--t-red);
    }
  }`,
    )
    expect(r.dts).toContain('"theme": "dark" | "auto"')
  })

  it('fails when a theme adds a new token name', () => {
    const r = build(base, [
      ['dark.tokens.json', { $extends: 'base', primry: { $value: srgb(1, 1, 1) } }],
    ])
    expect(r.ok).toBe(false)
    expect(r.css).toBe('')
    expect(messages(r)).toEqual([
      'T1011 primry Theme "dark" adds a new token "primry". Themes can only override values of tokens that already exist. | Did you mean "primary"?',
    ])
  })

  it('fails with a pointer to the base when a new name has no close match', () => {
    const r = build(base, [
      ['dark.tokens.json', { $extends: 'base', accent: { $type: 'color', $value: srgb(1, 1, 1) } }],
    ])
    expect(messages(r)).toEqual([
      'T1011 accent Theme "dark" adds a new token "accent". Themes can only override values of tokens that already exist. | Add "accent" to the base tokens first.',
    ])
  })

  it('fails when a theme changes a token type', () => {
    const r = build(base, [
      ['dark.tokens.json', { $extends: 'base', primary: { $type: 'number', $value: 1 } }],
    ])
    expect(messages(r)).toEqual([
      'T1012 primary Theme "dark" sets "primary" to type "number", but the base type is "color".',
    ])
  })

  it('fails when a theme value does not fit the base type', () => {
    const r = build(base, [['dark.tokens.json', { $extends: 'base', primary: { $value: 'red' } }]])
    expect(messages(r)).toEqual([
      'T1005 primary A color value must be an object with "colorSpace" and "components".',
    ])
  })

  it('fails on a missing or wrong $extends', () => {
    expect(messages(build(base, [['dark.tokens.json', {}]]))).toEqual([
      'T1010 Theme "dark" must declare "$extends": "base".',
    ])
    expect(messages(build(base, [['dark.tokens.json', { $extends: 'main' }]]))).toEqual([
      'T1010 Theme "dark" extends "main", but the base is "base". | Did you mean "base"?',
    ])
  })

  it('fails on a cycle created by a theme', () => {
    const r = build(base, [
      ['dark.tokens.json', { $extends: 'base', blue: { $value: '{primary}' } }],
    ])
    expect(messages(r)).toEqual([
      'T1007 blue Circular reference: blue -> primary -> blue',
      'T1007 primary Circular reference: blue -> primary -> blue',
    ])
  })

  it('fails on an unknown reference inside a theme, with a suggestion', () => {
    const r = build(base, [['dark.tokens.json', { $extends: 'base', primary: { $value: '{rd}' } }]])
    expect(messages(r)).toEqual(['T1006 primary Unknown token "{rd}" | Did you mean "{red}"?'])
  })

  it('fails on duplicate themes and bad theme settings', () => {
    const dup = build(base, [
      ['a/dark.tokens.json', { $extends: 'base' }],
      ['b/dark.tokens.json', { $extends: 'base' }],
    ])
    expect(messages(dup)).toEqual([
      'T1015 Theme "dark" for data-theme is already defined in a/dark.tokens.json.',
    ])
    expect(
      messages(build(base, [['dark.tokens.json', { $extends: 'base', $attribute: 'Theme' }]])),
    ).toEqual([
      'T1014 "$attribute" must be a lowercase name such as "theme" or "density", got "Theme".',
    ])
    expect(
      messages(build(base, [['dark.tokens.json', { $extends: 'base', $auto: 'dark' }]])),
    ).toEqual([
      'T1014 "$auto" must be a media feature such as "prefers-color-scheme: dark", got "dark".',
    ])
  })
})

describe('types output', () => {
  it('generates typed token paths, css variables, and theme names', () => {
    const r = build({ n: { $type: 'number', $value: 1 } }, [
      ['dark.tokens.json', { $extends: 'base', n: { $value: 2 } }],
    ])
    expect(r.dts).toBe(`// Generated by @tessera/tokens. Do not edit.

export interface TokenTypes {
  "n": "number"
}

export type TokenPath = keyof TokenTypes

export type TokenVar =
  | "--t-n"

/** Theme names per \`data-*\` attribute. */
export interface ThemeNames {
  "theme": "dark"
}
`)
  })
})
