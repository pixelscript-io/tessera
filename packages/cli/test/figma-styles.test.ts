import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTokens } from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src'
import {
  fetchNode,
  figmaTokenFromEnv,
  harvestStyles,
  isFigmaLink,
  parseFigmaLink,
  stylesToDtcg,
  tokensFromFigma,
  type Style,
} from '../src/figma-styles'
import { CliError, type Io } from '../src/io'

// Tokens from the styles of a Figma file. The fixture is real: fifteen styles of the Untitled UI file, from its Colors,
// Effect styles, Typography and Spacing pages, as the REST API gives them, trimmed to the fields the import reads.
const here = fileURLToPath(new URL('.', import.meta.url)).replaceAll('\\', '/')
const response = JSON.parse(readFileSync(`${here}fixtures/figma-styles/untitled-ui.json`, 'utf8'))
const NODE = '1:1'
const entry = response.nodes[NODE]
const LINK = 'https://www.figma.com/design/lFTS9qbiRo9UK522alLoBm/Untitled-UI?node-id=1-1&t=abc'
const SECRET = 'figd_SECRET-TOKEN-VALUE'

const scratch = mkdtempSync(
  join(fileURLToPath(new URL('..', import.meta.url)), '.test-figma-styles-'),
)
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }))
afterEach(() => vi.unstubAllGlobals())

type Doc = Record<string, any>
const at = (doc: Doc, path: string): any => path.split('.').reduce((n, k) => n?.[k], doc)
const harvested = () => {
  const h = harvestStyles(entry.document, entry.styles)
  return stylesToDtcg([...h.styles.values()], response.name, h.unknown)
}
const layer = (extra: Record<string, unknown>) => ({ type: 'RECTANGLE', ...extra })
const style = (
  name: string,
  type: Style['type'],
  use: string,
  data: Record<string, unknown>,
): Style => ({ name, type, use, layer: layer(data) as Style['layer'] })

describe('a link to a page or a frame', () => {
  it('is a Figma link, or it is not', () => {
    expect(isFigmaLink(LINK)).toBe(true)
    expect(isFigmaLink('https://figma.com/file/abc?node-id=1-2')).toBe(true)
    expect(isFigmaLink('tokens.json')).toBe(false)
    expect(isFigmaLink('https://example.com/design/abc?node-id=1-2')).toBe(false)
  })

  it('gives the file and the node, with the node as Figma writes it in its API', () => {
    expect(parseFigmaLink(LINK)).toEqual({ fileKey: 'lFTS9qbiRo9UK522alLoBm', nodeId: '1:1' })
    expect(parseFigmaLink('https://www.figma.com/file/abc123/x?node-id=1183-77')).toEqual({
      fileKey: 'abc123',
      nodeId: '1183:77',
    })
  })

  it('refuses a link with no node, because a whole file is tens of megabytes, and says how to get one', () => {
    const e = (() => {
      try {
        parseFigmaLink('https://www.figma.com/design/abc123/Name')
      } catch (error) {
        return error as CliError
      }
    })()!
    expect(e.message).toBe('The link has no page or frame in it.')
    expect(e.hint).toBe(
      'In Figma, select the page or frame that has the styles (the Colors page, say) and use "Copy link to selection".',
    )
    expect(() => parseFigmaLink('https://www.figma.com/community/plugin/1')).toThrow(
      'That is not the link of a Figma file.',
    )
  })

  it('needs the token in the environment, and says how to set it', () => {
    expect(() => figmaTokenFromEnv({})).toThrow('There is no Figma token.')
    expect(figmaTokenFromEnv({ FIGMA_TOKEN: 'x' })).toBe('x')
    try {
      figmaTokenFromEnv({})
    } catch (error) {
      expect((error as CliError).hint).toContain('export FIGMA_TOKEN=')
      expect((error as CliError).hint).toContain('$env:FIGMA_TOKEN')
    }
  })
})

