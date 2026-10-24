import type { RendererAdapter } from './adapter'

/**
 * A tree of elements and text with no browser behind it, for rendering a page to HTML text: static prerendering, and
 * tests that need no DOM. Listeners are accepted and ignored, so a component that attaches a behavior still renders.
 */
export interface StringNode {
  readonly kind: 'element' | 'text'
  /** The tag, for an element. */
  readonly tag?: string
  /** The text, for a text node. */
  text?: string
  readonly attrs?: Map<string, string>
  readonly children?: StringNode[]
  parent: StringNode | null
}

/** Elements that have no closing tag and no children. */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

/** Elements whose content is not text to escape. */
const RAW = new Set(['script', 'style'])

const escapeText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const escapeAttribute = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

export function createStringNode(tag: string): StringNode {
  return { kind: 'element', tag, attrs: new Map(), children: [], parent: null }
}

/**
 * The renderer adapter for a tree of `StringNode`s. Properties that a browser would show as attributes (`value`,
 * `checked`, `selected`) become attributes, so the HTML has what a page would have when it first loads.
 */
export function createStringAdapter(): RendererAdapter<StringNode, StringNode> {
  const detach = (node: StringNode) => {
    const parent = node.parent
    if (!parent?.children) return
    const at = parent.children.indexOf(node)
    if (at >= 0) parent.children.splice(at, 1)
    node.parent = null
  }
  const place = (parent: StringNode, node: StringNode, anchor: StringNode | null) => {
    detach(node)
    const children = parent.children!
    const at = anchor ? children.indexOf(anchor) : -1
    if (at >= 0) children.splice(at, 0, node)
    else children.push(node)
    node.parent = parent
  }
  const set = (el: StringNode, name: string, value: string | null) => {
    if (value === null) el.attrs?.delete(name)
    else el.attrs?.set(name, value)
  }
  return {
    createElement: (tag) => createStringNode(tag),
    createText: (text) => ({ kind: 'text', text, parent: null }),
    setAttribute: set,
    setProperty(el, name, value) {
      if (value === true) set(el, name, '')
      else if (value === false || value === null || value === undefined) set(el, name, null)
      else set(el, name, String(value))
    },
    getAttribute: (el, name) => el.attrs?.get(name) ?? null,
    setText(node, text) {
      node.text = text
    },
    insert: place,
    move: place,
    remove: detach,
    nextSibling(node) {
      const siblings = node.parent?.children
      if (!siblings) return null
      return siblings[siblings.indexOf(node) + 1] ?? null
    },
    parentNode: (node) => node.parent,
    addListener() {},
    removeListener() {},
  }
}

/** The HTML text of a node: elements with their attributes, text escaped, void elements without a closing tag. */
export function serializeNode(node: StringNode): string {
  if (node.kind === 'text') return escapeText(node.text ?? '')
  const attrs = [...(node.attrs ?? [])]
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('')
  if (VOID.has(node.tag!)) return `<${node.tag}${attrs}>`
  const inner = (node.children ?? [])
    .map((child) =>
      RAW.has(node.tag!) && child.kind === 'text' ? (child.text ?? '') : serializeNode(child),
    )
    .join('')
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`
}

/** The HTML of what is inside an element, which is what goes into the page's `#app`. */
export function serializeChildren(node: StringNode): string {
  return (node.children ?? []).map(serializeNode).join('')
}
