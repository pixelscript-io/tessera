import { FigmaError, type ComponentSetFile, type FigmaNode } from './model'

const API = 'https://api.figma.com/v1'

/** What `tessera figma import` needs to say where the component set is. */
export interface Source {
  fileKey: string
  /** The node to read: the page, or the component set itself. */
  nodeId: string
}

/** A Figma link, or a file key and a node, as a place to read from. */
export function parseSource(url: string | undefined, file?: string, node?: string): Source {
  if (url) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new FigmaError(
        'F011',
        `"${url}" is not a link.`,
        'Use the link Figma copies for a frame.',
      )
    }
    const key = /\/(?:design|file)\/([A-Za-z0-9]+)/.exec(parsed.pathname)?.[1]
    const id = parsed.searchParams.get('node-id')
    if (!key || !id)
      throw new FigmaError(
        'F011',
        'The link has no file or no node in it.',
        'In Figma, select the page or the component set and use "Copy link to selection".',
      )
    return { fileKey: key, nodeId: id.replace('-', ':') }
  }
  if (file && node) return { fileKey: file, nodeId: node.replace('-', ':') }
  throw new FigmaError(
    'F011',
    'Say where the component is: --url <link>, or --file <key> and --node <id>, or --from-json <file>.',
  )
}

/** The token, from the environment only. It is never written down or printed. */
export function tokenFromEnv(env: Record<string, string | undefined> = process.env): string {
  const token = env.FIGMA_TOKEN
  if (!token)
    throw new FigmaError(
      'F010',
      'There is no Figma token.',
      'Make a personal access token in Figma (Settings, Security, with the "File content" read scope) and set it: export FIGMA_TOKEN=...',
    )
  return token
}

type Fetch = typeof fetch

async function getJson(fetcher: Fetch, token: string, path: string): Promise<Record<string, any>> {
  const response = await fetcher(`${API}${path}`, { headers: { 'X-Figma-Token': token } })
  let body: Record<string, any> = {}
  try {
    body = (await response.json()) as Record<string, any>
  } catch {
    /* not JSON */
  }
  if (!response.ok) {
    // The message is Figma's own; the token is never part of it.
    const why =
      response.status === 403
        ? 'Figma refused the token: it may be wrong, expired, or without the "File content" read scope.'
        : response.status === 404
          ? 'Figma has no such file or node, or the token cannot see it.'
          : `Figma answered ${response.status}${body.err ? `: ${String(body.err)}` : body.message ? `: ${String(body.message)}` : ''}.`
    throw new FigmaError('F012', why)
  }
  return body
}

const find = (node: FigmaNode, test: (n: FigmaNode) => boolean): FigmaNode | undefined =>
  test(node) ? node : (node.children ?? []).map((c) => find(c, test)).find(Boolean)

/** Reads the component set called `name` from a page (or the set itself), with the styles it uses. */
export async function fetchComponentSet(
  source: Source,
  name: string,
  token: string,
  fetcher: Fetch = fetch,
): Promise<ComponentSetFile> {
  const body = await getJson(
    fetcher,
    token,
    `/files/${source.fileKey}/nodes?ids=${encodeURIComponent(source.nodeId)}`,
  )
  const entry = body.nodes?.[source.nodeId]
  if (!entry?.document)
    throw new FigmaError('F013', `The node ${source.nodeId} is not in the file.`)
  const set = find(
    entry.document as FigmaNode,
    (n) => n.type === 'COMPONENT_SET' && n.name === name,
  )
  if (!set)
    throw new FigmaError(
      'F002',
      `There is no component set called "${name}" at ${source.nodeId}.`,
      'The map\'s "component" must be the name of the set in Figma.',
    )
  const used = new Set<string>()
  const walk = (n: FigmaNode) => {
    for (const id of Object.values(n.styles ?? {})) used.add(id)
    n.children?.forEach(walk)
  }
  walk(set)
  const styles: ComponentSetFile['styles'] = {}
  for (const id of used) {
    const style = entry.styles?.[id]
    if (style) styles[id] = { name: style.name, styleType: style.styleType }
  }
  return { file: body.name, fileKey: source.fileKey, page: entry.document.name, set, styles }
}

/** Figma's own picture of each variant, at twice the size. Returns the PNG bytes by node id. */
export async function fetchImages(
  fileKey: string,
  ids: string[],
  token: string,
  fetcher: Fetch = fetch,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>()
  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40)
    const body = await getJson(
      fetcher,
      token,
      `/images/${fileKey}?ids=${encodeURIComponent(batch.join(','))}&format=png&scale=2`,
    )
    for (const id of batch) {
      const url = body.images?.[id] as string | undefined
      if (!url) continue
      const response = await fetcher(url)
      if (response.ok) out.set(id, new Uint8Array(await response.arrayBuffer()))
    }
  }
  return out
}