describe('asking Figma', () => {
  const reply = (status: number, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('sends the token in a header and never in the address, and reads the node and its styles', async () => {
    const seen: Array<{ url: string; token: string | null }> = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      seen.push({ url, token: new Headers(init?.headers).get('x-figma-token') })
      return new Response(JSON.stringify(response))
    }) as unknown as typeof fetch
    const got = await fetchNode({ fileKey: 'k', nodeId: NODE }, SECRET, fetcher)
    expect(seen[0]!.url).toBe('https://api.figma.com/v1/files/k/nodes?ids=1%3A1')
    expect(seen[0]!.token).toBe(SECRET)
    expect(seen[0]!.url).not.toContain(SECRET)
    expect(got.file).toBe('Untitled UI – PRO STYLES (v6.0) (Copy)')
    expect(Object.keys(got.styles)).toHaveLength(15)
  })

  it('says why Figma refused, in plain words, and never prints the token', async () => {
    for (const [status, text] of [
      [
        403,
        'Figma refused the token: it may be wrong, expired, or without the "File content" read scope.',
      ],
      [404, 'Figma has no such file or node, or the token cannot see it.'],
      [429, 'Figma is limiting requests. Try again in a minute.'],
      [500, 'Figma answered 500.'],
    ] as const) {
      const e = await fetchNode({ fileKey: 'k', nodeId: NODE }, SECRET, reply(status)).catch(
        (x: CliError) => x,
      )
      expect((e as CliError).message).toBe(text)
      expect(JSON.stringify(e)).not.toContain(SECRET)
    }
    const none = await fetchNode(
      { fileKey: 'k', nodeId: '9:9' },
      SECRET,
      reply(200, response),
    ).catch((x: CliError) => x)
    expect((none as CliError).message).toBe('The node 9:9 is not in the file.')
  })

  it('says when there are no styles under the link', async () => {
    const empty = {
      name: 'f',
      nodes: { [NODE]: { document: { id: NODE, type: 'CANVAS', children: [] }, styles: {} } },
    }
    const e = await tokensFromFigma([LINK], SECRET, reply(200, empty)).catch((x: CliError) => x)
    expect((e as CliError).message).toBe('There are no styles under that link.')
    expect((e as CliError).hint).toContain('A value with no style in Figma is not a token here.')
  })
})

describe('the styles under a node', () => {
  it('gives each style the first layer that uses it, whatever the layer calls the use', () => {
    const h = harvestStyles(entry.document, entry.styles)
    expect(h.styles.size).toBe(15)
    expect(h.unknown).toBe(0)
    const white = [...h.styles.values()].find((s) => s.name === 'Base/White')!
    expect(white.type).toBe('FILL')
    expect(['fill', 'stroke']).toContain(white.use)
  })

  it('counts a style from a library that is not in this file, and leaves it out', () => {
    const root = {
      type: 'FRAME',
      styles: { fill: '5:5' },
      children: [{ type: 'RECTANGLE', styles: { fills: '1:2' } }],
    }
    const h = harvestStyles(root, { '1:2': { name: 'Gray/50', styleType: 'FILL' } })
    expect([...h.styles.values()].map((s) => s.name)).toEqual(['Gray/50'])
    expect(h.unknown).toBe(1)
  })
})

