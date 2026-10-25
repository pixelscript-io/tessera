import { JsonSyntaxError, lineTable, nearest, parseJsonc, type JsonNode } from '@tessera/contract'

/**
 * The description of an API: which endpoints it has, what each takes and what each returns. It is a small JSON file
 * beside the API (`app/apis/github.ts` and `app/apis/github.api.json`), written by hand or made by `tessera api import`
 * from an OpenAPI file. The compiler reads it to check a call (`github.get('/users/:name')`) and the fields a template
 * reads from the answer. This module is pure, so it also runs in a browser.
 */

export type ApiType =
  | { kind: 'string' | 'number' | 'boolean' | 'null' | 'unknown' | 'object' }
  | { kind: 'literal'; value: string }
  | { kind: 'array'; of: ApiType }
  | { kind: 'ref'; name: string }
  | { kind: 'union'; of: ApiType[] }
  | { kind: 'fields'; fields: Record<string, Field> }

export interface Field {
  type: ApiType
  optional: boolean
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface Endpoint {
  method: Method
  /** With `:name` for each parameter in the path: `/users/:name`. */
  path: string
  /** What the query string may have. */
  query: Record<string, Field>
  /** What a write sends. */
  body?: ApiType
  /** What the answer is. Missing when it is empty. */
  returns?: ApiType
  /** Status to what it means, for the statuses the API says it can answer with. */
  errors?: Record<string, string>
  description?: string
}

export interface ApiDescription {
  /** Where the API is. The api file's `base` is what is used; this is for the docs and for mocks. */
  base?: string
  description?: string
  /** Named types, which an endpoint refers to. */
  types: Record<string, ApiType>
  endpoints: Endpoint[]
}

export interface DescriptionDiagnostic {
  code: 'T5009'
  severity: 'error'
  file: string
  line: number
  column: number
  message: string
  hint?: string
}

/** The method each key of the file is, and the name of the call that makes it. */
export const METHODS: Readonly<Record<string, Method>> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
}

/** The call that makes each method: `del` is `DELETE`, because `delete` is reserved. */
export const METHOD_OF_VERB: Readonly<Record<string, Method>> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  del: 'DELETE',
}

const BASE_TYPES = new Set(['string', 'number', 'boolean', 'null', 'unknown', 'object'])

// --- type strings -----------------------------------------------------------------------------------

/**
 * Read a type written as a string: `string`, `number?` (a `?` at the end makes it optional), `Todo[]`,
 * `'open' | 'done'`, `string | null`. A name is a type of the description, checked later.
 */
export function parseTypeString(
  text: string,
): { type: ApiType; optional: boolean } | { error: string } {
  let source = text.trim()
  if (!source) return { error: 'A type is empty.' }
  let optional = false
  if (source.endsWith('?')) {
    optional = true
    source = source.slice(0, -1).trimEnd()
  }
  const parts: string[] = []
  let current = ''
  let quote = ''
  for (const ch of source) {
    if (quote) {
      current += ch
      if (ch === quote) quote = ''
    } else if (ch === "'") {
      quote = ch
      current += ch
    } else if (ch === '|') {
      parts.push(current.trim())
      current = ''
    } else current += ch
  }
  if (quote)
    return { error: `The text "${source.slice(source.lastIndexOf(quote))}" is not closed.` }
  parts.push(current.trim())
  const types: ApiType[] = []
  for (const part of parts) {
    if (!part) return { error: 'A type is missing after "|".' }
    const one = parseAtom(part)
    if (!one) {
      return {
        error: part.includes('[')
          ? `"${part}" is not a type. A list is written Todo[].`
          : `"${part}" is not a type.`,
      }
    }
    types.push(one)
  }
  return { type: types.length === 1 ? types[0]! : { kind: 'union', of: types }, optional }
}

function parseAtom(text: string): ApiType | undefined {
  let rest = text
  let depth = 0
  while (rest.endsWith('[]')) {
    depth++
    rest = rest.slice(0, -2)
  }
  let base: ApiType
  if (/^'[^']*'$/.test(rest)) base = { kind: 'literal', value: rest.slice(1, -1) }
  else if (BASE_TYPES.has(rest)) base = { kind: rest as 'string' }
  else if (/^[A-Za-z_][\w]*$/.test(rest)) base = { kind: 'ref', name: rest }
  else return undefined
  for (let i = 0; i < depth; i++) base = { kind: 'array', of: base }
  return base
}

