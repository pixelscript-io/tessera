/**
 * The only surface through which the renderer touches a host tree. Anything
 * above `@tessera/core` (tokens, contracts, behaviors) goes through this
 * interface or through generated code, so the engine can be swapped later.
 */
export interface RendererAdapter<N = unknown, E extends N = N> {
  createElement(tag: string): E
  createText(text: string): N
  /** `null` removes the attribute. */
  setAttribute(el: E, name: string, value: string | null): void
  setProperty(el: E, name: string, value: unknown): void
  getAttribute(el: E, name: string): string | null
  setText(node: N, text: string): void
  /** Insert a node that is not yet attached. `anchor === null` appends. */
  insert(parent: E, node: N, anchor: N | null): void
  /** Reposition a node that is already attached. */
  move(parent: E, node: N, anchor: N | null): void
  remove(node: N): void
  nextSibling(node: N): N | null
  parentNode(node: N): E | null
  addListener(el: E, type: string, handler: (event: any) => void): void
  removeListener(el: E, type: string, handler: (event: any) => void): void
}

export function createDomAdapter(doc: Document = document): RendererAdapter<Node, Element> {
  return {
    createElement: (tag) => doc.createElement(tag),
    createText: (text) => doc.createTextNode(text),
    setAttribute: (el, name, value) => {
      if (value === null) el.removeAttribute(name)
      else el.setAttribute(name, value)
    },
    setProperty: (el, name, value) => {
      ;(el as unknown as Record<string, unknown>)[name] = value
    },
    getAttribute: (el, name) => el.getAttribute(name),
    setText: (node, text) => {
      node.textContent = text
    },
    insert: (parent, node, anchor) => {
      parent.insertBefore(node, anchor)
    },
    move: (parent, node, anchor) => {
      parent.insertBefore(node, anchor)
    },
    remove: (node) => {
      node.parentNode?.removeChild(node)
    },
    nextSibling: (node) => node.nextSibling,
    parentNode: (node) => node.parentElement,
    addListener: (el, type, handler) => el.addEventListener(type, handler),
    removeListener: (el, type, handler) => el.removeEventListener(type, handler),
  }
}
