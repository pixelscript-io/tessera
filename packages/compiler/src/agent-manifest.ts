import type { Contract } from '@tessera/contract'
import type { RouteManifest } from '@tessera/router/manifest'
import type { TokenManifest } from '@tessera/tokens'
import { tokenLifecycle } from './style/tokens'
import { resolveConfig, type Accept, type TesseraConfig } from './config'
import { resolveType, typeToText } from './api-description'
import { DEFAULT_API, type ProjectApi } from './apis'

/**
 * The machine-readable truth about a project: its components, design tokens, routes and rules. AI coding tools
 * read this instead of guessing, and the compiler stays the check on what they write. Generated, never edited.
 */
export interface AgentManifest {
  version: 1
  /** What wrote this file. */
  generator: 'tessera'
  components: ManifestComponent[]
  tokens: ManifestTokens
  routes: ManifestRoutes
  rules: ManifestRules
  /** The APIs in `app/apis`, and what each says it has. */
  apis: ManifestApi[]
}

export interface ManifestApi {
  /** The name a script uses: `github` for `app/apis/github.ts`. `default` is what plain `get` and `post` use. */
  name: string
  file: string
  /** Whether there is a description (`github.api.json`). Without one the compiler does not check calls on it. */
  described: boolean
  base?: string
  description?: string
  /** Each named type, written out: `Todo: { id: number; title: string }`. */
  types: Record<string, string>
  endpoints: ManifestEndpoint[]
}

export interface ManifestEndpoint {
  method: string
  /** With `:name` for each parameter in the path. */
  path: string
  /** The `:name`s of the path, which a call gives values for. */
  params: string[]
  /** The query parameters, by name, with their type (a `?` after the name when optional). */
  query: Record<string, string>
  body?: string
  /** What the answer is. Missing when it is empty. */
  returns?: string
  errors?: Record<string, string>
  description?: string
  /** How to call it, to copy and adapt. */
  usage: string
}

export interface ManifestComponent {
  /** The contract name, which is also the tag: `<Button>`. */
  name: string
  /** Where the component is defined, relative to the project. */
  file: string
  /** The ARIA role the component has. */
  role: string
  description?: string
  since?: string
  /** Present when the component is deprecated: what to use instead. */
  deprecated?: string
  renamedFrom?: string
  /** Variant values that are deprecated, by variant, with the reason. They still work. */
  deprecatedValues?: Record<string, Record<string, string>>
  /** Variant values that were renamed, by variant: old value to replacement. */
  renamedValues?: Record<string, Record<string, string>>
  forkedFrom?: { component: string; version: string }
  /** The documented class names, which are the only parts a consumer may style. */
  parts: string[]
  /** Each variant, with its allowed values and its default (the first value). */
  variants: Array<{ name: string; values: string[]; default: string }>
  states: string[]
  /** The headless behavior, such as `press`. */
  behavior?: string
  /** Slot name to what it is for. `default` is the content between the tags. */
  slots: Record<string, string>
  /** Event name to what it means. Listen with `@name="handler"`. */
  events: Record<string, string>
  /** Part pairs whose text and background contrast is checked in every theme. */
  contrast: Array<{ foreground: string; background: string }>
  /** Valid ways to use it, generated from the contract. Copy and adapt. */
  usage: string[]
}

export interface ManifestTokens {
  /** The themes and the attribute each applies under. */
  themes: Array<{ name: string; attribute: string; auto?: string }>
  tokens: Array<{
    /** The dotted path, written in a style as `$space.4`. */
    path: string
    type: string
    /** `primitive` tokens are raw values, `semantic` ones carry meaning, `component` ones belong to one component. */
    tier: string
    description?: string
    /** Present when the token is deprecated: what to use instead. */
    deprecated?: string
    /** The token this one replaced. */
    renamedFrom?: string
    cssVar: string
    /** The value as CSS in each scope: `base`, then `theme=dark` and so on. */
    values: Record<string, string>
  }>
}

export interface ManifestRoutes {
  routes: Array<{ path: string; file: string; params: string[] }>
  notFound?: string
  /** Layout names a page may choose with `layout` in its `<page>` block. */
  layouts: string[]
}

export interface ManifestRules {
  /** CSS properties whose values must be tokens, and what each accepts. */
  governed: Record<string, Array<{ type: string; groups?: string[] }>>
  /** The minimum text contrast ratio checked in every theme. */
  contrastMinimum: number
  /** What using a primitive token in a component does: `warn`, `error` or `off`. */
  primitives: 'warn' | 'error' | 'off'
  autoImports: boolean
}

/** A tag with every variant at its default, and slot content if the component has a default slot. */
function basicUsage(c: Contract): string {
  const content = 'default' in c.slots ? 'content' : ''
  return content ? `<${c.name}>${content}</${c.name}>` : `<${c.name} />`
}

/** A tag that sets each variant to a value other than its default, and listens for its first event. */
function variedUsage(c: Contract): string | undefined {
  const attrs = Object.entries(c.variants)
    .filter(([, values]) => values.length > 1)
    .map(([name, values]) => `${name}="${values[1]}"`)
  const event = Object.keys(c.events)[0]
  if (!attrs.length && !event) return undefined
  const open = [
    c.name,
    ...attrs,
    ...(event ? [`@${event}="on${event[0]!.toUpperCase()}${event.slice(1)}"`] : []),
  ]
  return 'default' in c.slots ? `<${open.join(' ')}>content</${c.name}>` : `<${open.join(' ')} />`
}