/** A type the way it is written, for a message. */
export function describeType(type: ApiType): string {
  switch (type.kind) {
    case 'literal':
      return `'${type.value}'`
    case 'array':
      return `${describeType(type.of)}[]`
    case 'ref':
      return type.name
    case 'union':
      return type.of.map(describeType).join(' | ')
    case 'fields':
      return 'an object'
    default:
      return type.kind
  }
}

/** A type written out in full, objects included: `{ id: number; title: string }`. */
export function typeToText(type: ApiType): string {
  switch (type.kind) {
    case 'fields': {
      const entries = Object.entries(type.fields).map(
        ([k, f]) => `${k}${f.optional ? '?' : ''}: ${typeToText(f.type)}`,
      )
      return entries.length ? `{ ${entries.join('; ')} }` : 'object'
    }
    case 'array':
      return `${/[|{]/.test(typeToText(type.of)) ? `(${typeToText(type.of)})` : typeToText(type.of)}[]`
    case 'union':
      return type.of.map(typeToText).join(' | ')
    default:
      return describeType(type)
  }
}

// --- parsing the file -------------------------------------------------------------------------------

const TOP_KEYS = ['base', 'description', 'types', 'paths']
const ENDPOINT_KEYS = ['description', 'query', 'body', 'returns', 'errors']

