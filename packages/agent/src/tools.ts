import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  explainText,
  formatDiagnostic,
  type AgentManifest,
  type CompilerDiagnostic,
} from '@tessera/compiler'
import type { Project } from '@tessera/compiler/project'

/** A JSON Schema object, as MCP wants for a tool's input. */
interface InputSchema {
  type: 'object'
  properties: Record<string, { type: string; description: string; enum?: string[] }>
  required?: string[]
}

export interface Tool {
  name: string
  description: string
  inputSchema: InputSchema
  /** Every tool is read-only: it reads the project and never changes it. */
  run(args: Record<string, unknown>, ctx: ToolContext): unknown
}

export interface ToolContext {
  project: Project
  manifest(): AgentManifest
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v === '')
    throw new ToolError(`"${name}" is required and must be a string.`)
  return v
}

/** A problem with how a tool was called, reported to the client as an error result, not a crash. */
export class ToolError extends Error {}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** How well a component matches a search: its name counts most, then role and description, then the rest. */
function score(c: AgentManifest['components'][number], query: string): number {
  const q = words(query)
  if (!q.length) return 0
  const name = c.name.toLowerCase()
  const haystacks: Array<[string, number]> = [
    [name, 10],
    [c.role, 4],
    [c.description ?? '', 3],
    [Object.entries(c.slots).flat().join(' '), 2],
    [Object.entries(c.events).flat().join(' '), 2],
    [c.variants.flatMap((v) => [v.name, ...v.values]).join(' '), 2],
    [c.parts.join(' '), 1],
  ]
  let total = 0
  for (const word of q) {
    for (const [text, weight] of haystacks) {
      const hay = text.toLowerCase()
      if (hay === word) total += weight * 2
      else if (hay.includes(word)) total += weight
    }
  }
  return total
}

function diagnosticOut(d: CompilerDiagnostic) {
  return {
    code: d.code,
    severity: d.severity,
    line: d.line,
    column: d.column,
    message: d.message,
    ...(d.hint ? { hint: d.hint } : {}),
    ...(d.fix ? { fix: d.fix.text } : {}),
    text: formatDiagnostic(d),
  }
}