export function componentsOf(
  entries: Iterable<{ name: string; file: string; contract: Contract }>,
): ManifestComponent[] {
  return [...entries]
    .map(({ file, contract: c }) => ({
      name: c.name,
      file,
      role: c.role,
      ...(c.description ? { description: c.description } : {}),
      ...(c.since ? { since: c.since } : {}),
      ...(c.deprecated !== undefined ? { deprecated: c.deprecated } : {}),
      ...(c.renamedFrom ? { renamedFrom: c.renamedFrom } : {}),
      ...(c.deprecatedValues ? { deprecatedValues: c.deprecatedValues } : {}),
      ...(c.renamedValues ? { renamedValues: c.renamedValues } : {}),
      ...(c.forkedFrom ? { forkedFrom: c.forkedFrom } : {}),
      parts: c.parts,
      variants: Object.entries(c.variants).map(([name, values]) => ({
        name,
        values,
        default: values[0]!,
      })),
      states: c.states,
      ...(c.behavior ? { behavior: c.behavior } : {}),
      slots: c.slots,
      events: c.events,
      contrast: c.contrast.map((p) => ({ foreground: p.foreground, background: p.background })),
      usage: [basicUsage(c), variedUsage(c)].filter((u): u is string => !!u),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function tokensOf(manifest: TokenManifest | undefined): ManifestTokens {
  if (!manifest) return { themes: [], tokens: [] }
  return {
    themes: manifest.themes.map((t) => ({
      name: t.name,
      attribute: t.attribute,
      ...(t.auto ? { auto: t.auto } : {}),
    })),
    tokens: manifest.tokens.map((t) => ({
      path: t.path,
      type: t.type,
      tier: t.tier,
      ...(t.description ? { description: t.description } : {}),
      ...tokenLifecycle(t.extensions),
      cssVar: t.cssVar,
      values: Object.fromEntries(Object.entries(t.values).map(([scope, v]) => [scope, v.css])),
    })),
  }
}

export function routesOf(routes: RouteManifest | undefined, layouts: string[]): ManifestRoutes {
  return {
    routes: (routes?.routes ?? []).map((r) => ({ path: r.path, file: r.file, params: r.params })),
    ...(routes?.notFound ? { notFound: routes.notFound.file } : {}),
    layouts,
  }
}

export function rulesOf(config: TesseraConfig | undefined): ManifestRules {
  const resolved = resolveConfig(config)
  return {
    governed: Object.fromEntries(
      Object.entries(resolved.governed).map(([property, accepts]) => [
        property,
        (accepts as Accept[]).map((a) => ({
          type: a.type,
          ...(a.groups ? { groups: a.groups } : {}),
        })),
      ]),
    ),
    contrastMinimum: resolved.contrast.minimum,
    primitives: resolved.primitives,
    autoImports: resolved.autoImports,
  }
}

const VERB_OF_METHOD: Record<string, string> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'del',
}

/** The APIs of a project as the manifest shows them. `display` turns a file into the path the project shows. */
export function apisOf(
  apis: readonly ProjectApi[],
  display: (file: string) => string,
): ManifestApi[] {
  return apis.map((api) => {
    const d = api.description
    const prefix = api.name === DEFAULT_API ? '' : `${api.name}.`
    return {
      name: api.name,
      file: display(api.file),
      described: !!d,
      ...(d?.base ? { base: d.base } : {}),
      ...(d?.description ? { description: d.description } : {}),
      types: Object.fromEntries(
        Object.entries(d?.types ?? {}).map(([name, type]) => [name, typeToText(type)]),
      ),
      endpoints: (d?.endpoints ?? []).map((e) => {
        const params = [...e.path.matchAll(/\/:([A-Za-z_]\w*)/g)].map((m) => m[1]!)
        const query = Object.fromEntries(
          Object.entries(e.query).map(([key, f]) => [
            `${key}${f.optional ? '?' : ''}`,
            typeToText(f.type),
          ]),
        )
        const verb = VERB_OF_METHOD[e.method]!
        const queryKeys = Object.keys(e.query)
        const body = e.body && d ? resolveType(d, e.body) : undefined
        const bodyKeys = body?.kind === 'fields' ? Object.keys(body.fields) : []
        const writeKeys = [...params, ...bodyKeys]
        const usage =
          e.method === 'GET'
            ? `const { data, loading, error } = ${prefix}get('${e.path}'${params.length + queryKeys.length ? `, { ${[...params, ...queryKeys].join(', ')} }` : ''})`
            : `const run = ${prefix}${verb}('${e.path}')
await run(${writeKeys.length ? `{ ${writeKeys.join(', ')} }` : ''})`
        return {
          method: e.method,
          path: e.path,
          params,
          query,
          ...(e.body ? { body: typeToText(e.body) } : {}),
          ...(e.returns ? { returns: typeToText(e.returns) } : {}),
          ...(e.errors ? { errors: e.errors } : {}),
          ...(e.description ? { description: e.description } : {}),
          usage,
        }
      }),
    }
  })
}

/** Assemble the manifest from what a project already knows. Pure: the caller supplies the pieces. */
export function buildAgentManifest(input: {
  components: Iterable<{ name: string; file: string; contract: Contract }>
  tokens: TokenManifest | undefined
  routes: RouteManifest | undefined
  layouts: string[]
  config: TesseraConfig | undefined
  apis?: ManifestApi[]
}): AgentManifest {
  return {
    version: 1,
    generator: 'tessera',
    components: componentsOf(input.components),
    tokens: tokensOf(input.tokens),
    routes: routesOf(input.routes, input.layouts),
    rules: rulesOf(input.config),
    apis: input.apis ?? [],
  }
}
