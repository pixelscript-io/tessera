import { resolverRefs, type InterchangeFile } from '@tessera/tokens'
import { CliError } from './io'

/**
 * Token files from an address: a file at any https address, or a file or folder in a GitHub repository (by the
 * address of its page, or its raw address). Read-only and bounded: https only, no private or local hosts, a size and
 * count limit, and redirects checked at every hop. A `GITHUB_TOKEN` is sent only to GitHub's own hosts, for a private
 * repository, and is never printed or written.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const MAX_BYTES = 2_000_000
const MAX_FILES = 50
const MAX_REQUESTS = 80
const MAX_REDIRECTS = 3
const MAX_DEPTH = 3
const TIMEOUT_MS = 15_000

const TOKEN_FILE = /\.(json|css)$/i
/** Files that sit in repositories and are not tokens. */
const NOT_TOKENS =
  /^(package(-lock)?|tsconfig(\..+)?|jsconfig|composer|manifest|\.eslintrc|\.prettierrc|renovate|deno|bower|lerna|nx|turbo|vercel|netlify)\.json$/i
const GITHUB_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com'])

/** Is this input an address (or a GitHub path) rather than a file on disk? Figma links are checked before this. */
export function isRemoteSource(input: string): boolean {
  return (
    /^https?:\/\//i.test(input) ||
    /^(www\.)?github\.com\//i.test(input) ||
    /^raw\.githubusercontent\.com\//i.test(input)
  )
}

/** A host that is on the public internet by name: no IP address, `localhost` or internal name. */
function publicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (!h || h.includes(':') || h.startsWith('[')) return false
  if (/^\d+(\.\d+){0,3}$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return false
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h))
    return false
  return h.includes('.')
}

function parseAddress(input: string): URL {
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    throw new CliError(`"${input}" is not an address.`)
  }
  if (url.protocol !== 'https:') {
    throw new CliError(
      `Only https addresses are read: "${input}".`,
      'Use the https:// address of the file.',
    )
  }
  if (url.username || url.password) {
    throw new CliError(
      'An address with a user name or password in it is not read.',
      'Use GITHUB_TOKEN for a private repository.',
    )
  }
  if (!publicHost(url.hostname)) {
    throw new CliError(
      `"${url.hostname}" is not a public host name, so it is not read.`,
      'Download the file and import it from disk.',
    )
  }
  return url
}

interface Context {
  fetcher: Fetch
  githubToken: string | undefined
  requests: number
}

/** One bounded request: checked host, a limited number of redirects (each checked), a timeout, a size limit. */
async function get(
  url: URL,
  context: Context,
  accept?: string,
): Promise<{ text: string; url: URL }> {
  let current = url
  for (let hops = 0; ; hops++) {
    if (++context.requests > MAX_REQUESTS) throw new CliError('Too many requests for one import.')
    if (current.protocol !== 'https:' || !publicHost(current.hostname)) {
      throw new CliError(`A redirect led to "${current.href}", which is not read.`)
    }
    const headers: Record<string, string> = { 'User-Agent': 'tessera' }
    if (accept) headers.Accept = accept
    if (context.githubToken && GITHUB_HOSTS.has(current.hostname)) {
      headers.Authorization = `Bearer ${context.githubToken}`
    }
    let response: Response
    try {
      response = await context.fetcher(current.href, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'did not answer in time'
          : 'could not be reached'
      throw new CliError(`${current.hostname} ${reason}.`)
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || hops >= MAX_REDIRECTS)
        throw new CliError(`${current.href} redirects too many times.`)
      current = new URL(location, current)
      continue
    }
    if (!response.ok) {
      throw new CliError(
        response.status === 404
          ? `${current.href} was not found.`
          : response.status === 401 || response.status === 403
            ? `${current.hostname} refused the request (${response.status}).`
            : `${current.hostname} answered ${response.status}.`,
        response.status === 404 || response.status === 403
          ? 'If the repository is private, set GITHUB_TOKEN to a token that can read it.'
          : undefined,
      )
    }
    return { text: await readLimited(response, current), url: current }
  }
}