/** Read and check a description. The description is returned only when there is nothing wrong with it. */
export function parseApiDescription(
  source: string,
  file: string,
): { description?: ApiDescription; diagnostics: DescriptionDiagnostic[] } {
  const position = lineTable(source)
  const diagnostics: DescriptionDiagnostic[] = []
  const report = (offset: number, message: string, hint?: string) =>
    diagnostics.push({
      code: 'T5009',
      severity: 'error',
      file,
      ...position(offset),
      message,
      ...(hint ? { hint } : {}),
    })

  let root: JsonNode
  try {
    root = parseJsonc(source)
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      report(error.offset, `This is not a valid API description: ${error.message}.`)
      return { diagnostics }
    }
    throw error
  }
  if (root.type !== 'object') {
    report(root.start, 'An API description is an object: { "paths": { ... } }.')
    return { diagnostics }
  }

  const description: ApiDescription = { types: {}, endpoints: [] }
  /** Every place a type name is used, to check it exists once all the types are known. */
  const used: Array<{ name: string; offset: number }> = []

  const typeOf = (node: JsonNode): { type: ApiType; optional: boolean } | undefined => {
    if (node.type === 'string') {
      const parsed = parseTypeString(node.value)
      if ('error' in parsed) {
        report(node.start, parsed.error)
        return undefined
      }
      collectRefs(parsed.type, node.start)
      return parsed
    }
    if (node.type === 'object')
      return { type: { kind: 'fields', fields: fieldsOf(node) }, optional: false }
    report(
      node.start,
      'A type is written as text, such as "string" or "Todo[]", or as an object of fields.',
    )
    return undefined
  }

  const collectRefs = (type: ApiType, offset: number): void => {
    if (type.kind === 'ref') used.push({ name: type.name, offset })
    else if (type.kind === 'array') collectRefs(type.of, offset)
    else if (type.kind === 'union') for (const t of type.of) collectRefs(t, offset)
  }

  const fieldsOf = (node: Extract<JsonNode, { type: 'object' }>): Record<string, Field> => {
    const fields: Record<string, Field> = {}
    for (const prop of node.props) {
      const optionalKey = prop.key.endsWith('?')
      const name = optionalKey ? prop.key.slice(0, -1) : prop.key
      const parsed = typeOf(prop.value)
      if (parsed) fields[name] = { type: parsed.type, optional: optionalKey || parsed.optional }
    }
    return fields
  }

  const unknownKey = (
    prop: { key: string; keyStart: number },
    known: string[],
    what: string,
    extra = '',
  ) => {
    const close = nearest(prop.key, known)
    const hint = [close ? `Did you mean "${close}"?` : '', extra].filter(Boolean).join(' ')
    report(prop.keyStart, `"${prop.key}" is not ${what}.`, hint || undefined)
  }

  for (const prop of root.props) {
    if (prop.key === 'base' || prop.key === 'description') {
      if (prop.value.type !== 'string') report(prop.value.start, `"${prop.key}" is text.`)
      else description[prop.key] = prop.value.value
    } else if (prop.key === 'types') {
      if (prop.value.type !== 'object') {
        report(prop.value.start, '"types" is an object of named types.')
        continue
      }
      for (const t of prop.value.props) {
        if (!/^[A-Za-z_]\w*$/.test(t.key)) {
          report(
            t.keyStart,
            `"${t.key}" cannot be the name of a type: use letters, numbers and underscores, starting with a letter.`,
          )
          continue
        }
        const parsed = typeOf(t.value)
        if (parsed) description.types[t.key] = parsed.type
      }
    } else if (prop.key === 'paths') {
      if (prop.value.type !== 'object') {
        report(prop.value.start, '"paths" is an object of paths.')
        continue
      }
      for (const path of prop.value.props) {
        if (!path.key.startsWith('/')) {
          report(path.keyStart, `The path "${path.key}" must start with "/".`)
          continue
        }
        if (path.value.type !== 'object') {
          report(path.value.start, `"${path.key}" is an object of methods, such as "get".`)
          continue
        }
        const params = new Set([...path.key.matchAll(/\/:([A-Za-z_]\w*)/g)].map((m) => m[1]!))
        for (const method of path.value.props) {
          const verb = METHODS[method.key]
          if (!verb) {
            unknownKey(
              method,
              Object.keys(METHODS),
              'a method',
              'The methods are get, post, put, patch and delete.',
            )
            continue
          }
          if (method.value.type !== 'object') {
            report(method.value.start, `"${method.key}" is an object: { "returns": "Todo" }.`)
            continue
          }
          const endpoint: Endpoint = { method: verb, path: path.key, query: {} }
          for (const part of method.value.props) {
            if (!ENDPOINT_KEYS.includes(part.key)) {
              unknownKey(part, ENDPOINT_KEYS, 'a part of an endpoint')
            } else if (part.key === 'description') {
              if (part.value.type === 'string') endpoint.description = part.value.value
            } else if (part.key === 'query') {
              if (part.value.type !== 'object')
                report(part.value.start, '"query" is an object of fields.')
              else {
                for (const field of part.value.props) {
                  const name = field.key.endsWith('?') ? field.key.slice(0, -1) : field.key
                  if (params.has(name)) {
                    report(
                      field.keyStart,
                      `"${name}" is already in the path as :${name}. A query is for what is not in the path.`,
                    )
                    continue
                  }
                  const parsed = typeOf(field.value)
                  if (parsed)
                    endpoint.query[name] = {
                      type: parsed.type,
                      optional: field.key.endsWith('?') || parsed.optional,
                    }
                }
              }
            } else if (part.key === 'errors') {
              if (part.value.type !== 'object')
                report(part.value.start, '"errors" is an object of status and text.')
              else {
                endpoint.errors = {}
                for (const e of part.value.props) {
                  endpoint.errors[e.key] = e.value.type === 'string' ? e.value.value : ''
                }
              }
            } else {
              const parsed =
                part.value.type === 'string' && part.value.value.trim() === 'none'
                  ? undefined
                  : typeOf(part.value)
              if (parsed) endpoint[part.key as 'body' | 'returns'] = parsed.type
            }
          }
          description.endpoints.push(endpoint)
        }
      }
    } else unknownKey(prop, TOP_KEYS, 'a part of an API description')
  }

  const known = Object.keys(description.types)
  for (const { name, offset } of used) {
    if (name in description.types) continue
    const close = nearest(name, known)
    report(offset, `Unknown type "${name}".`, close ? `Did you mean "${close}"?` : undefined)
  }

  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column)
  return diagnostics.length ? { diagnostics } : { description, diagnostics }
}

// --- using a description ----------------------------------------------------------------------------

/** The type a name stands for, through other names. A type that is not a name, or a name that is not known, is itself. */
export function resolveType(description: ApiDescription, type: ApiType): ApiType {
  let current = type
  for (let i = 0; i < 20 && current.kind === 'ref'; i++) {
    const next = description.types[current.name]
    if (!next) return current
    current = next
  }
  return current
}

/** One field of an object type, or undefined if the type is not an object with that field. */
export function fieldOf(
  description: ApiDescription,
  type: ApiType,
  key: string,
): Field | undefined {
  const resolved = resolveType(description, type)
  return resolved.kind === 'fields' ? resolved.fields[key] : undefined
}