describe('the tokens a style makes', () => {
  const { doc, counts, diagnostics } = harvested()

  it('makes a color of a solid fill: the name is the path, the value is sRGB', () => {
    expect(at(doc, 'color.gray.900')).toEqual({
      $type: 'color',
      $value: { colorSpace: 'srgb', components: [0.0941, 0.1137, 0.1529] },
    })
    expect(at(doc, 'color.base.white.$value.components')).toEqual([1, 1, 1])
    expect(at(doc, 'color.brand.600.$value.components')).toEqual([0.4964, 0.3384, 0.8498])
  })

  it('makes a shadow of the layers of an effect style, from the top down', () => {
    // Figma lists them bottom up, so the style's last layer comes first.
    const sm = at(doc, 'shadow.shadow-sm.$value')
    expect(sm).toHaveLength(2)
    expect(sm.map((l: any) => [l.blur.value, l.spread.value, l.offsetY.value])).toEqual([
      [3, 0, 1],
      [2, -1, 1],
    ])
    expect(at(doc, 'shadow.shadow-xs.$value')).toHaveLength(1)
    // Inner shadows are inset.
    const skeuo = at(doc, 'shadow.shadow-xs-skeuomorphic.$value')
    expect(skeuo.filter((l: any) => l.inset)).toHaveLength(2)
    expect(at(doc, 'shadow.shadow-xs-skeuomorphic.$type')).toBe('shadow')
  })

  it('drops a first segment that only names the kind of style, and no other', () => {
    expect(at(doc, 'shadow.shadow-xs')).toBeDefined() // "Shadows/shadow-xs"
    expect(at(doc, 'shadow.focus-rings.focus-ring')).toBeDefined() // "Focus rings/focus-ring"
    expect(at(doc, 'blur.backdrop-blurs.backdrop-blur-sm.$value')).toEqual({ value: 8, unit: 'px' })
    expect(at(doc, 'blur.backdrop-blurs.backdrop-blur-sm.$type')).toBe('dimension')
  })

  it('makes a text style a size, a weight and a line height at its path (there is no composite), and a family once', () => {
    expect(at(doc, 'font.size.text-md.medium.$value')).toEqual({ value: 16, unit: 'px' })
    expect(at(doc, 'font.weight.text-md.medium')).toEqual({ $type: 'fontWeight', $value: 500 })
    expect(at(doc, 'font.weight.text-md.regular.$value')).toBe(400)
    expect(at(doc, 'font.line-height.text-md.medium.$value')).toEqual({ value: 24, unit: 'px' })
    // A letter spacing only when there is one.
    expect(at(doc, 'font.letter-spacing.display-xl.regular.$value')).toEqual({
      value: -1.2,
      unit: 'px',
    })
    expect(at(doc, 'font.letter-spacing.text-md.medium')).toBeUndefined()
    expect(at(doc, 'font.family.inter')).toEqual({ $type: 'fontFamily', $value: 'Inter' })
    expect(Object.keys(at(doc, 'font.family'))).toEqual(['inter'])
  })

  it('counts what it made, by kind', () => {
    expect(counts).toEqual({
      colors: 5,
      shadows: 4,
      blurs: 1,
      'text styles': 3,
      'font families': 1,
    })
  })

  it('says what it left out, with how many and an example, and nothing is silent', () => {
    expect(diagnostics.map((d) => d.message).sort()).toEqual([
      'Gradient fills, not imported (Tessera has no gradient token): 1, for example "Gradient/Brand/800 -> 600 (45deg)".',
      'Layout grids, not imported (they are not tokens): 1, for example "Grid mobile".',
    ])
    expect(diagnostics.every((d) => d.code === 'T1016' && d.severity === 'warning')).toBe(true)
  })
})

