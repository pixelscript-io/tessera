import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import {
  buildApiList,
  convertOpenApi,
  diffDescriptions,
  parseApiDescription,
  type ApiDescription,
} from '@tessera/compiler'
import type { Args } from '../args'
import { flag, has } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import { openProject } from '../project'

const forward = (p: string) => p.replaceAll('\\', '/')
const lines = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** Text as a string in a script: single-quoted when that is safe, else escaped, so nothing in it can end the string. */
// eslint-disable-next-line no-control-regex -- control characters and line separators are what must not go in single quotes
const SAFE_IN_QUOTES = /^[^'\\\u0000-\u001f\u2028\u2029]*$/
const quote = (text: string) => (SAFE_IN_QUOTES.test(text) ? `'${text}'` : JSON.stringify(text))

/** The project to write into: the one that is here, or the folder itself (a description can start a project's `app/apis`). */
async function projectRoot(io: Io, args: Args): Promise<string> {
  try {
    return (await openProject(io.cwd, args)).root
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    return resolve(
      io.cwd,
      typeof flag(args, 'root') === 'string' ? String(flag(args, 'root')) : '.',
    )
  }
}

/** The most of a description that is read from a web address: a real one is far smaller. */
const MAX_BYTES = 10 * 1024 * 1024

async function readSource(io: Io, input: string): Promise<string> {
  if (/^https?:\/\//i.test(input)) {
    try {
      const response = await fetch(input, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`the server said ${response.status}`)
      const tooBig = () => new Error('it is larger than 10 MB, which is not an API description')
      if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw tooBig()
      const reader = response.body?.getReader()
      if (!reader) return await response.text()
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_BYTES) {
          await reader.cancel()
          throw tooBig()
        }
        chunks.push(value)
      }
      return Buffer.concat(chunks).toString('utf8')
    } catch (error) {
      throw new CliError(
        `Could not read ${input}: ${error instanceof Error ? error.message : String(error)}.`,
      )
    }
  }
  const path = resolve(io.cwd, input)
  if (!existsSync(path)) throw new CliError(`There is no file "${input}".`)
  return readFileSync(path, 'utf8')
}

/** `Swagger Petstore` as `swaggerPetstore`: a name a script can use. */
function nameFromTitle(title: unknown): string {
  const words = String(title ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  const name = words
    .map((w, i) => (i === 0 ? w[0]!.toLowerCase() : w[0]!.toUpperCase()) + w.slice(1))
    .join('')
  return /^[A-Za-z]/.test(name) ? name : `api${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`
}

/**
 * `tessera api import <file or web address>`: read an OpenAPI 3 description (JSON) and write the small description the
 * compiler checks calls against, `app/apis/<name>.api.json`, with the API file beside it if there is not one. It never
 * overwrites a description without `--force`, and it says what a new import changes.
 */
export async function api(args: Args, io: Io): Promise<number> {
  const [sub, input] = args.positional
  if (sub !== 'import') {
    throw new CliError(
      sub ? `Unknown api command "${sub}".` : 'Say what to do with the APIs.',
      'Available: tessera api import <openapi.json or web address>',
    )
  }
  if (!input) {
    throw new CliError(
      'Say which OpenAPI file or web address to import.',
      'tessera api import openapi.json --name github',
    )
  }

  const text = await readSource(io, input)
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch {
    throw new CliError(
      `"${input}" is not JSON.`,
      'YAML is not read: convert it to JSON first (most API tools can export JSON).',
    )
  }
  const converted = convertOpenApi(document)
  if (!converted.ok) throw new CliError(converted.error)

  const given = flag(args, 'name')
  const name =
    typeof given === 'string'
      ? given
      : nameFromTitle((document as { info?: { title?: unknown } }).info?.title)
  const invalid = buildApiList([`${name}.ts`]).diagnostics[0]
  if (invalid) throw new CliError(invalid.message, invalid.hint)

  const content = JSON.stringify(converted.description, null, 2) + '\n'
  const check = parseApiDescription(content, `${name}.api.json`)
  if (!check.description) {
    throw new CliError(
      'The description made from this file is not valid, which is a problem in Tessera, not in your file.',
      check.diagnostics.map((d) => d.message).join(' '),
    )
  }

  const root = await projectRoot(io, args)
  const folder = join(root, 'app', 'apis')
  const descriptionPath = join(folder, `${name}.api.json`)
  const apiPath = join(folder, `${name}.ts`)
  const shown = (path: string) => forward(relative(root, path))

  if (existsSync(descriptionPath)) {
    const old = readFileSync(descriptionPath, 'utf8')
    if (old === content) {
      io.out(`${shown(descriptionPath)} is already up to date.`)
      return 0
    }
    const before = parseApiDescription(old, shown(descriptionPath)).description
    const changes = before ? diffDescriptions(before, check.description) : []
    const report = changes.map((c) => `${c.kind}  ${c.text}`).join('\n')
    if (!has(args, 'force')) {
      if (report) io.err(report)
      throw new CliError(
        `Not importing: ${shown(descriptionPath)} already exists.`,
        'Check the changes above, then replace it with --force.',
      )
    }
    if (report) io.out(report)
  }

  mkdirSync(dirname(descriptionPath), { recursive: true })
  writeFileSync(descriptionPath, content)
  const description: ApiDescription = check.description
  io.out(
    `Imported ${lines(description.endpoints.length, 'endpoint')} and ${lines(Object.keys(description.types).length, 'type')} into ${shown(descriptionPath)}.`,
  )
  if (typeof given !== 'string') io.out(`The API is called ${name}. Use --name to choose another.`)
  if (existsSync(apiPath)) io.out(`Kept ${shown(apiPath)}.`)
  else {
    const base = description.base
    writeFileSync(
      apiPath,
      `import { createApi } from '@pixelscriptio/tessera/core'\n\nexport default createApi({\n  ${
        base ? `base: ${quote(base)},` : "// base: 'https://api.example.com',"
      }\n  // headers: { authorization: 'Bearer ...' },\n})\n`,
    )
    io.out(`Wrote ${shown(apiPath)}: set its base URL and headers there.`)
  }
  if (converted.notes.length) {
    io.out(
      `${converted.notes.length} ${converted.notes.length === 1 ? 'thing was' : 'things were'} not read:`,
    )
    for (const note of converted.notes) io.out(`  ${note}`)
  }
  const first = description.endpoints.find((e) => e.method === 'GET')
  io.out(
    `Use it in a .tess script as ${name}.get('${first?.path ?? '/path'}'): calls on it are checked against the description.`,
  )
  return 0
}
