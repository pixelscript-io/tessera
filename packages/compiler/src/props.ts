import * as acorn from 'acorn'
import { Reporter } from './diagnostics'
import { parseSfc } from './sfc'

/** A prop a component's script asks for with `props({ name: default })`, besides the contract's variants. */
export interface PropInfo {
  name: string
  /** What the default says the prop is. `unknown` when the default is not a plain value. */
  type: 'boolean' | 'number' | 'string' | 'array' | 'object' | 'unknown'
  /** The default, when it is a plain value (a literal, or an array or object of them). */
  default?: unknown
}

/** The value of a node made only of literals, or a marker that it is not. */
const NOT_PLAIN = Symbol('not plain')

function plain(node: acorn.Node): unknown {
  const n = node as any
  switch (n.type) {
    case 'Literal':
      return n.regex ? NOT_PLAIN : n.value
    case 'TemplateLiteral':
      return n.expressions.length === 0 ? n.quasis[0].value.cooked : NOT_PLAIN
    case 'UnaryExpression': {
      const v = plain(n.argument)
      if (typeof v !== 'number') return NOT_PLAIN
      return n.operator === '-' ? -v : n.operator === '+' ? v : NOT_PLAIN
    }
    case 'ArrayExpression': {
      const items = n.elements.map((e: acorn.Node | null) => (e ? plain(e) : NOT_PLAIN))
      return items.includes(NOT_PLAIN) ? NOT_PLAIN : items
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {}
      for (const p of n.properties) {
        if (p.type !== 'Property' || p.computed || p.kind !== 'init') return NOT_PLAIN
        const key = p.key.type === 'Identifier' ? p.key.name : p.key.value
        const value = plain(p.value)
        if (value === NOT_PLAIN) return NOT_PLAIN
        out[String(key)] = value
      }
      return out
    }
    default:
      return NOT_PLAIN
  }
}

const kind = (value: unknown): PropInfo['type'] =>
  typeof value === 'boolean'
    ? 'boolean'
    : typeof value === 'number'
      ? 'number'
      : typeof value === 'string'
        ? 'string'
        : Array.isArray(value)
          ? 'array'
          : value !== null && typeof value === 'object'
            ? 'object'
            : 'unknown'

/**
 * The props a component's script names, with their defaults: every key of the object passed to `props({ ... })`.
 * The contract declares the variants; these are the rest (a `disabled`, a `value`, a list of `options`). Only a
 * plain default (a literal, or an array or object of them) gives a type; anything else is `unknown`.
 */
export function componentProps(source: string): PropInfo[] {
  const script = parseSfc(source, new Reporter('', source)).get('script')
  if (!script) return []
  const code = script.content
  const found = new Map<string, PropInfo>()
  for (const match of code.matchAll(/\bprops\s*(?:<[^>()]*>)?\s*\(\s*(\{)/g)) {
    const brace = match.index! + match[0].length - 1
    let node: acorn.Node
    try {
      node = acorn.parseExpressionAt(code, brace, { ecmaVersion: 'latest' })
    } catch {
      continue
    }
    const object = node as any
    if (object.type !== 'ObjectExpression') continue
    for (const p of object.properties) {
      if (p.type !== 'Property' || p.computed) continue
      const name = String(p.key.type === 'Identifier' ? p.key.name : p.key.value)
      if (found.has(name)) continue
      // Shorthand (`props({ disabled })`) has no default to read.
      const value = p.shorthand ? NOT_PLAIN : plain(p.value)
      found.set(
        name,
        value === NOT_PLAIN
          ? { name, type: 'unknown' }
          : { name, type: kind(value), default: value },
      )
    }
  }
  return [...found.values()]
}
