import type { InterchangeFile, TokenDiagnostic } from '@tessera/tokens'
import { CliError } from './io'

/**
 * Tokens from the styles of a Figma file. The styles are read through the REST API, which works on any plan with a link
 * and a personal access token (the Variables API needs an Enterprise plan). A style has no value of its own in the
 * file: its value is on a layer that uses it, so the layers under the linked page or frame are read and the first one
 * that uses each style gives its value. What comes out is a DTCG document, which goes through the importer every other
 * source goes through.
 */

const API = 'https://api.figma.com/v1'

type Json = Record<string, unknown>
type Fetch = typeof fetch

/** The part of a Figma layer that a style's value is read from. */
interface Layer {
  type?: string
  fills?: Paint[]
  strokes?: Paint[]
  effects?: Effect[]
  style?: TextStyle
  layoutGrids?: unknown[]
  styles?: Record<string, string>
  children?: Layer[]
}
interface Rgba {
  r: number
  g: number
  b: number
  a?: number
}
interface Paint {
  type: string
  visible?: boolean
  opacity?: number
  color?: Rgba
}
interface Effect {
  type: string
  visible?: boolean
  color?: Rgba
  offset?: { x: number; y: number }
  radius?: number
  spread?: number
}
interface TextStyle {
  fontFamily?: string
  fontWeight?: number
  fontSize?: number
  lineHeightPx?: number
  letterSpacing?: number
  textCase?: string
  textDecoration?: string
}

export type StyleType = 'FILL' | 'TEXT' | 'EFFECT' | 'GRID'

/** A style, with the layer that gives its value and how that layer uses it (`fill`, `stroke`, `text`, `effect`, `grid`). */
export interface Style {
  name: string
  type: StyleType
  use: string
  layer: Layer
}

export interface FigmaLink {
  fileKey: string
  nodeId: string
}

export const isFigmaLink = (input: string): boolean =>
  /^https?:\/\/([a-z0-9-]+\.)?figma\.com\//i.test(input)

/** The file and the page or frame a link points at. A link with no node is refused: a whole file is tens of megabytes. */
export function parseFigmaLink(input: string): FigmaLink {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new CliError(
      `"${input}" is not a link.`,
      'Use the link Figma copies for a page or a frame.',
    )
  }
  const fileKey = /\/(?:design|file|board)\/([A-Za-z0-9]+)/.exec(url.pathname)?.[1]
  const node = url.searchParams.get('node-id')
  if (!fileKey)
    throw new CliError(
      'That is not the link of a Figma file.',
      'It looks like https://www.figma.com/design/<key>/<name>?node-id=1-2',
    )
  if (!node)
    throw new CliError(
      'The link has no page or frame in it.',
      'In Figma, select the page or frame that has the styles (the Colors page, say) and use "Copy link to selection".',
    )
  return { fileKey, nodeId: node.replace('-', ':') }
}

/** The token, from the environment only. It is never written down or printed. */
export function figmaTokenFromEnv(env: Record<string, string | undefined> = process.env): string {
  const token = env.FIGMA_TOKEN
  if (!token)
    throw new CliError(
      'There is no Figma token.',
      'Make a personal access token in Figma (Settings, Security, with the "File content" read scope) and set it: export FIGMA_TOKEN=... (in PowerShell: $env:FIGMA_TOKEN = "...").',
    )
  return token
}

/** Reads a page or frame and the styles it uses. The message of a failure is Figma's own, never the token. */
export async function fetchNode(
  link: FigmaLink,
  token: string,
  fetcher: Fetch = fetch,
): Promise<{
  file: string
  root: Layer
  styles: Record<string, { name: string; styleType: string }>
}> {
  const response = await fetcher(
    `${API}/files/${link.fileKey}/nodes?ids=${encodeURIComponent(link.nodeId)}`,
    { headers: { 'X-Figma-Token': token } },
  )
  let body: Json = {}
  try {
    body = (await response.json()) as Json
  } catch {
    /* not JSON */
  }
  if (!response.ok) {
    throw new CliError(
      response.status === 403
        ? 'Figma refused the token: it may be wrong, expired, or without the "File content" read scope.'
        : response.status === 404
          ? 'Figma has no such file or node, or the token cannot see it.'
          : response.status === 429
            ? 'Figma is limiting requests. Try again in a minute.'
            : `Figma answered ${response.status}.`,
    )
  }
  const entry = (
    body.nodes as
      | Record<
          string,
          { document?: Layer; styles?: Record<string, { name: string; styleType: string }> }
        >
      | undefined
  )?.[link.nodeId]
  if (!entry?.document) throw new CliError(`The node ${link.nodeId} is not in the file.`)
  return {
    file: String(body.name ?? link.fileKey),
    root: entry.document,
    styles: entry.styles ?? {},
  }
}

const USES: Record<string, string> = {
  fill: 'fill',
  fills: 'fill',
  stroke: 'stroke',
  strokes: 'stroke',
  text: 'text',
  effect: 'effect',
  grid: 'grid',
}

