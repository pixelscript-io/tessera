import { getRenderer, type Component } from './component'
import type { Child, SlotContent } from './renderer'
import { constant, isSignal, type ReadonlySignal } from './signals'

/**
 * Showing a component the way its contract's `preview` says: sample props and sample slot content. The docs app and the
 * generated accessibility tests both mount components with these, so what a person sees in the docs is what is tested.
 * (The shapes are the contract package's `Preview`; they are repeated here so the runtime does not depend on it.)
 */
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

export interface PreviewSpec {
  props?: Record<string, unknown>
  slots?: Record<string, PreviewContent>
}

const asList = (content: PreviewContent): PreviewNode[] =>
  Array.isArray(content) ? content : [content]

/** Every component the content names, however deep, so a caller can load them before it mounts anything. */
export function previewComponents(spec: PreviewSpec | undefined): string[] {
  const found = new Set<string>()
  const visit = (content: PreviewContent | undefined) => {
    if (content === undefined) return
    for (const node of asList(content)) {
      if (typeof node === 'string') continue
      if ('component' in node) {
        found.add(node.component)
        for (const inner of Object.values(node.slots ?? {})) visit(inner)
      } else visit(node.children)
    }
  }
  for (const content of Object.values(spec?.slots ?? {})) visit(content)
  return [...found]
}

/** Sample values as props: a signal is kept as it is, anything else becomes a constant. */
export function previewProps(
  values: Record<string, unknown> | undefined,
): Record<string, ReadonlySignal<unknown>> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([name, value]) => [
      name,
      isSignal(value) ? (value as ReadonlySignal<unknown>) : constant(value),
    ]),
  )
}

/**
 * Slot content from sample content. Each slot is a function, as a component expects: it builds its nodes when the
 * component mounts it. `resolve` finds a component by name (it must already be loaded: see `previewComponents`).
 */
export function previewSlots(
  slots: Record<string, PreviewContent> | undefined,
  resolve: (name: string) => Component | undefined,
): Record<string, SlotContent> {
  const r = getRenderer()

  const build = (node: PreviewNode): Child<any, any> => {
    if (typeof node === 'string') return node
    if ('component' in node) {
      const component = resolve(node.component)
      if (!component) throw new Error(`The preview uses ${node.component}, which does not exist.`)
      return component({
        props: previewProps(node.props),
        events: {},
        slots: previewSlots(node.slots, resolve),
      })
    }
    const children: Child<any, any>[] = []
    if (node.text !== undefined) children.push(node.text)
    if (node.children !== undefined) children.push(...asList(node.children).map(build))
    return r.el(
      node.tag,
      {
        attrs: Object.fromEntries(
          Object.entries(node.attrs ?? {}).map(([k, v]) => [
            k,
            typeof v === 'boolean' ? v : String(v),
          ]),
        ),
      },
      ...children,
    )
  }

  return Object.fromEntries(
    Object.entries(slots ?? {}).map(([name, content]) => [name, () => asList(content).map(build)]),
  )
}