export type Match =
  | { kind: 'found'; endpoint: Endpoint }
  /** The path is there, with other methods. */
  | { kind: 'method'; path: string; has: Method[] }
  | { kind: 'none'; nearest: string | undefined }
  /** A full URL: not a path of this API, so not judged. */
  | { kind: 'outside' }

const segments = (path: string) => path.split('?')[0]!.split('/').filter(Boolean)

/**
 * Which endpoint a call is for. The path of the call may name a parameter (`/users/:name`), or give a value in its place
 * (`/users/octocat`). A query string and a slash at the end do not matter.
 */
export function matchEndpoint(description: ApiDescription, method: Method, path: string): Match {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return { kind: 'outside' }
  const given = segments(path)
  const fits = (pattern: string): number => {
    const parts = segments(pattern)
    if (parts.length !== given.length) return -1
    let literal = 0
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]!.startsWith(':')) continue
      if (parts[i] !== given[i]) return -1
      literal++
    }
    return literal
  }
  let best: { endpoint: Endpoint; score: number } | undefined
  const methodsAt: Method[] = []
  let pathAt: string | undefined
  let pathScore = -1
  for (const endpoint of description.endpoints) {
    const score = fits(endpoint.path)
    if (score < 0) continue
    if (score > pathScore) {
      pathScore = score
      pathAt = endpoint.path
    }
    if (endpoint.method === method && (!best || score > best.score)) best = { endpoint, score }
  }
  if (best) return { kind: 'found', endpoint: best.endpoint }
  if (pathAt !== undefined) {
    for (const endpoint of description.endpoints)
      if (endpoint.path === pathAt && !methodsAt.includes(endpoint.method))
        methodsAt.push(endpoint.method)
    return { kind: 'method', path: pathAt, has: methodsAt }
  }
  const wanted = '/' + given.join('/')
  const paths = [...new Set(description.endpoints.map((e) => e.path))]
  return { kind: 'none', nearest: nearest(wanted, paths) }
}

// --- what changed between two descriptions -----------------------------------------------------------

export interface DescriptionChange {
  /** `breaking` if code that worked could stop working; `additive` if it is only more. */
  kind: 'breaking' | 'additive'
  text: string
}

/** What a new description changes from an old one, so an import can say what it will do. Breaking first. */
export function diffDescriptions(
  before: ApiDescription,
  after: ApiDescription,
): DescriptionChange[] {
  const out: DescriptionChange[] = []
  const key = (e: Endpoint) => `${e.method} ${e.path}`
  const was = new Map(before.endpoints.map((e) => [key(e), e]))
  const now = new Map(after.endpoints.map((e) => [key(e), e]))
  for (const [id, old] of was) {
    const next = now.get(id)
    if (!next) {
      out.push({ kind: 'breaking', text: `${id} was removed` })
      continue
    }
    for (const [name, field] of Object.entries(next.query)) {
      const had = old.query[name]
      if (!had && !field.optional) out.push({ kind: 'breaking', text: `${id} now needs "${name}"` })
      else if (!had) out.push({ kind: 'additive', text: `${id} takes "${name}"` })
      else if (had.optional && !field.optional)
        out.push({ kind: 'breaking', text: `${id} now needs "${name}"` })
    }
    for (const name of Object.keys(old.query))
      if (!(name in next.query))
        out.push({ kind: 'breaking', text: `${id} no longer takes "${name}"` })
    const a = old.returns ? typeToText(old.returns) : 'nothing'
    const b = next.returns ? typeToText(next.returns) : 'nothing'
    if (a !== b) out.push({ kind: 'breaking', text: `${id} now answers with ${b}, not ${a}` })
  }
  for (const id of now.keys())
    if (!was.has(id)) out.push({ kind: 'additive', text: `${id} is new` })
  for (const [name, type] of Object.entries(before.types)) {
    const next = after.types[name]
    if (!next) out.push({ kind: 'breaking', text: `type ${name} was removed` })
    else if (typeToText(type) !== typeToText(next))
      out.push({
        kind: 'breaking',
        text: `type ${name} changed: it was ${typeToText(type)}, now ${typeToText(next)}`,
      })
  }
  for (const name of Object.keys(after.types))
    if (!(name in before.types)) out.push({ kind: 'additive', text: `type ${name} is new` })
  return out.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'breaking' ? -1 : 1))
}
