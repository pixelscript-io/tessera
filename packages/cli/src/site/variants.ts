import { extractContract } from '@tessera/compiler'
import type { RegistryItem } from '../registry/schema'

/** A page of the site that shows one variant of a component with each of its values. */
export interface VariantExample {
  /** The name the page and its preview go by: `Button-variant-tone`. */
  key: string
  component: string
  /** The variant: `tone`. */
  axis: string
  source: string
}

// The shapes of a contract's `preview` (the contract package's `Preview`, written out here so the site needs nothing else).
type Node =
  | string
  | { component: string; props?: Record<string, unknown>; slots?: Record<string, Content> }
  | { tag: string; attrs?: Record<string, string | boolean>; text?: string; children?: Content }
type Content = Node | Node[]

const list = (content: Content): Node[] => (Array.isArray(content) ? content : [content])

const text = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const attribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

/** `name="value"` for text, a bare name for true, nothing for false, and a binding for anything else. */
function prop(name: string, value: unknown): string {
  if (value === true) return name
  if (value === false || value === undefined || value === null) return ''
  if (typeof value === 'string') return `${name}="${attribute(value)}"`
  // An expression is read as written, not as HTML, so it goes in single quotes (a quote inside it becomes an escape).
  return `:${name}='${JSON.stringify(value).replaceAll("'", '\\u0027')}'`
}

const attrs = (values: Array<string | undefined>): string =>
  values.filter((v): v is string => !!v).join(' ')

/** One node of sample content as template text. `slot` names the slot it fills, when it is not the default one. */
function build(node: Node, slot?: string): string {
  const slotAttr = slot ? `slot="${attribute(slot)}"` : undefined
  if (typeof node === 'string') return slot ? `<span ${slotAttr}>${text(node)}</span>` : text(node)
  if ('component' in node) {
    const props = Object.entries(node.props ?? {}).map(([k, v]) => prop(k, v))
    const inner = content(node.slots)
    const open = attrs([node.component, slotAttr, ...props])
    return inner ? `<${open}>${inner}</${node.component}>` : `<${open} />`
  }
  const own = Object.entries(node.attrs ?? {}).map(([k, v]) => prop(k, v))
  const inner =
    (node.text !== undefined ? text(node.text) : '') +
    (node.children !== undefined
      ? list(node.children)
          .map((c) => build(c))
          .join('')
      : '')
  const open = attrs([node.tag, slotAttr, ...own])
  return `<${open}>${inner}</${node.tag}>`
}

/** The slots of a preview as the children of a component: the default slot inline, each named slot as an element. */
function content(slots: Record<string, Content> | undefined): string {
  if (!slots) return ''
  return Object.entries(slots)
    .map(([name, value]) =>
      list(value)
        .map((node) => build(node, name === 'default' ? undefined : name))
        .join(''),
    )
    .join('')
}

/**
 * For each variant of a component that has more than one value, a template that shows the component once for each value,
 * made of the sample props and content of its contract's `preview`, so the examples read like the rest of the page. A
 * component whose preview opens itself (a dialog, a popover) has none: it would cover the page. Returns nothing for
 * a component with no variants or no contract.
 */
export function variantExamples(item: RegistryItem): VariantExample[] {
  const file = item.files.find((f) => f.path === `${item.name}.tess`)
  const contract = file ? extractContract(file.content, file.path) : undefined
  if (!contract) return []
  const preview = (contract.preview ?? {}) as {
    props?: Record<string, unknown>
    slots?: Record<string, Content>
  }
  if (preview.props?.open === true) return []
  const out: VariantExample[] = []
  for (const [axis, values] of Object.entries(contract.variants)) {
    if (values.length < 2) continue
    const rows = values.map((value) => {
      const props = Object.entries({ ...preview.props, [axis]: value }).map(([k, v]) => prop(k, v))
      const inner = content(preview.slots)
      const open = attrs([item.name, ...props])
      const instance = inner ? `<${open}>${inner}</${item.name}>` : `<${open} />`
      return `    <figure>\n      ${instance}\n      <figcaption>${text(value)}</figcaption>\n    </figure>`
    })
    out.push({
      key: `${item.name}-variant-${axis}`,
      component: item.name,
      axis,
      source: `<template>\n  <div class="matrix">\n${rows.join('\n')}\n  </div>\n</template>\n`,
    })
  }
  return out
}