async function readLimited(response: Response, url: URL): Promise<string> {
  const tooBig = () =>
    new CliError(`${url.href} is larger than ${MAX_BYTES / 1_000_000} MB, so it is not read.`)
  const declared = Number(response.headers.get('content-length'))
  if (declared > MAX_BYTES) throw tooBig()
  if (!response.body) {
    const text = await response.text()
    if (text.length > MAX_BYTES) throw tooBig()
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw tooBig()
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** A file's text as a token file: named by its address, typed JSON or CSS by its name or what it holds. */
function asFile(name: string, text: string, url: URL): InterchangeFile {
  const trimmed = text.trimStart()
  if (/^<(!doctype|html)/i.test(trimmed)) {
    throw new CliError(
      `${url.href} is a web page, not a token file.`,
      'For a file on GitHub, use the address of the file (github.com/owner/repo/blob/branch/path), or open it raw.',
    )
  }
  const named = TOKEN_FILE.test(name)
    ? name
    : `${name || 'tokens'}${trimmed.startsWith('{') ? '.json' : '.css'}`
  return { path: named, content: text }
}

const baseName = (url: URL): string =>
  decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')

interface Repo {
  owner: string
  repo: string
  ref: string
  path: string
}

/** The repository, branch and path of a github.com page address, and whether it names a folder. */
function githubTarget(url: URL): { repo: Repo; folder: boolean } | undefined {
  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return undefined
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const [owner, repo, kind, ref, ...path] = parts
  if (!owner || !repo || ((kind === 'blob' || kind === 'raw') && !path.length)) {
    throw new CliError(
      `"${url.href}" does not name a file or folder.`,
      'Use a file or folder in the repository, for example https://github.com/owner/repo/blob/main/tokens.css or .../tree/main/tokens.',
    )
  }
  if (kind === 'blob' || kind === 'raw')
    return { repo: { owner, repo, ref: ref!, path: path.join('/') }, folder: false }
  if (kind === 'tree' && ref)
    return { repo: { owner, repo, ref, path: path.join('/') }, folder: true }
  throw new CliError(
    `"${url.href}" is a repository, not a file or folder.`,
    'Use a file or folder in it, for example https://github.com/owner/repo/blob/main/tokens.css or .../tree/main/tokens.',
  )
}

const rawUrl = ({ owner, repo, ref, path }: Repo): URL =>
  new URL(
    `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`,
  )

/** The token files in a folder of a repository, and in the folders below it (three levels), by GitHub's own listing. */
async function listFolder(repo: Repo, context: Context): Promise<InterchangeFile[]> {
  const files: InterchangeFile[] = []
  const root = repo.path
  const visit = async (path: string, depth: number): Promise<void> => {
    const api = new URL(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`,
    )
    api.searchParams.set('ref', repo.ref)
    const { text } = await get(api, context, 'application/vnd.github+json')
    let entries: unknown
    try {
      entries = JSON.parse(text)
    } catch {
      entries = undefined
    }
    if (!Array.isArray(entries))
      throw new CliError(`${path || 'The repository'} is not a folder on GitHub.`)
    for (const entry of entries as Array<{ type?: string; name?: string; path?: string }>) {
      if (typeof entry.name !== 'string' || typeof entry.path !== 'string') continue
      if (
        entry.type === 'dir' &&
        depth < MAX_DEPTH &&
        entry.name !== 'node_modules' &&
        !entry.name.startsWith('.')
      ) {
        await visit(entry.path, depth + 1)
      } else if (
        entry.type === 'file' &&
        TOKEN_FILE.test(entry.name) &&
        !NOT_TOKENS.test(entry.name)
      ) {
        if (files.length >= MAX_FILES)
          throw new CliError(
            `More than ${MAX_FILES} files in the folder.`,
            'Name a smaller folder, or one file.',
          )
        const address = rawUrl({ ...repo, path: entry.path })
        const got = await get(address, context)
        files.push({
          path: entry.path.slice(root ? root.length + 1 : 0),
          content: asFile(entry.name, got.text, address).content,
        })
      }
    }
  }
  await visit(root, 0)
  if (!files.length)
    throw new CliError(`There are no .json or .css files in ${root || 'the repository'}.`)
  return files
}

/** A Resolver document names the files it combines: fetch those that are beside it or below it. */
async function followRefs(
  file: InterchangeFile,
  address: URL,
  context: Context,
  into: InterchangeFile[],
): Promise<void> {
  const dir = new URL('.', address)
  for (const ref of resolverRefs(file.content)) {
    const target = new URL(ref, address)
    // Only beside the Resolver or below it, on the same host: a downloaded document must not point elsewhere.
    if (target.origin !== dir.origin || !target.pathname.startsWith(dir.pathname)) continue
    const relative = decodeURIComponent(target.pathname.slice(dir.pathname.length))
    if (into.some((f) => f.path === relative)) continue
    const got = await get(target, context)
    into.push({ path: relative, content: got.text })
  }
}

export interface Fetched {
  files: InterchangeFile[]
  /** One line for the report: how many files came from how many addresses. */
  summary: string
}

/** Reads each address into token files. Names are kept unique, so two `tokens.json` from different places both come in. */
export async function fetchSources(
  sources: string[],
  options: { fetcher?: Fetch; githubToken?: string } = {},
): Promise<Fetched> {
  const context: Context = {
    fetcher: options.fetcher ?? fetch,
    githubToken: options.githubToken || undefined,
    requests: 0,
  }
  const files: InterchangeFile[] = []
  const add = (list: InterchangeFile[], prefix = '') => {
    for (const f of list) {
      let path = prefix + f.path
      for (let n = 2; files.some((x) => x.path === path); n++) path = `${prefix}${n}-${f.path}`
      files.push({ path, content: f.content })
    }
  }
  for (const source of sources) {
    const url = parseAddress(source)
    const github = githubTarget(url)
    if (github?.folder) {
      add(await listFolder(github.repo, context))
      continue
    }
    const address = github ? rawUrl(github.repo) : url
    const got = await get(address, context)
    const file = asFile(baseName(address), got.text, address)
    const group = [file]
    await followRefs(file, got.url, context, group)
    add(group)
  }
  const n = files.length
  return {
    files,
    summary: `Read ${n} file${n === 1 ? '' : 's'} from ${sources.length} address${sources.length === 1 ? '' : 'es'}.`,
  }
}
