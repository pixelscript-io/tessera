import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildTokens,
  detectFormat,
  exportTokens,
  importTokens,
  resolverRefs,
  type BuildInput,
  type InterchangeFile,
  type TokenManifest,
} from '../src'
import { loadTokenDir } from '../src/node'

const dir = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const SYSTEM = loadTokenDir(dir('../../../system/tokens'))
const TAILWIND = loadTokenDir(dir('../../cli/templates/tailwind/system/tokens'))

const color = (r: number, g: number, b: number) => ({
  $type: 'color',
  $value: { colorSpace: 'srgb', components: [r, g, b] },
})

const manifestOf = (input: BuildInput): TokenManifest => {
  const built = buildTokens(input)
  expect(built.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return built.manifest!
}

/** What must survive a round trip: every token with its type, tier, description, aliases and values in every mode. */
const essence = (m: TokenManifest, ignoreAuto = false) => ({
  tokens: m.tokens,
  themes: m.themes.map((t) => ({
    attribute: t.attribute,
    name: t.name,
    overrides: t.overrides,
    ...(ignoreAuto ? {} : { auto: t.auto }),
  })),
})

const asInput = (r: { base: InterchangeFile[]; themes: InterchangeFile[] }): BuildInput => ({
  base: r.base.map((f) => ({ file: f.path, content: f.content })),
  themes: r.themes.map((f) => ({ file: f.path, content: f.content })),
})

describe('strict DTCG export and import', () => {
  it('writes a Resolver document with the base as a set and each attribute as a modifier', () => {
    const out = exportTokens(SYSTEM, 'dtcg')
    const resolver = JSON.parse(out.files.find((f) => f.path === 'tessera.resolver.json')!.content)
    expect(resolver.version).toBe('2025.10')
    expect(resolver.resolutionOrder).toEqual([
      { $ref: '#/sets/base' },
      { $ref: '#/modifiers/density' },
      { $ref: '#/modifiers/theme' },
    ])
    expect(Object.keys(resolver.modifiers.theme.contexts)).toEqual(['base', 'dark'])
    expect(resolver.modifiers.theme.default).toBe('base')
    expect(resolver.modifiers.theme.$extensions.tessera.auto).toEqual({
      dark: 'prefers-color-scheme: dark',
    })
    // The files it names are in the output, and the theme files have no Tessera-only root keys.
    const dark = JSON.parse(
      out.files.find((f) => f.path === 'modifiers/theme/dark.tokens.json')!.content,
    )
    expect(dark.$extends).toBeUndefined()
    expect(dark.$auto).toBeUndefined()
    expect(resolverRefs(out.files[0]!.content).sort()).toEqual(
      out.files
        .map((f) => f.path)
        .filter((p) => p !== 'tessera.resolver.json')
        .sort(),
    )
  })

  it('round-trips the repository tokens without losing aliases, units or modes', () => {
    const exported = exportTokens(SYSTEM, 'dtcg')
    const back = importTokens(exported.files)
    expect(back.diagnostics).toEqual([])
    expect(essence(manifestOf(asInput(back)))).toEqual(essence(manifestOf(SYSTEM)))
  })

  it('round-trips the full Tailwind preset (490 tokens, oklch colors, a dark theme)', () => {
    const exported = exportTokens(TAILWIND, 'dtcg')
    const back = importTokens(exported.files)
    expect(back.diagnostics).toEqual([])
    const before = manifestOf(TAILWIND)
    expect(before.tokens.length).toBeGreaterThan(400)
    expect(essence(manifestOf(asInput(back)))).toEqual(essence(before))
  })

  it('keeps aliases as aliases, never flattened', () => {
    const back = importTokens(exportTokens(SYSTEM, 'dtcg').files)
    const doc = back.base[0]!.content
    expect(doc).toContain('{color.neutral.')
  })

  it('imports a single DTCG file as the base', () => {
    const back = importTokens([
      {
        path: 'brand.json',
        content: JSON.stringify({ color: { primary: color(0, 0, 1) } }),
      },
    ])
    expect(back.base.map((f) => f.path)).toEqual(['brand.tokens.json'])
    expect(back.themes).toEqual([])
    expect(back.diagnostics).toEqual([])
  })

  it('treats the default context as the base and the others as themes', () => {
    const files: InterchangeFile[] = [
      {
        path: 'r.json',
        content: JSON.stringify({
          version: '2025.10',
          sets: { base: { sources: [{ $ref: 'a.json' }] } },
          modifiers: {
            theme: {
              contexts: { light: [{ $ref: 'light.json' }], dark: [{ $ref: 'dark.json' }] },
              default: 'light',
            },
          },
          resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
        }),
      },
      { path: 'a.json', content: JSON.stringify({ bg: color(1, 1, 1), fg: color(0, 0, 0) }) },
      { path: 'light.json', content: JSON.stringify({ bg: color(0.8, 0.8, 0.8) }) },
      { path: 'dark.json', content: JSON.stringify({ bg: color(0.2, 0.2, 0.2) }) },
    ]
    const back = importTokens(files)
    expect(back.diagnostics).toEqual([])
    expect(back.themes.map((f) => f.path)).toEqual(['themes/dark.tokens.json'])
    const m = manifestOf(asInput(back))
    const bg = m.tokens.find((t) => t.path === 'bg')!
    // The default context's value is the base value.
    expect(bg.values['base']!.css).toBe('#cccccc')
    expect(bg.values['theme=dark']!.css).toBe('#333333')
  })

  it('rejects, with T1011, a context that adds a token name', () => {
    const files: InterchangeFile[] = [
      {
        path: 'r.json',
        content: JSON.stringify({
          version: '2025.10',
          sets: { base: { sources: [{ bg: color(1, 1, 1) }] } },
          modifiers: {
            theme: {
              contexts: { dark: [{ bg: color(0, 0, 0), extra: color(0, 0, 0) }] },
              default: 'x',
            },
          },
          resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
        }),
      },
    ]
    const back = importTokens(files)
    expect(back.diagnostics.map((d) => d.code)).toContain('T1011')
  })

  it('says which file is missing when the resolver names one that was not given', () => {
    const back = importTokens([
      {
        path: 'r.json',
        content: JSON.stringify({
          version: '2025.10',
          sets: { base: { sources: [{ $ref: 'gone.json' }] } },
          resolutionOrder: [{ $ref: '#/sets/base' }],
        }),
      },
    ])
    expect(back.diagnostics[0]).toMatchObject({
      code: 'T1017',
      message: 'The resolver refers to "gone.json", which was not provided.',
    })
    expect(back.base).toEqual([])
  })
})

describe('values from earlier drafts and from tools that write strings', () => {
  const file = (tokens: object): InterchangeFile[] => [
    { path: 'old.json', content: JSON.stringify(tokens) },
  ]

  it('turns string colors, dimensions and durations into the strict forms', () => {
    const back = importTokens(
      file({
        c: { $type: 'color', $value: '#ff0000' },
        d: { $type: 'dimension', $value: '16px' },
        r: { $type: 'dimension', $value: '1.5rem' },
        t: { $type: 'duration', $value: '200ms' },
        w: { $type: 'fontWeight', $value: 'Semi Bold' },
        f: { $type: 'fontFamily', $value: 'Inter, sans-serif' },
      }),
    )
    expect(back.diagnostics).toEqual([])
    const m = manifestOf(asInput(back))
    const css = Object.fromEntries(m.tokens.map((t) => [t.path, t.values['base']!.css]))
    expect(css).toEqual({
      c: '#ff0000',
      d: '16px',
      r: '1.5rem',
      t: '200ms',
      w: '600',
      f: 'Inter, sans-serif',
    })
  })

  it('reports an assumed unit instead of guessing silently', () => {
    const back = importTokens(file({ d: { $type: 'dimension', $value: 8 } }))
    expect(back.diagnostics).toEqual([
      expect.objectContaining({
        code: 'T1016',
        severity: 'warning',
        message: 'A unitless dimension (8) was taken as 8px.',
      }),
    ])
    expect(manifestOf(asInput(back)).tokens[0]!.values['base']!.css).toBe('8px')
  })

  it('skips what Tessera cannot represent, says so, keeps it, and restores it on export', () => {
    const doc = {
      brand: color(0, 0, 1),
      fancy: {
        $type: 'gradient',
        $value: [{ color: { colorSpace: 'srgb', components: [0, 0, 0] }, position: 0 }],
      },
      onFancy: { $type: 'gradient', $value: '{fancy}' },
      heading: { $type: 'typography', $value: { fontSize: '16px' }, $description: 'Heading' },
    }
    const back = importTokens(file(doc))
    const messages = back.diagnostics.map((d) => d.message)
    expect(messages).toContain(
      'The type "gradient" is not supported. Kept in $extensions.tessera.skipped.',
    )
    expect(messages).toContain(
      'The type "typography" is not supported. Kept in $extensions.tessera.skipped.',
    )
    expect(back.diagnostics.every((d) => d.severity === 'warning')).toBe(true)
    const written = JSON.parse(back.base[0]!.content)
    expect(Object.keys(written).filter((k) => !k.startsWith('$'))).toEqual(['brand'])
    expect(written.$extensions.tessera.skipped.map((s: { path: string }) => s.path).sort()).toEqual(
      ['fancy', 'heading', 'onFancy'],
    )
    // The result still builds, and exporting it puts the skipped tokens back.
    manifestOf(asInput(back))
    const again = exportTokens(asInput(back), 'dtcg')
    const restored = JSON.parse(again.files.find((f) => f.path === 'sets/old.tokens.json')!.content)
    expect(restored.heading).toEqual({
      $type: 'typography',
      $value: { fontSize: '16px' },
      $description: 'Heading',
    })
    expect(restored.$extensions).toBeUndefined()
  })

  it('reports a file that is not a token file', () => {
    const back = importTokens([{ path: 'x.json', content: '[1]' }])
    expect(back.diagnostics[0]).toMatchObject({ code: 'T1001' })
    const broken = importTokens([{ path: 'x.json', content: '{' }])
    expect(broken.diagnostics[0]!.code).toBe('T1001')
  })
})

/** A Tokens Studio export, in its legacy format, with the quirks real files have. */
const studio = (): InterchangeFile[] => [
  {
    path: 'tokens.json',
    content: JSON.stringify({
      global: {
        spacing: {
          base: { value: '8', type: 'spacing' },
          double: { value: '{spacing.base} * 2', type: 'spacing' },
          large: { value: '$spacing.base', type: 'spacing', description: 'Legacy reference' },
        },
        'Brand Color': { 'Primary Action': { value: '#2563EB', type: 'color' } },
        radius: { md: { value: '0.5rem', type: 'borderRadius' } },
        opacity: { half: { value: '50%', type: 'opacity' } },
        font: {
          body: { value: 'Inter', type: 'fontFamilies' },
          bold: { value: 'SemiBold', type: 'fontWeights' },
          size: { value: '16', type: 'fontSizes' },
          leading: { value: '150%', type: 'lineHeights' },
        },
        elevation: {
          card: {
            value: [
              { x: '0', y: '1', blur: '3', spread: '0', color: '#00000040', type: 'dropShadow' },
              { x: '0', y: '0', blur: '2', spread: '1', color: '#ffffff', type: 'innerShadow' },
            ],
            type: 'boxShadow',
          },
        },
        heading: {
          value: { fontFamily: 'Inter', fontSize: '24' },
          type: 'typography',
        },
        action: { value: '{Brand Color.Primary Action}', type: 'color' },
      },
      light: {
        surface: { value: '#ffffff', type: 'color' },
        action: { value: '{Brand Color.Primary Action}', type: 'color' },
      },
      dark: {
        surface: { value: '#0f172a', type: 'color' },
        action: { value: '#60a5fa', type: 'color' },
      },
      $themes: [
        {
          id: 't1',
          name: 'Light',
          selectedTokenSets: { global: 'source', light: 'enabled' },
        },
        {
          id: 't2',
          name: 'Dark',
          selectedTokenSets: { global: 'source', dark: 'enabled' },
        },
      ],
      $metadata: { tokenSetOrder: ['global', 'light', 'dark'] },
    }),
  },
]

describe('the Tokens Studio adapter', () => {
  const back = importTokens(studio())
  const m = manifestOf(asInput(back))
  const css = (path: string, scope = 'base') =>
    m.tokens.find((t) => t.path === path)?.values[scope]?.css

  it('is detected from $themes and $metadata, and from the legacy { value, type } shape', () => {
    expect(detectFormat(studio())).toBe('tokens-studio')
    expect(
      detectFormat([{ path: 'a.json', content: '{"c":{"value":"#fff","type":"color"}}' }]),
    ).toBe('tokens-studio')
    expect(
      detectFormat(SYSTEM.base.map((f) => ({ path: f.file, content: String(f.content) }))),
    ).toBe('dtcg')
  })

  it('maps its types to DTCG types and its string values to strict ones', () => {
    expect(css('spacing.base')).toBe('8px')
    expect(css('radius.md')).toBe('0.5rem')
    expect(css('opacity.half')).toBe('0.5')
    expect(css('font.body')).toBe('Inter')
    expect(css('font.bold')).toBe('600')
    expect(css('font.size')).toBe('16px')
    expect(css('font.leading')).toBe('1.5')
    expect(css('elevation.card')).toBe(
      '0px 1px 3px 0px rgb(0 0 0 / 0.25098), inset 0px 0px 2px 1px #ffffff',
    )
  })

  it('rewrites names and references that are not valid custom properties', () => {
    expect(css('Brand-Color.Primary-Action')).toBe('#2563eb')
    const action = m.tokens.find((t) => t.path === 'action')!
    expect(action.values['base']!.alias).toBe('Brand-Color.Primary-Action')
    expect(
      back.diagnostics.some((d) => d.message.startsWith('Names that Tessera cannot use')),
    ).toBe(true)
  })

  it('accepts the legacy $reference form and keeps references as references', () => {
    expect(m.tokens.find((t) => t.path === 'spacing.large')!.values['base']!.alias).toBe(
      'spacing.base',
    )
  })

  it('skips a math expression and a typography composite, and says so', () => {
    expect(css('spacing.double')).toBeUndefined()
    expect(css('heading')).toBeUndefined()
    const messages = back.diagnostics.map((d) => `${d.path}: ${d.message}`)
    expect(messages).toContain(
      'spacing.double: The dimension value "{spacing.base} * 2" cannot be expressed as a strict DTCG value. Kept in $extensions.tessera.skipped.',
    )
    expect(messages).toContain(
      'heading: The type "typography" is not supported. Kept in $extensions.tessera.skipped.',
    )
  })

  it('makes sets only some themes use into themes, and a set every theme uses into the base', () => {
    expect(m.themes.map((t) => `${t.attribute}=${t.name}`)).toEqual(['theme=light', 'theme=dark'])
    expect(css('action', 'theme=dark')).toBe('#60a5fa')
  })

  it('adds a token that exists only in theme sets to the base, from the first theme, and says so', () => {
    expect(css('surface')).toBe('#ffffff')
    expect(css('surface', 'theme=dark')).toBe('#0f172a')
    expect(back.diagnostics.map((d) => d.message)).toContain(
      '1 tokens exist only in theme sets (surface). Tessera themes override values and cannot add tokens, so they were added to the base with the value from the first theme that defines them.',
    )
  })

  it('reads the multi-file layout with $themes.json and $metadata.json', () => {
    const files: InterchangeFile[] = [
      { path: '$metadata.json', content: JSON.stringify({ tokenSetOrder: ['core', 'dark'] }) },
      {
        path: '$themes.json',
        content: JSON.stringify([
          {
            id: 'a',
            name: 'density=compact',
            selectedTokenSets: { core: 'source', dark: 'enabled' },
          },
        ]),
      },
      { path: 'core.json', content: JSON.stringify({ gap: { value: '8', type: 'spacing' } }) },
      { path: 'dark.json', content: JSON.stringify({ gap: { value: '4', type: 'spacing' } }) },
    ]
    const r = importTokens(files)
    const built = manifestOf(asInput(r))
    expect(built.themes.map((t) => `${t.attribute}=${t.name}`)).toEqual(['density=compact'])
    expect(built.tokens[0]!.values['density=compact']!.css).toBe('4px')
  })
})

/** Hex is 8 bits per channel, so a color with finer components comes back as the nearest hex: compare at that precision. */
const atHexPrecision = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value).replace(/rgb\(([\d. ]+)\)/g, (_, c: string) => {
      const [r, g, b] = c.split(' ').map((n) => Math.round(Number(n)))
      return '#' + [r, g, b].map((n) => n!.toString(16).padStart(2, '0')).join('')
    }),
  )