/** `$space.3` and friends, found in a hint or a fix. */
const tokensIn = (text: string | undefined): string[] =>
  [...(text ?? '').matchAll(/\$([a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+)/gi)].map((m) => m[1]!)

export const TOOLS: Tool[] = [
  {
    name: 'list_components',
    description:
      'List every component in the project (the design system and the app): name, role, description and variants. Use these names as tags; do not invent components.',
    inputSchema: { type: 'object', properties: {} },
    run: (_args, { manifest }) =>
      manifest().components.map((c) => ({
        name: c.name,
        role: c.role,
        ...(c.description ? { description: c.description } : {}),
        variants: c.variants.map((v) => v.name),
        ...(c.deprecated !== undefined ? { deprecated: c.deprecated } : {}),
      })),
  },
  {
    name: 'search_components',
    description:
      'Find components that match a description, such as "a button that deletes" or "navigation". Searches names, roles, descriptions, slots, events, variants and parts.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What you are looking for.' } },
      required: ['query'],
    },
    run: (args, { manifest }) => {
      const query = str(args.query, 'query')
      return manifest()
        .components.map((c) => ({ c, s: score(c, query) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
        .slice(0, 10)
        .map(({ c }) => ({
          name: c.name,
          role: c.role,
          description: c.description ?? '',
          usage: c.usage[0],
        }))
    },
  },
  {
    name: 'get_component',
    description:
      "Get one component's contract: its parts, variants (with defaults), states, slots, events and behavior, valid usage examples, and its source. Use only the variants, slots and events it declares.",
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The component name, such as Button.' } },
      required: ['name'],
    },
    run: (args, { manifest, project }) => {
      const name = str(args.name, 'name')
      const components = manifest().components
      const found = components.find((c) => c.name === name)
      if (!found) {
        const near = components
          .filter((c) => c.name.toLowerCase().includes(name.toLowerCase()))
          .map((c) => c.name)
        throw new ToolError(
          `There is no component named ${name}.` +
            (near.length
              ? ` Did you mean ${near.join(', ')}?`
              : ` Components: ${components.map((c) => c.name).join(', ')}.`),
        )
      }
      let source: string | undefined
      try {
        source = readFileSync(join(project.root, found.file), 'utf8')
      } catch {
        source = undefined
      }
      return { ...found, ...(source !== undefined ? { source } : {}) }
    },
  },
  {
    name: 'list_tokens',
    description:
      'List design tokens. Styles must use tokens (`$space.4`), and components should use semantic ones, which carry meaning (surface, text, action) and change with the theme. Filter by tier, type, a path prefix such as "color.action" or a search word.',
    inputSchema: {
      type: 'object',
      properties: {
        tier: {
          type: 'string',
          description: 'primitive, semantic or component. Prefer semantic.',
          enum: ['primitive', 'semantic', 'component'],
        },
        type: {
          type: 'string',
          description: 'The token type: color, dimension, duration, shadow, number, ...',
        },
        prefix: { type: 'string', description: 'A path prefix, such as color.surface or space.' },
        query: { type: 'string', description: 'Words to look for in the path or description.' },
        limit: { type: 'number', description: 'Most tokens to return. Default 100.' },
      },
    },
    run: (args, { manifest }) => {
      const { tokens, themes } = manifest().tokens
      const limit = typeof args.limit === 'number' ? args.limit : 100
      const q = typeof args.query === 'string' ? words(args.query) : []
      const matches = tokens.filter(
        (t) =>
          (!args.tier || t.tier === args.tier) &&
          (!args.type || t.type === args.type) &&
          (!args.prefix || t.path.startsWith(String(args.prefix))) &&
          q.every((w) => `${t.path} ${t.description ?? ''}`.toLowerCase().includes(w)),
      )
      return {
        themes: themes.map((t) => t.name),
        total: matches.length,
        tokens: matches.slice(0, limit).map((t) => ({
          use: `$${t.path}`,
          type: t.type,
          tier: t.tier,
          ...(t.description ? { description: t.description } : {}),
          value: t.values['base'],
        })),
      }
    },
  },
  {
    name: 'resolve_value',
    description:
      "Given a CSS property and a raw value you were about to write (13px, #ff0000, 200ms), find the design token to use instead. It runs the compiler's own style check, so the answer is what the build would accept. Returns valid:true when the value is already fine.",
    inputSchema: {
      type: 'object',
      properties: {
        property: {
          type: 'string',
          description: 'A CSS property, such as padding, color or border-radius.',
        },
        value: { type: 'string', description: 'The raw value, such as 13px or #ff0000.' },
      },
      required: ['property', 'value'],
    },
    run: (args, { project }) => {
      const property = str(args.property, 'property')
      const value = str(args.value, 'value')
      const source = `<contract>\n{ "name": "Probe", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root"></div></template>\n<style>\n.root { ${property}: ${value}; }\n</style>\n`
      const checked = project.compileFile(
        join(project.root, 'app', 'components', 'Probe.tess'),
        source,
        { baseline: null },
      )
      const style = checked.raw.filter((d) => d.code.startsWith('T21') && d.severity === 'error')
      if (!style.length)
        return { property, value, valid: true, message: 'This value passes the style rules.' }
      const d = style[0]!
      const exact = tokensIn(d.fix?.text)[0]
      const suggested = [...new Set([...tokensIn(d.fix?.text), ...tokensIn(d.hint)])]
      return {
        property,
        value,
        valid: false,
        code: d.code,
        message: d.message,
        ...(d.hint ? { hint: d.hint } : {}),
        // A fix exists only when one token is an exact match that changes nothing visible.
        ...(exact ? { exactToken: `$${exact}` } : {}),
        tokens: suggested.map((t) => `$${t}`),
      }
    },
  },
  {
    name: 'validate_snippet',
    description:
      'Check a .tess file (or a fragment of one) with the compiler and return exactly the errors the build would print, with suggestions. Run this on code before you present it. kind is component (default), page or layout.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The text of the .tess file.' },
        kind: {
          type: 'string',
          description: 'component, page or layout. Default component.',
          enum: ['component', 'page', 'layout'],
        },
        name: {
          type: 'string',
          description: 'For a component, its name (the file name). Default: the contract name.',
        },
      },
      required: ['source'],
    },
    run: (args, { project }) => {
      const source = str(args.source, 'source')
      const kind = (args.kind as string | undefined) ?? 'component'
      if (!['component', 'page', 'layout'].includes(kind))
        throw new ToolError('"kind" must be component, page or layout.')
      const contractName = /"name"\s*:\s*"([A-Za-z0-9]+)"/.exec(source)?.[1]
      const name = typeof args.name === 'string' ? args.name : (contractName ?? 'Snippet')
      const folder = kind === 'component' ? 'components' : kind === 'page' ? 'pages' : 'layouts'
      const file = kind === 'page' ? 'snippet.tess' : `${name}.tess`
      const checked = project.compileFile(join(project.root, 'app', folder, file), source, {
        baseline: null,
      })
      const diagnostics = checked.raw.map(diagnosticOut)
      return {
        ok: !diagnostics.some((d) => d.severity === 'error'),
        errors: diagnostics.filter((d) => d.severity === 'error').length,
        warnings: diagnostics.filter((d) => d.severity === 'warning').length,
        diagnostics,
      }
    },
  },
  {
    name: 'list_routes',
    description:
      'List the routes (from app/pages), the not-found page and the layouts a page can choose with `layout` in its <page> block.',
    inputSchema: { type: 'object', properties: {} },
    run: (_args, { manifest }) => manifest().routes,
  },
  {
    name: 'get_rules',
    description:
      'The rules the compiler enforces: which CSS properties must use tokens and which tokens each accepts, the contrast minimum, and the policy on primitive tokens.',
    inputSchema: { type: 'object', properties: {} },
    run: (_args, { manifest }) => manifest().rules,
  },
  {
    name: 'explain_error',
    description:
      'Explain an error or warning code such as T2102: its cause, an example that produces it and the fix.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'The code, such as T2102 or W4101.' } },
      required: ['code'],
    },
    run: (args) => {
      const text = explainText(str(args.code, 'code'))
      if (!text) throw new ToolError(`There is no error or warning code "${String(args.code)}".`)
      return { explanation: text }
    },
  },
]
