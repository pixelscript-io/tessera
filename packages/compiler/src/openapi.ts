/**
 * OpenAPI 3 into the small description format (`app/apis/github.api.json`). It reads the part of OpenAPI that a call
 * needs: paths and methods, query parameters, a JSON body, the first successful JSON answer, the statuses that can go
 * wrong, and the named schemas. What it does not read (`oneOf`, `anyOf`, a body that is not JSON) it says, and types
 * as `unknown`. This is pure, so it also runs in a browser.
 */

type Json = any

/** A type as the small format writes it: text, or an object of fields. */
export type TypeJson = string | { [field: string]: TypeJson }

export interface EndpointJson {
  query?: Record<string, TypeJson>
  body?: TypeJson
  returns?: TypeJson
  errors?: Record<string, string>
  description?: string
}

export interface DescriptionJson {
  base?: string
  description?: string
  types: Record<string, TypeJson>
  paths: Record<string, Record<string, EndpointJson>>
}

export type OpenApiResult =
  { ok: true; description: DescriptionJson; notes: string[] } | { ok: false; error: string }

const METHODS = ['get', 'post', 'put', 'patch', 'delete']

const isObject = (value: unknown): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pascal = (text: string) =>
  text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('')

export function convertOpenApi(document: unknown): OpenApiResult {
  if (!isObject(document))
    return { ok: false, error: 'This is not an OpenAPI description: it is not an object.' }
  if (typeof document.swagger === 'string')
    return {
      ok: false,
      error: `This is Swagger ${document.swagger}. Only OpenAPI 3 is read: convert it first (the Swagger editor does it).`,
    }
  if (typeof document.openapi !== 'string' || !document.openapi.startsWith('3'))
    return { ok: false, error: 'This is not an OpenAPI description: it has no "openapi" version.' }

  const notes: string[] = []
  const types: Record<string, TypeJson> = {}
  const schemas: Record<string, Json> = document.components?.schemas ?? {}
  /** What is being converted, to say where a note is from. */
  let where = ''
  const note = (text: string) => notes.push(where ? `${where}: ${text}` : text)

  /** Follow a `#/components/...` reference. */
  const follow = (value: Json): Json => {
    for (let i = 0; i < 10 && isObject(value) && typeof value.$ref === 'string'; i++) {
      const match = /^#\/components\/([A-Za-z]+)\/(.+)$/.exec(value.$ref)
      const target = match ? document.components?.[match[1]!]?.[match[2]!] : undefined
      if (target === undefined) return value
      value = target
    }
    return value
  }

  const refName = (value: Json): string | undefined =>
    typeof value?.$ref === 'string'
      ? /^#\/components\/schemas\/(.+)$/.exec(value.$ref)?.[1]
      : undefined

  /** The properties of an object schema, with what it takes from the schemas it is made of (`allOf`). */
  const objectParts = (
    schema: Json,
    depth = 0,
  ): { properties: Record<string, Json>; required: Set<string> } | undefined => {
    const resolved = follow(schema)
    if (!isObject(resolved) || depth > 10) return undefined
    const properties: Record<string, Json> = {}
    const required = new Set<string>(Array.isArray(resolved.required) ? resolved.required : [])
    if (Array.isArray(resolved.allOf)) {
      for (const part of resolved.allOf) {
        const inner = objectParts(part, depth + 1)
        if (!inner) return undefined
        Object.assign(properties, inner.properties)
        for (const r of inner.required) required.add(r)
      }
    }
    if (isObject(resolved.properties)) Object.assign(properties, resolved.properties)
    const isObjectLike =
      resolved.type === 'object' || isObject(resolved.properties) || Array.isArray(resolved.allOf)
    return isObjectLike ? { properties, required } : undefined
  }

  /** Name an object that was written in place, so a list of them can be written `Name[]`. */
  const hoist = (schema: Json, hint: string): string => {
    const name = hint
    types[name] = convertObject(schema, hint)
    return name
  }

  const convertObject = (schema: Json, hint: string): TypeJson => {
    const parts = objectParts(schema)
    if (!parts) {
      note('an object made of these parts could not be read, so it is unknown.')
      return 'unknown'
    }
    if (Object.keys(parts.properties).length === 0) return 'object'
    const fields: Record<string, TypeJson> = {}
    for (const [key, value] of Object.entries(parts.properties)) {
      const t = convertSchema(value, `${hint}${pascal(key)}`)
      const optional = !parts.required.has(key)
      if (typeof t === 'string') fields[key] = optional ? `${t}?` : t
      else fields[optional ? `${key}?` : key] = t
    }
    return fields
  }

  const nullable = (schema: Json, text: string): string =>
    schema.nullable === true ? `${text} | null` : text

  /** A schema as a type. `inItems` says it is the item of a list, for the wording of a note. */
  const convertSchema = (value: Json, hint: string, inItems = false): TypeJson => {
    const name = refName(value)
    if (name !== undefined) {
      if (!(name in schemas)) {
        note(`the schema "${name}" is not in the file, so it is unknown.`)
        return 'unknown'
      }
      return name
    }
    if (typeof value?.$ref === 'string') {
      note(`the reference ${value.$ref} cannot be followed, so it is unknown.`)
      return 'unknown'
    }
    if (!isObject(value)) return 'unknown'
    for (const keyword of ['oneOf', 'anyOf']) {
      if (Array.isArray(value[keyword])) {
        note(`${keyword} is not read, so ${inItems ? 'each item' : 'it'} is unknown.`)
        return 'unknown'
      }
    }
    if (Array.isArray(value.allOf)) return convertObject(value, hint)
    if (Array.isArray(value.enum)) {
      if (value.enum.every((e: unknown) => typeof e === 'string'))
        return nullable(value, value.enum.map((e: string) => `'${e}'`).join(' | '))
      if (value.enum.every((e: unknown) => typeof e === 'number')) return nullable(value, 'number')
      return 'unknown'
    }
    let type = value.type
    let isNull = value.nullable === true
    if (Array.isArray(type)) {
      isNull = isNull || type.includes('null')
      const rest = type.filter((t: string) => t !== 'null')
      type = rest.length === 1 ? rest[0] : undefined
    }
    const withNull = (text: string) => (isNull ? `${text} | null` : text)
    switch (type) {
      case 'string':
        return withNull('string')
      case 'integer':
      case 'number':
        return withNull('number')
      case 'boolean':
        return withNull('boolean')
      case 'null':
        return 'null'
      case 'array': {
        const items = isObject(value.items) ? value.items : {}
        const item =
          items.type === 'object' && isObject(items.properties) && refName(items) === undefined
            ? hoist(items, `${hint}Item`)
            : convertSchema(items, `${hint}Item`, true)
        const text = typeof item === 'string' ? (item.includes('|') ? 'unknown' : item) : 'unknown'
        return withNull(`${text}[]`)
      }
      case 'object': {
        return convertObject(value, hint)
      }
      default:
        if (isObject(value.properties)) return convertObject(value, hint)
        return 'unknown'
    }
  }

  for (const [name, schema] of Object.entries(schemas)) {
    where = `schema "${name}"`
    types[name] = convertSchema(schema, name)
  }

  const paths: DescriptionJson['paths'] = {}
  for (const [rawPath, item] of Object.entries<Json>(document.paths ?? {})) {
    if (!isObject(item)) continue
    const path = rawPath.replace(/\{([^}]+)\}/g, ':$1')
    const shared: Json[] = Array.isArray(item.parameters) ? item.parameters : []
    for (const method of METHODS) {
      const operation = item[method]
      if (!isObject(operation)) continue
      const verb = method.toUpperCase()
      where = `${verb} ${path}`
      const hint = pascal(operation.operationId ?? `${method} ${path}`)
      const endpoint: EndpointJson = {}

      // Query parameters: the operation's replace the path's of the same name.
      const parameters = new Map<string, Json>()
      for (const p of [
        ...shared,
        ...(Array.isArray(operation.parameters) ? operation.parameters : []),
      ]) {
        const resolved = follow(p)
        if (isObject(resolved) && resolved.in === 'query') parameters.set(resolved.name, resolved)
      }
      if (parameters.size) {
        endpoint.query = {}
        for (const [key, p] of parameters) {
          const t = convertSchema(p.schema ?? {}, `${hint}${pascal(key)}`)
          endpoint.query[key] =
            p.required === true ? (t as string) : `${typeof t === 'string' ? t : 'object'}?`
        }
      }

      // The body: JSON, or text. Anything else is said, and left out.
      const body = follow(operation.requestBody)
      if (isObject(body) && isObject(body.content)) {
        const found = pickContent(body.content)
        if (found?.schema !== undefined) endpoint.body = convertSchema(found.schema, `${hint}Body`)
        else if (found === undefined) {
          const type = Object.keys(body.content)[0]
          if (type) note(`a body of type ${type} is not read.`)
        }
      }

      // The answers: the first successful one with a JSON or text body, and what the others mean.
      let described: string | undefined
      for (const [status, raw] of Object.entries<Json>(operation.responses ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const response = follow(raw)
        if (!isObject(response)) continue
        if (/^2/.test(status)) {
          described ??= response.description
          if (endpoint.returns === undefined && isObject(response.content)) {
            const found = pickContent(response.content)
            if (found?.schema !== undefined) endpoint.returns = convertSchema(found.schema, hint)
            else if (found === undefined) {
              const type = Object.keys(response.content)[0]
              if (type) note(`an answer of type ${type} is not read.`)
            }
          }
        } else if (/^[45]/.test(status) && typeof response.description === 'string') {
          ;(endpoint.errors ??= {})[status] = response.description
        }
      }
      const text = operation.summary ?? operation.description ?? described
      if (typeof text === 'string' && text) endpoint.description = text
      ;(paths[path] ??= {})[method] = endpoint
    }
  }
  where = ''

  const description: DescriptionJson = { types, paths }
  const base = Array.isArray(document.servers) ? document.servers[0]?.url : undefined
  if (typeof base === 'string') description.base = base
  if (typeof document.info?.description === 'string')
    description.description = document.info.description
  // The header of the file first.
  const ordered: DescriptionJson = {
    ...(description.base ? { base: description.base } : {}),
    ...(description.description ? { description: description.description } : {}),
    types: description.types,
    paths: description.paths,
  }
  return { ok: true, description: ordered, notes }

  /** The JSON content of a body or an answer, or text; undefined when it is some other kind. */
  function pickContent(content: Record<string, Json>): { schema: Json } | undefined {
    for (const [type, media] of Object.entries(content)) {
      if (/^application\/(?:[\w.+-]*\+)?json/.test(type) && isObject(media))
        return { schema: media.schema ?? {} }
    }
    for (const [type, media] of Object.entries(content)) {
      if (type.startsWith('text/') && isObject(media))
        return { schema: media.schema ?? { type: 'string' } }
    }
    return undefined
  }
}
