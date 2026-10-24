import { getRenderer, type Component } from './component'
import { state, type Signal } from './signals'

/** What a custom element needs to know about a component: the contract and the script's props, as plain data. */
export interface ElementSpec {
  /** Variants, which are string attributes with a default. */
  variants?: Array<{ name: string; values: readonly string[]; default: string }>
  /** The other props the script names, with the kind of value each takes and its default. */
  props?: Array<{
    name: string
    type: 'boolean' | 'number' | 'string' | 'array' | 'object' | 'unknown'
    default?: unknown
  }>
  /** The events the component emits, which the element dispatches as DOM events of the same name. */
  events?: readonly string[]
  /** The slot names the component declares. `default` is the content between the tags. */
  slots?: readonly string[]
}

type Kind = NonNullable<ElementSpec['props']>[number]['type']

/** `checkedState` to `checked-state`: the attribute an element's property is read from. */
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** An attribute's text as the kind of value its prop takes. */
function fromAttribute(kind: Kind, text: string | null): unknown {
  if (kind === 'boolean') return text !== null && text !== 'false'
  if (text === null) return undefined
  if (kind === 'number') return Number(text)
  if (kind === 'array' || kind === 'object' || (kind === 'unknown' && /^[[{]/.test(text.trim()))) {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }
  return text
}

/**
 * Register a Tessera component as a custom element, so it can be used from any framework, or from plain HTML.
 *
 * - **Variants and props are attributes and properties.** `<t-button tone="danger" disabled>`, and `el.tone = 'danger'`.
 *   A boolean is on when its attribute is present (and not `"false"`); a list or an object is set as a property
 *   (`el.options = [...]`), or as JSON in the attribute.
 * - **Events are DOM events.** What the component emits (`press`, `toggle`, ...) is dispatched on the element as a
 *   `CustomEvent` with the same name, with the payload in `detail`. It bubbles and crosses shadow roots. A native event of
 *   the same name from something inside the component (an `input`'s own `input` event) is stopped at the component's
 *   root, so listeners on the element see the component's events and not both.
 * - **Slots are children.** Read when the element connects: children with `slot="name"` fill that slot, the rest fill the
 *   default slot. They are not watched afterward.
 * - **It renders in the light DOM**, so the page's tokens and the component's own styles apply, and `display: contents`
 *   keeps the element itself out of the layout.
 *
 * Returns the element class. Registering a tag that exists already does nothing.
 */
export function defineElement(
  tag: string,
  component: Component,
  spec: ElementSpec = {},
): CustomElementConstructor | undefined {
  if (typeof customElements === 'undefined') return undefined
  const existing = customElements.get(tag)
  if (existing) return existing

  const variants = spec.variants ?? []
  const props = spec.props ?? []
  const events = spec.events ?? []
  const names = [
    ...variants.map((v) => ({ name: v.name, kind: 'string' as Kind })),
    ...props.map((p) => ({ name: p.name, kind: p.type })),
  ]

  class TesseraElement extends HTMLElement {
    static observedAttributes = names.map((n) => kebab(n.name))

    private values = new Map<string, Signal<unknown>>()
    private slots: Record<string, Node[]> | undefined
    private dispose: (() => void) | undefined
    private mounted = false

    constructor() {
      super()
      // A property set before the element was upgraded (a framework set it on a plain element) is taken now.
      for (const { name } of names) {
        if (Object.prototype.hasOwnProperty.call(this, name)) {
          const value = (this as any)[name]
          delete (this as any)[name]
          this.setValue(name, value)
        }
      }
    }

    private signal(name: string): Signal<unknown> {
      let s = this.values.get(name)
      if (!s) {
        s = state<unknown>(undefined)
        this.values.set(name, s)
      }
      return s
    }

    private setValue(name: string, value: unknown) {
      this.signal(name).value = value
    }

    attributeChangedCallback(attribute: string, _old: string | null, text: string | null) {
      const entry = names.find((n) => kebab(n.name) === attribute)
      if (entry) this.setValue(entry.name, fromAttribute(entry.kind, text))
    }

    connectedCallback() {
      if (this.mounted) return
      this.mounted = true
      this.style.display = this.style.display || 'contents'
      // The attributes it was written with are the first values; a property set already wins.
      for (const { name, kind } of names) {
        const signal = this.signal(name)
        if (signal.peek() === undefined) {
          const written = fromAttribute(kind, this.getAttribute(kebab(name)))
          if (written !== undefined) signal.value = written
        }
      }
      this.slots ??= this.takeSlots()
      const r = getRenderer()
      const slotted = this.slots
      this.dispose = r.mount(this, () =>
        component({
          props: Object.fromEntries(names.map(({ name }) => [name, this.signal(name)] as const)),
          events: Object.fromEntries(
            events.map(
              (name) =>
                [
                  name,
                  (detail?: unknown) =>
                    this.dispatchEvent(
                      new CustomEvent(name, { detail, bubbles: true, composed: true }),
                    ),
                ] as const,
            ),
          ),
          slots: Object.fromEntries(
            Object.entries(slotted).map(([slot, nodes]) => [slot, () => nodes] as const),
          ),
        }),
      )
      // A native event named like one of the component's, from inside it, is not the component's event: it is stopped
      // at the component's own root, after the component's handlers have seen it, before it reaches the element.
      for (const child of Array.from(this.children))
        for (const name of events) child.addEventListener(name, this.stopNative)
    }

    disconnectedCallback() {
      if (!this.mounted) return
      this.mounted = false
      this.dispose?.()
      this.dispose = undefined
      // What the component rendered is gone; the slot content waits for the next time.
      this.replaceChildren()
    }

    private stopNative = (event: Event) => {
      if (!(event instanceof CustomEvent)) event.stopPropagation()
    }

    /** Children by the slot they name. They are taken out, to be handed to the component as its slots. */
    private takeSlots(): Record<string, Node[]> {
      const out: Record<string, Node[]> = {}
      for (const node of Array.from(this.childNodes)) {
        const slot =
          node instanceof Element && node.hasAttribute('slot')
            ? (node.getAttribute('slot') as string)
            : 'default'
        ;(out[slot] ??= []).push(node)
        node.parentNode?.removeChild(node)
      }
      return out
    }
  }

  // Every variant and prop is a property too, so a framework can set what an attribute cannot carry.
  for (const { name } of names) {
    Object.defineProperty(TesseraElement.prototype, name, {
      get(this: TesseraElement) {
        return (this as any).signal(name).peek()
      },
      set(this: TesseraElement, value: unknown) {
        ;(this as any).setValue(name, value)
      },
      enumerable: true,
      configurable: true,
    })
  }

  customElements.define(tag, TesseraElement)
  return TesseraElement
}