describe('Tokens Studio export', () => {
  it('writes a set per file, $themes.json and $metadata.json, with string values', () => {
    const out = exportTokens(SYSTEM, 'tokens-studio')
    const names = out.files.map((f) => f.path)
    expect(names).toContain('$themes.json')
    expect(names).toContain('$metadata.json')
    const themes = JSON.parse(out.files.find((f) => f.path === '$themes.json')!.content)
    expect(themes.map((t: { name: string }) => t.name)).toEqual(['density=compact', 'dark'])
    const base = JSON.parse(out.files.find((f) => f.path === 'base.json')!.content)
    expect(base.space['4'].$value).toBe('16px')
    expect(base.color.neutral['0'].$value).toBe('#ffffff')
    // The automatic dark mode has no Tokens Studio equivalent, and the export says so.
    expect(out.diagnostics.map((d) => d.message)).toEqual([
      'Tokens Studio has no equivalent of "$auto" (dark: prefers-color-scheme: dark), so automatic switching is not exported.',
    ])
  })

  it('round-trips the repository tokens back through the adapter', () => {
    const back = importTokens(exportTokens(SYSTEM, 'tokens-studio').files)
    expect(back.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(atHexPrecision(essence(manifestOf(asInput(back)), true).tokens)).toEqual(
      atHexPrecision(essence(manifestOf(SYSTEM), true).tokens),
    )
    expect(
      essence(manifestOf(asInput(back)), true)
        .themes.map((t) => `${t.attribute}=${t.name}`)
        .sort(),
    ).toEqual(['density=compact', 'theme=dark'])
  })
})
