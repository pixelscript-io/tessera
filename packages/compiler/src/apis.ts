/**
 * The apis of a project: a script file in `app/apis` is an API, named after the file (`github.ts` is `github`), and a
 * `.tess` script can use that name without importing it. This is pure, so it also runs in a browser: reading the folder
 * is the caller's job (`loadProjectApis` in `@tessera/compiler/node`).
 */

import type { ApiDescription, ApiType, Endpoint } from './api-description'

/** An api that a script may name: its name, and the file whose default export is the api. */
export interface ProjectApi {
  name: string
  /** Absolute path. */
  file: string
  /** What the API has and takes, from the file beside it (`github.api.json`), if there is one. */
  description?: ApiDescription
}

export interface ApiDiagnostic {
  code: 'T5005'
  severity: 'error'
  /** The file, as the project shows it (`app/apis/my-api.ts`). */
  file: string
  line: number
  column: number
  message: string
  hint?: string
}

/** The names that mean `get('/x')` and the rest, which an api cannot take. */
export const DATA_APIS = ['get', 'post', 'put', 'patch', 'del'] as const

/** The one api that `get`, `post` and the rest use when a project has it. */
export const DEFAULT_API = 'default'

/** Names Tessera already gives a script, which an api could only hide. */
const TAKEN = new Set([
  'state',
  'derived',
  'effect',
  'onCleanup',
  'onMount',
  'navigate',
  'useRoute',
  'props',
  'emit',
  ...DATA_APIS,
])

const RESERVED = new Set(
  (
    'break case catch class const continue debugger delete do else enum export extends false finally for function ' +
    'if import in instanceof new null return super switch this throw true try typeof var void while with yield let ' +
    'static await implements interface package private protected public undefined NaN Infinity arguments eval'
  ).split(' '),
)

const SCRIPT_FILE = /\.(?:ts|js|mts|mjs)$/
/** Declarations, tests and descriptions that sit beside an api and are not one. */
const NOT_AN_API = /\.(?:d|test|spec)\.(?:ts|js|mts|mjs)$/

const normalize = (path: string) => path.replaceAll('\\', '/')

/**
 * The apis in a folder, from the paths of its files. A file that is not a script, or is a declaration, a test or a
 * description, is not an api. A file whose name a script cannot use gets a diagnostic, and is left out.
 */
export function buildApiList(
  files: string[],
  display: (file: string) => string = (f) => f,
): { apis: ProjectApi[]; diagnostics: ApiDiagnostic[] } {
  const apis: ProjectApi[] = []
  const diagnostics: ApiDiagnostic[] = []
  const sorted = [...files].map(normalize).sort((a, b) => a.localeCompare(b))
  for (const file of sorted) {
    const base = file.split('/').pop()!
    if (!SCRIPT_FILE.test(base) || NOT_AN_API.test(base)) continue
    const name = base.replace(SCRIPT_FILE, '')
    const why =
      !/^[A-Za-z_$][\w$]*$/.test(name) || (RESERVED.has(name) && name !== DEFAULT_API)
        ? 'it is not a name a script can use'
        : TAKEN.has(name)
          ? 'Tessera already uses it'
          : undefined
    if (why) {
      diagnostics.push({
        code: 'T5005',
        severity: 'error',
        file: display(file),
        line: 1,
        column: 1,
        message: `"${name}" cannot be the name of an api: ${why}.`,
        hint: 'Rename the file to letters, numbers and underscores, starting with a letter, such as github.ts.',
      })
      continue
    }
    apis.push({ name, file })
  }
  return { apis, diagnostics }
}

// --- types ------------------------------------------------------------------------------------------

const typeText = (type: ApiType, indent: string): string => {
  switch (type.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'unknown':
      return type.kind
    case 'object':
      return 'Record<string, unknown>'
    case 'literal':
      return `'${type.value}'`
    case 'ref':
      return type.name
    case 'array': {
      const inner = typeText(type.of, indent)
      return /[|{]/.test(inner) ? `Array<${inner}>` : `${inner}[]`
    }
    case 'union':
      return type.of.map((t) => typeText(t, indent)).join(' | ')
    case 'fields': {
      const entries = Object.entries(type.fields).map(
        ([key, f]) => `${key}${f.optional ? '?' : ''}: ${typeText(f.type, indent)}`,
      )
      return entries.length ? `{ ${entries.join('; ')} }` : 'Record<string, unknown>'
    }
  }
}

const endpointText = (endpoint: Endpoint): string => {
  const parts: string[] = []
  const query = Object.entries(endpoint.query).map(
    ([key, f]) => `${key}${f.optional ? '?' : ''}: ${typeText(f.type, '')}`,
  )
  if (query.length) parts.push(`query: { ${query.join('; ')} }`)
  if (endpoint.body) parts.push(`body: ${typeText(endpoint.body, '')}`)
  parts.push(`returns: ${endpoint.returns ? typeText(endpoint.returns, '') : 'void'}`)
  return `{ ${parts.join('; ')} }`
}

const RESERVED_WORDS = new Set([
  'default',
  'delete',
  'new',
  'class',
  'function',
  'import',
  'export',
  'var',
])

/**
 * `.tessera/apis.d.ts`: the types of each described API, in a namespace named after it
 * (`TesseraApis.github.User`), and its endpoints by method and path. A call can name them:
 * `github.get<TesseraApis.github.User>('/users/:name', { name })`. A name that is a reserved word gets an underscore:
 * the default API's types are `TesseraApis._default.Device`.
 */
export function generateApisDts(apis: readonly ProjectApi[]): string {
  // The API every project starts with is named `default`, which TypeScript does not accept as a namespace name.
  const namespaceOf = (name: string) => (RESERVED_WORDS.has(name) ? `_${name}` : name)
  const lines = ['// Generated by Tessera. Do not edit.', '', 'declare namespace TesseraApis {']
  for (const api of apis) {
    const d = api.description
    if (!d) continue
    lines.push(`  namespace ${namespaceOf(api.name)} {`)
    for (const [name, type] of Object.entries(d.types)) {
      if (type.kind === 'fields') {
        lines.push(`    interface ${name} {`)
        for (const [key, f] of Object.entries(type.fields))
          lines.push(`      ${key}${f.optional ? '?' : ''}: ${typeText(f.type, '      ')}`)
        lines.push('    }')
      } else lines.push(`    type ${name} = ${typeText(type, '    ')}`)
    }
    lines.push(
      '    /** Each endpoint of the API: what it takes and what it answers with. */',
      '    interface Endpoints {',
    )
    for (const e of d.endpoints) lines.push(`      '${e.method} ${e.path}': ${endpointText(e)}`)
    lines.push('    }', '  }')
  }
  lines.push('}', '')
  return lines.join('\n')
}