describe('the cases a fixture does not have', () => {
  const solid = (a = 1, opacity?: number) => ({
    fills: [
      {
        type: 'SOLID',
        color: { r: 1, g: 0, b: 0, a },
        ...(opacity === undefined ? {} : { opacity }),
      },
    ],
  })
  const make = (styles: Style[], unknown = 0) => stylesToDtcg(styles, 'f', unknown)

  it('folds the opacity of a paint into the alpha of the color', () => {
    const { doc } = make([style('Red/500', 'FILL', 'fill', solid(0.5, 0.5))])
    expect(at(doc, 'color.red.500.$value')).toEqual({
      colorSpace: 'srgb',
      components: [1, 0, 0],
      alpha: 0.25,
    })
    // A fully opaque color has no alpha.
    expect(
      at(make([style('Red/500', 'FILL', 'fill', solid())]).doc, 'color.red.500.$value'),
    ).toEqual({
      colorSpace: 'srgb',
      components: [1, 0, 0],
    })
  })

  it('reads a stroke style from the strokes of the layer, and a hidden paint is not a paint', () => {
    const stroke = style('Border/Default', 'FILL', 'stroke', {
      strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }],
    })
    expect(at(make([stroke]).doc, 'color.border.default.$type')).toBe('color')
    const hidden = style('Hidden/1', 'FILL', 'fill', {
      fills: [{ type: 'SOLID', visible: false, color: { r: 0, g: 0, b: 0 } }],
    })
    expect(make([hidden]).diagnostics[0]!.message).toBe(
      'Fill styles with no paint, not imported: 1, for example "Hidden/1".',
    )
  })

  it('leaves out a style with more than one paint, and an image, and says which', () => {
    const two = style('Two/1', 'FILL', 'fill', { fills: [...solid().fills, ...solid().fills] })
    const image = style('Photo/1', 'FILL', 'fill', { fills: [{ type: 'IMAGE' }] })
    const messages = make([two, image]).diagnostics.map((d) => d.message)
    expect(messages).toContain(
      'Fill styles with more than one paint, not imported: 1, for example "Two/1".',
    )
    expect(messages).toContain(
      'Fills that are image and not a color, not imported: 1, for example "Photo/1".',
    )
  })

  it('leaves out a hidden effect, and an effect that is not a shadow or a blur', () => {
    const shadow = {
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.1 },
      offset: { x: 0, y: 1 },
      radius: 2,
    }
    const mixed = style('Elevation/1', 'EFFECT', 'effect', {
      effects: [{ ...shadow, visible: false }, shadow, { type: 'NOISE' }],
    })
    const { doc, diagnostics } = make([mixed])
    expect(at(doc, 'shadow.elevation.1.$value')).toHaveLength(1)
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Effects of type noise, not imported: 1, for example "Elevation/1".',
    ])
  })

  it('keeps the first of two styles that make one path, and refuses a path that is a group and a token', () => {
    const a = style('Gray/500', 'FILL', 'fill', solid())
    const b = style('gray / 500', 'FILL', 'fill', solid(0.5))
    const group = style('Gray', 'FILL', 'fill', solid())
    const { doc, diagnostics } = make([a, b, group])
    expect(at(doc, 'color.gray.500.$value.alpha')).toBeUndefined()
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Styles whose name makes the path of an earlier one, not imported (the earlier one is kept): 1, for example "gray / 500".',
      'Styles whose path is a group and a token at once, such as "Gray" and "Gray/500", not imported: 1, for example "Gray".',
    ])
  })

  it('makes no path of a name that is only symbols, and keeps a lone category name as a name', () => {
    expect(make([style('///', 'FILL', 'fill', solid())]).diagnostics[0]!.message).toBe(
      'Styles with a name that makes no path, not imported: 1, for example "///".',
    )
    // "Colors" alone is a name, not a category to strip; "Colors/Gray/50" has the category stripped.
    expect(at(make([style('Colors', 'FILL', 'fill', solid())]).doc, 'color.colors.$type')).toBe(
      'color',
    )
    expect(
      at(make([style('Colors/Gray/50', 'FILL', 'fill', solid())]).doc, 'color.gray.50.$type'),
    ).toBe('color')
  })

  it('imports a text style without its case or decoration, and says so', () => {
    const upper = style('Label/Caps', 'TEXT', 'text', {
      style: {
        fontFamily: 'Space Grotesk',
        fontWeight: 700,
        fontSize: 12,
        lineHeightPx: 16,
        textCase: 'UPPER',
      },
    })
    const { doc, diagnostics } = make([upper])
    expect(at(doc, 'font.size.label.caps.$value')).toEqual({ value: 12, unit: 'px' })
    expect(at(doc, 'font.family.space-grotesk.$value')).toBe('Space Grotesk')
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Text styles imported without their text case or decoration, which are not carried: 1, for example "Label/Caps".',
    ])
  })

  it('says how many styles it could not name because they come from a library', () => {
    const { diagnostics } = make([style('Gray/50', 'FILL', 'fill', solid())], 3)
    expect(diagnostics.map((d) => d.message)).toEqual([
      '3 styles used here are from a library and not in this file, so they have no name: not imported.',
    ])
  })
})

