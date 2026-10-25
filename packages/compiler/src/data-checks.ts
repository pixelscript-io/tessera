import { DEFAULT_API, type ProjectApi } from './apis'
import {
  METHOD_OF_VERB,
  matchEndpoint,
  type ApiDescription,
  type Endpoint,
  type Method,
} from './api-description'
import { nearest } from '@tessera/contract'
import type { Reporter } from './diagnostics'
import { words, type StaticType, type TypeEnv } from './expr'
import type { DataCall, ScriptAnalysis } from './script'

/** What a read's `error` is: the `ApiError` of the runtime. */
const API_ERROR: ApiDescription = {
  types: {
    ApiError: {
      kind: 'fields',
      fields: {
        name: { type: { kind: 'string' }, optional: false },
        message: { type: { kind: 'string' }, optional: false },
        status: { type: { kind: 'number' }, optional: false },
        statusText: { type: { kind: 'string' }, optional: false },
        method: { type: { kind: 'string' }, optional: false },
        url: { type: { kind: 'string' }, optional: false },
        body: { type: { kind: 'unknown' }, optional: false },
        cause: { type: { kind: 'unknown' }, optional: true },
      },
    },
  },
  endpoints: [],
}
const API_ERROR_TYPE: StaticType = {
  type: { kind: 'ref', name: 'ApiError' },
  description: API_ERROR,
}

/** The placeholders of a path: `/users/:name/posts` has `name`. */
const placeholders = (path: string) => [...path.matchAll(/\/:([A-Za-z_]\w*)/g)].map((m) => m[1]!)

/**
 * Check the calls of a script against the descriptions of the APIs they are made on, and work out the types a template
 * can rely on. A call is judged only when its path is a plain string and its API has a description: an endpoint the
 * description does not have is T5006, a parameter it does not take or a required one that is missing is T5007. What a
 * read gives (`data`, `error`) is returned as types, so the template can be checked for fields that are not there
 * (T5008). Calls and parameters that cannot be seen (a path that is built, a function that makes the parameters) are
 * not judged.
 */
export function checkDataCalls(
  script: ScriptAnalysis,
  apis: readonly ProjectApi[],
  report: Reporter,
  base: number,
): TypeEnv | undefined {
  const byName = new Map(apis.map((api) => [api.name, api]))
  const env: TypeEnv = { reads: new Map(), names: new Map(), locals: new Map() }

  for (const call of script.dataCalls) {
    if (!call.path) continue
    const name = call.api ?? (byName.has(DEFAULT_API) ? DEFAULT_API : undefined)
    const description = name ? byName.get(name)?.description : undefined
    if (!name || !description) continue
    const method = METHOD_OF_VERB[call.verb]!
    const path = call.path.value
    const match = matchEndpoint(description, method, path)
    if (match.kind === 'outside') continue
    if (match.kind !== 'found') {
      report.error(
        'T5006',
        base + call.path.offset,
        `The description of "${name}" has no ${method} ${path}.`,
        match.kind === 'method'
          ? `${match.path} has ${words(match.has)}.`
          : match.nearest
            ? `Did you mean "${match.nearest}"?`
            : undefined,
      )
      continue
    }
    const endpoint = match.endpoint
    if (call.kind === 'resource') {
      checkParams(call, endpoint, method, report, base)
      const data: StaticType | undefined = endpoint.returns
        ? { type: endpoint.returns, description }
        : undefined
      if (call.binding) env.reads.set(call.binding, { data, error: API_ERROR_TYPE })
      for (const member of call.members ?? []) {
        if (member.key === 'data' && data) env.names.set(member.local, data)
        else if (member.key === 'error') env.names.set(member.local, API_ERROR_TYPE)
      }
    }
  }
  return env.reads.size || env.names.size ? env : undefined
}

function checkParams(
  call: DataCall,
  endpoint: Endpoint,
  method: Method,
  report: Reporter,
  base: number,
): void {
  const params = call.params
  if (!params || params.opaque) return
  const inCall = placeholders(call.path!.value)
  const query = Object.keys(endpoint.query)
  const allowed = [...new Set([...inCall, ...placeholders(endpoint.path), ...query])]
  for (const { key, offset } of params.keys) {
    if (allowed.includes(key)) continue
    const close = nearest(key, allowed)
    const takes = [...new Set([...placeholders(endpoint.path), ...query])]
    report.error(
      'T5007',
      base + offset,
      `"${key}" is not a parameter of ${method} ${endpoint.path}.`,
      close
        ? `Did you mean "${close}"?`
        : takes.length
          ? `${method} ${endpoint.path} takes ${words(takes)}.`
          : undefined,
    )
  }
  const given = new Set(params.keys.map((k) => k.key))
  const required = [
    ...inCall,
    ...Object.entries(endpoint.query)
      .filter(([, f]) => !f.optional)
      .map(([k]) => k),
  ]
  for (const name of new Set(required)) {
    if (given.has(name)) continue
    report.error(
      'T5007',
      base + call.path!.offset,
      `${method} ${endpoint.path} needs a value for "${name}".`,
    )
  }
}