/** Every style used under a layer, each with the first layer that uses it. */
export function harvestStyles(
  root: Layer,
  styles: Record<string, { name: string; styleType: string }>,
  into: Map<string, Style> = new Map(),
): { styles: Map<string, Style>; unknown: number } {
  let unknown = 0
  const seen = new Set<string>()
  const walk = (layer: Layer) => {
    for (const [key, id] of Object.entries(layer.styles ?? {})) {
      const use = USES[key]
      if (!use || into.has(id) || seen.has(id)) continue
      const style = styles[id]
      // A style from a library that is not in this file has no name here.
      if (!style) {
        seen.add(id)
        unknown++
        continue
      }
      if (!['FILL', 'TEXT', 'EFFECT', 'GRID'].includes(style.styleType)) continue
      into.set(id, { name: style.name, type: style.styleType as StyleType, use, layer })
    }
    layer.children?.forEach(walk)
  }
  walk(root)
  return { styles: into, unknown }
}

const r4 = (n: number): number => +n.toFixed(4)
const seg = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** A first segment that only names the kind of style is not part of the token's path. */
const CATEGORY: Record<string, string[]> = {
  color: ['color', 'colors', 'colour', 'colours'],
  shadow: ['shadow', 'shadows', 'effects', 'effect'],
  blur: ['blur', 'blurs'],
  font: ['font', 'fonts', 'typography', 'type'],
}

function pathOf(name: string, category: string): string[] {
  const segments = name.split('/').map(seg).filter(Boolean)
  if (segments.length > 1 && CATEGORY[category]!.includes(segments[0]!)) segments.shift()
  return segments
}

const dim = (value: number) => ({ value: r4(value), unit: 'px' })
const colorValue = (c: Rgba, opacity = 1): Json => {
  const alpha = r4((c.a ?? 1) * opacity)
  return {
    colorSpace: 'srgb',
    components: [r4(c.r), r4(c.g), r4(c.b)],
    ...(alpha < 1 ? { alpha } : {}),
  }
}

/** The document being made: tokens by path, with a path that is taken or that is both a token and a group refused. */
class Tokens {
  readonly root: Json = {}
  add(path: string[], token: Json): 'ok' | 'taken' | 'conflict' {
    let at = this.root
    for (const part of path.slice(0, -1)) {
      const next = at[part]
      if (next === undefined) at = at[part] = {}
      else if (typeof next === 'object' && next !== null && !('$value' in next)) at = next as Json
      else return 'conflict'
    }
    const last = path[path.length - 1]!
    const existing = at[last]
    if (existing === undefined) {
      at[last] = token
      return 'ok'
    }
    return typeof existing === 'object' && existing !== null && '$value' in existing
      ? 'taken'
      : 'conflict'
  }
}

export interface StylesResult {
  doc: Json
  diagnostics: TokenDiagnostic[]
  /** How many tokens each kind of style made. */
  counts: Record<string, number>
}