describe('tessera tokens import <link>', () => {
  const stub = (token: { seen?: string[] } = {}) =>
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      token.seen?.push(new Headers(init?.headers).get('x-figma-token') ?? '')
      return new Response(JSON.stringify(response))
    })
  const run = async (args: string[], cwd = scratch) => {
    const out: string[] = []
    const err: string[] = []
    const io: Io = { cwd, out: (t) => void out.push(t), err: (t) => void err.push(t) }
    const code = await main(args, io)
    return { code, out: out.join('\n'), err: err.join('\n') }
  }
  const withToken = async <T>(fn: () => Promise<T>) => {
    const was = process.env.FIGMA_TOKEN
    process.env.FIGMA_TOKEN = SECRET
    try {
      return await fn()
    } finally {
      if (was === undefined) delete process.env.FIGMA_TOKEN
      else process.env.FIGMA_TOKEN = was
    }
  }

  it('reads the styles, writes one token file that builds, and says what it left out', async () => {
    const seen: string[] = []
    stub({ seen })
    const out = join(scratch, 'a')
    const r = await withToken(() => run(['tokens', 'import', LINK, '--out', out]))
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      'Read the styles under 1 Figma link: 5 colors, 3 text styles, 4 shadows, 1 blur, 1 font family.',
    )
    expect(r.out).toContain('Gradient fills, not imported (Tessera has no gradient token): 1')
    expect(r.out).toContain('Imported 1 token file and 0 themes')
    expect(seen).toEqual([SECRET])
    // What was written is a token set Tessera builds, with no error.
    const built = buildTokens(loadTokenDir(out))
    expect(built.ok).toBe(true)
    expect(built.ok && built.manifest!.tokens.map((t) => t.path)).toContain('color.gray.900')
    // The token is in no output and in no file.
    expect(r.out + r.err).not.toContain(SECRET)
    expect(readFileSync(join(out, 'figma.tokens.json'), 'utf8')).not.toContain(SECRET)
  })

  it('does not overwrite a file without --force, as every import does', async () => {
    stub()
    const out = join(scratch, 'b')
    await withToken(() => run(['tokens', 'import', LINK, '--out', out]))
    const again = await withToken(() => run(['tokens', 'import', LINK, '--out', out]))
    expect(again.code).toBe(1)
    expect(again.err).toContain('figma.tokens.json')
    expect(again.err).toContain('already exists')
    const forced = await withToken(() => run(['tokens', 'import', LINK, '--out', out, '--force']))
    expect(forced.code).toBe(0)
  })

  it('takes a link with files, and more than one link', async () => {
    stub()
    const file = join(scratch, 'own.tokens.json')
    writeFileSync(
      file,
      JSON.stringify({ space: { $type: 'dimension', 4: { $value: { value: 16, unit: 'px' } } } }),
    )
    const out = join(scratch, 'c')
    const r = await withToken(() => run(['tokens', 'import', file, LINK, LINK, '--out', out]))
    expect(r.code).toBe(0)
    // The same link twice is one read.
    expect(r.out).toContain('Read the styles under 2 Figma links')
    expect(existsSync(join(out, 'figma.tokens.json'))).toBe(true)
    expect(existsSync(join(out, 'own.tokens.json'))).toBe(true)
  })

  it('stops with a plain message when there is no token, or the link has no node, and writes nothing', async () => {
    stub()
    const out = join(scratch, 'd')
    mkdirSync(out, { recursive: true })
    const saved = process.env.FIGMA_TOKEN
    delete process.env.FIGMA_TOKEN
    try {
      const none = await run(['tokens', 'import', LINK, '--out', out])
      expect(none.code).toBe(1)
      expect(none.err).toContain('There is no Figma token.')
    } finally {
      if (saved !== undefined) process.env.FIGMA_TOKEN = saved
    }
    const noNode = await withToken(() =>
      run(['tokens', 'import', 'https://www.figma.com/design/abc123/Name', '--out', out]),
    )
    expect(noNode.code).toBe(1)
    expect(noNode.err).toContain('The link has no page or frame in it.')
    expect(existsSync(join(out, 'figma.tokens.json'))).toBe(false)
  })

  it('says Figma refused, without the token', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }))
    const r = await withToken(() => run(['tokens', 'import', LINK, '--out', join(scratch, 'e')]))
    expect(r.code).toBe(1)
    expect(r.err).toContain('Figma refused the token')
    expect(r.out + r.err).not.toContain(SECRET)
  })
})
