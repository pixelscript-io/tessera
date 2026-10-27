import { nearest } from './diagnostics'
import type { JsonNode } from './jsonc'

/**
 * What a contract's `preview` says about showing the component: sample values for its props, and sample content for its
 * slots. The docs app mounts it with these, the generated accessibility tests mount it with them, and the usage examples
 * AI tools read are written from them, so a component that needs data or children to look like itself says so once.
 */
export interface Preview {
  /** Prop name to a sample value: a variant's value, or one of the script's props (`options`, `value`). */
  props?: Record<string, unknown>
  /** Slot name to sample content. */
  slots?: Record<string, PreviewContent>
}

/** Text, a component (with its own props and slots), or a plain element. */
export type PreviewNode =
  | string
  | { component: string; props?: Record<string, unknown>; slots?: Record<string, PreviewContent> }
  | {
      tag: string
      attrs?: Record<string, string | boolean>
      text?: string
      children?: PreviewContent
    }

export type PreviewContent = PreviewNode | PreviewNode[]

/** What the parser needs from its caller to report a problem at a place in the contract. */
export interface PreviewReporter {
  report(offset: number, message: string, hint?: string): void
}

const q = (s: string) => JSON.stringify(s)
const PASCAL = /^[A-Z][A-Za-z0-9]*$/
const TAG = /^[a-z][a-z0-9-]*$/
const PREVIEW_FIELDS = ['props', 'slots'] as const
const NODE_FIELDS = ['component', 'props', 'slots', 'tag', 'attrs', 'text', 'children'] as const

/** A JSON node as the JavaScript value it stands for. */
export function jsonValue(node: JsonNode): unknown {
  switch (node.type) {
    case 'object':
      return Object.fromEntries(node.props.map((p) => [p.key, jsonValue(p.value)]))
    case 'array':
      return node.items.map(jsonValue)
    case 'null':
      return null
    default:
      return node.value
  }
}

/** Check a `preview` field and read it. Problems are reported; the result is only meaningful without any. */
export function parsePreview(
  node: JsonNode,
  slots: readonly string[],
  reporter: PreviewReporter,
): Preview {
  const out: Preview = {}
  const { report } = reporter
  if (node.type !== 'object') {
    report(node.start, '"preview" must be an object with "props" and "slots".')
    return out
  }

  const props = (value: JsonNode, where: string): Record<string, unknown> | undefined => {
    if (value.type !== 'object') {
      report(value.start, `${where} must be an object of prop names to values.`)
      return undefined
    }
    return jsonValue(value) as Record<string, unknown>
  }

  const content = (value: JsonNode, where: string): PreviewContent | undefined => {
    if (value.type === 'array') {
      const items = value.items.map((item) => nodeOf(item, where))
      return items.every((i) => i !== undefined) ? (items as PreviewNode[]) : undefined
    }
    return nodeOf(value, where)
  }

  const slotMap = (
    value: JsonNode,
    where: string,
    allowed: readonly string[] | undefined,
  ): Record<string, PreviewContent> | undefined => {
    if (value.type !== 'object') {
      report(value.start, `${where} must be an object of slot names to content.`)
      return undefined
    }
    const result: Record<string, PreviewContent> = {}
    for (const prop of value.props) {
      if (allowed && !allowed.includes(prop.key)) {
        const close = nearest(prop.key, allowed)
        report(
          prop.keyStart,
          `The slot ${q(prop.key)} in ${where} is not declared in "slots".`,
          close
            ? `Did you mean ${q(close)}?`
            : `Declared slots: ${allowed.map(q).join(', ') || 'none'}.`,
        )
        continue
      }
      const item = content(prop.value, `The content of the slot ${q(prop.key)}`)
      if (item !== undefined) result[prop.key] = item
    }
    return result
  }

  function nodeOf(value: JsonNode, where: string): PreviewNode | undefined {
    if (value.type === 'string') return value.value
    if (value.type !== 'object') {
      report(
        value.start,
        `${where} must be text, or an object with "component" or "tag" (or a list of them).`,
      )
      return undefined
    }
    const has = (key: string) => value.props.find((p) => p.key === key)
    for (const prop of value.props) {
      if (!(NODE_FIELDS as readonly string[]).includes(prop.key)) {
        const close = nearest(prop.key, NODE_FIELDS)
        report(
          prop.keyStart,
          `Unknown field ${q(prop.key)} in a preview node.`,
          close ? `Did you mean ${q(close)}?` : `Fields: ${NODE_FIELDS.map(q).join(', ')}.`,
        )
        return undefined
      }
    }
    const component = has('component')
    const tag = has('tag')
    if (component && tag) {
      report(value.start, 'A preview node is a "component" or a "tag", not both.')
      return undefined
    }
    if (!component && !tag) {
      report(value.start, 'A preview node needs a "component" or a "tag".')
      return undefined
    }
    if (component) {
      if (component.value.type !== 'string' || !PASCAL.test(component.value.value)) {
        report(component.value.start, '"component" must be a component name in PascalCase.')
        return undefined
      }
      const result: Extract<PreviewNode, { component: string }> = {
        component: component.value.value,
      }
      const p = has('props')
      if (p) {
        const parsed = props(p.value, '"props" of a preview node')
        if (parsed) result.props = parsed
      }
      const s = has('slots')
      if (s) {
        const parsed = slotMap(s.value, '"slots" of a preview node', undefined)
        if (parsed) result.slots = parsed
      }
      return result
    }
    if (tag!.value.type !== 'string' || !TAG.test(tag!.value.value)) {
      report(tag!.value.start, '"tag" must be an element name in lowercase, such as "input".')
      return undefined
    }
    const result: Extract<PreviewNode, { tag: string }> = { tag: tag!.value.value }
    const a = has('attrs')
    if (a) {
      const parsed = props(a.value, '"attrs" of a preview node')
      if (parsed) result.attrs = parsed as Record<string, string | boolean>
    }
    const t = has('text')
    if (t) {
      if (t.value.type === 'string') result.text = t.value.value
      else report(t.value.start, '"text" must be a string.')
    }
    const c = has('children')
    if (c) {
      const parsed = content(c.value, 'The "children" of a preview node')
      if (parsed !== undefined) result.children = parsed
    }
    return result
  }

  for (const prop of node.props) {
    if (!(PREVIEW_FIELDS as readonly string[]).includes(prop.key)) {
      const close = nearest(prop.key, PREVIEW_FIELDS)
      report(
        prop.keyStart,
        `Unknown preview field ${q(prop.key)}.`,
        close ? `Did you mean ${q(close)}?` : `Fields: ${PREVIEW_FIELDS.map(q).join(', ')}.`,
      )
      continue
    }
    if (prop.key === 'props') {
      const parsed = props(prop.value, '"props" in "preview"')
      if (parsed) out.props = parsed
    } else {
      const parsed = slotMap(prop.value, '"preview"', slots)
      if (parsed) out.slots = parsed
    }
  }
  return out
}