/** Turns styles into one DTCG document, and says what it could not turn. */
export function stylesToDtcg(styles: Style[], source: string, unknownStyles = 0): StylesResult {
  const tokens = new Tokens()
  const counts: Record<string, number> = {}
  // What was skipped, by reason: how many, and the name of the first.
  const skipped = new Map<string, { count: number; example: string }>()
  const skip = (reason: string, name: string) => {
    const was = skipped.get(reason)
    skipped.set(reason, { count: (was?.count ?? 0) + 1, example: was?.example ?? name })
  }
  const make = (kind: string, path: string[], token: Json, name: string): boolean => {
    const placed = tokens.add(path, token)
    if (placed === 'ok') {
      counts[kind] = (counts[kind] ?? 0) + 1
      return true
    }
    skip(
      placed === 'taken'
        ? 'Styles whose name makes the path of an earlier one, not imported (the earlier one is kept)'
        : 'Styles whose path is a group and a token at once, such as "Gray" and "Gray/500", not imported',
      name,
    )
    return false
  }
  const families = new Set<string>()

  for (const style of styles) {
    const { name, layer } = style

    if (style.type === 'FILL') {
      const paints =
        (style.use === 'stroke' ? layer.strokes : layer.fills)?.filter(
          (p) => p.visible !== false,
        ) ?? []
      const paint = paints[0]
      if (!paint) skip('Fill styles with no paint, not imported', name)
      else if (paints.length > 1) skip('Fill styles with more than one paint, not imported', name)
      else if (paint.type !== 'SOLID' || !paint.color)
        skip(
          /GRADIENT/.test(paint.type)
            ? 'Gradient fills, not imported (Tessera has no gradient token)'
            : `Fills that are ${paint.type.toLowerCase()} and not a color, not imported`,
          name,
        )
      else {
        const path = pathOf(name, 'color')
        if (!path.length) skip('Styles with a name that makes no path, not imported', name)
        else
          make(
            'colors',
            ['color', ...path],
            { $type: 'color', $value: colorValue(paint.color, paint.opacity ?? 1) },
            name,
          )
      }
    } else if (style.type === 'EFFECT') {
      const effects = (layer.effects ?? []).filter((e) => e.visible !== false)
      // Figma lists layers from the bottom up, CSS from the top down.
      const shadows = effects
        .filter((e) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')
        .reverse()
        .map((e) => ({
          color: colorValue(e.color ?? { r: 0, g: 0, b: 0, a: 1 }),
          offsetX: dim(e.offset?.x ?? 0),
          offsetY: dim(e.offset?.y ?? 0),
          blur: dim(e.radius ?? 0),
          spread: dim(e.spread ?? 0),
          ...(e.type === 'INNER_SHADOW' ? { inset: true } : {}),
        }))
      const blur = effects.find((e) => e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR')
      const other = effects.filter(
        (e) => !['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'].includes(e.type),
      )
      for (const e of other)
        skip(`Effects of type ${e.type.toLowerCase().replace(/_/g, ' ')}, not imported`, name)
      if (!shadows.length && !blur) {
        if (!other.length) skip('Effect styles with no visible effect, not imported', name)
        continue
      }
      if (shadows.length) {
        const path = pathOf(name, 'shadow')
        if (!path.length) skip('Styles with a name that makes no path, not imported', name)
        else make('shadows', ['shadow', ...path], { $type: 'shadow', $value: shadows }, name)
      }
      if (blur) {
        const path = pathOf(name, 'blur')
        if (!path.length) skip('Styles with a name that makes no path, not imported', name)
        else
          make(
            'blurs',
            ['blur', ...path],
            { $type: 'dimension', $value: dim(blur.radius ?? 0) },
            name,
          )
      }
    } else if (style.type === 'TEXT') {
      const t = layer.style
      const path = pathOf(name, 'font')
      if (!t || !path.length || t.fontSize === undefined) {
        skip('Text styles with no size or no name, not imported', name)
        continue
      }
      if (
        (t.textCase && t.textCase !== 'ORIGINAL') ||
        (t.textDecoration && t.textDecoration !== 'NONE')
      )
        skip(
          'Text styles imported without their text case or decoration, which are not carried',
          name,
        )
      make(
        'text styles',
        ['font', 'size', ...path],
        { $type: 'dimension', $value: dim(t.fontSize) },
        name,
      )
      if (t.fontWeight !== undefined)
        tokens.add(['font', 'weight', ...path], { $type: 'fontWeight', $value: t.fontWeight })
      if (t.lineHeightPx !== undefined)
        tokens.add(['font', 'line-height', ...path], {
          $type: 'dimension',
          $value: dim(t.lineHeightPx),
        })
      if (t.letterSpacing)
        tokens.add(['font', 'letter-spacing', ...path], {
          $type: 'dimension',
          $value: dim(t.letterSpacing),
        })
      if (t.fontFamily) families.add(t.fontFamily)
    } else {
      skip('Layout grids, not imported (they are not tokens)', name)
    }
  }
  for (const family of [...families].sort()) {
    if (
      tokens.add(['font', 'family', seg(family)], { $type: 'fontFamily', $value: family }) === 'ok'
    )
      counts['font families'] = (counts['font families'] ?? 0) + 1
  }

  const file = `figma:${source}`
  const diagnostics: TokenDiagnostic[] = [...skipped].map(([reason, { count, example }]) => ({
    code: 'T1016' as const,
    severity: 'warning' as const,
    file,
    message: `${reason}: ${count}, for example "${example}".`,
  }))
  if (unknownStyles)
    diagnostics.push({
      code: 'T1016',
      severity: 'warning',
      file,
      message: `${unknownStyles} style${unknownStyles === 1 ? '' : 's'} used here ${unknownStyles === 1 ? 'is' : 'are'} from a library and not in this file, so ${unknownStyles === 1 ? 'it has' : 'they have'} no name: not imported.`,
    })
  return {
    doc: {
      $description: `Made by \`tessera tokens import\` from the styles of the Figma file "${source}".`,
      ...tokens.root,
    },
    diagnostics,
    counts,
  }
}

/** Links to a document: reads each page or frame, and makes one DTCG file of every style under them. */
export async function tokensFromFigma(
  links: string[],
  token: string,
  fetcher: Fetch = fetch,
): Promise<{
  file: InterchangeFile
  diagnostics: TokenDiagnostic[]
  counts: Record<string, number>
}> {
  const styles = new Map<string, Style>()
  let unknown = 0
  let name = ''
  for (const link of [...new Set(links)]) {
    const got = await fetchNode(parseFigmaLink(link), token, fetcher)
    name ||= got.file
    unknown += harvestStyles(got.root, got.styles, styles).unknown
  }
  if (!styles.size)
    throw new CliError(
      'There are no styles under that link.',
      'Link to the page or frame that uses them (the Colors page, the Typography page). A value with no style in Figma is not a token here.',
    )
  const result = stylesToDtcg([...styles.values()], name, unknown)
  return {
    file: { path: 'figma.tokens.json', content: JSON.stringify(result.doc, null, 2) + '\n' },
    diagnostics: result.diagnostics,
    counts: result.counts,
  }
}
