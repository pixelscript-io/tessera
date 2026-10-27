import type { RendererAdapter } from './adapter'
import {
  type ReadonlySignal,
  createRoot,
  createScope,
  derived,
  effect,
  getOwner,
  isSignal,
  onCleanup,
  runInScope,
  state,
  untrack,
} from './signals'

const MOUNTABLE = Symbol('tessera.mountable')

/** A dynamic child (a keyed list, a conditional, a slot) that manages its own nodes between two positions. */
export interface Mountable<N, E extends N> {
  readonly [MOUNTABLE]: true
  mount(parent: E, anchor: N | null): void
}

export type Child<N, E extends N> = string | number | N | (() => string | number) | Mountable<N, E>

/** Content a parent passes to a component slot. It runs when the slot is mounted. */
export type SlotContent<N = any, E extends N = any> = () => Child<N, E>[]

export interface ElementOptions {
  /** A function value is bound reactively. `true` sets an empty attribute; `false`/`null` removes it. */
  attrs?: Record<string, string | boolean | null | (() => string | boolean | null)>
  props?: Record<string, unknown | (() => unknown)>
  on?: Record<string, (event: any) => void>
  /**
   * Behaviors and other setup to run on the element once it is built (a press behavior, for example).
   * A returned function is called when the element's scope is disposed.
   */
  use?: Array<(el: any) => void | (() => void)>
  /** `'svg'` for `<svg>` and everything inside it. */
  ns?: 'svg'
}

export interface Renderer<N, E extends N> {
  readonly adapter: RendererAdapter<N, E>
  el(tag: string, options?: ElementOptions, ...children: Child<N, E>[]): E
  text(source: string | number | (() => string | number)): N
  each<T, K>(
    items: () => readonly T[],
    key: (item: T) => K,
    render: (item: ReadonlySignal<T>) => N,
  ): Mountable<N, E>
  /** `select` returns the index of the branch to show, or -1 for none. Branches are rebuilt only when the index changes. */
  cond(select: () => number, branches: Array<() => N>): Mountable<N, E>
  /**
   * Show whatever `select` returns (a function that builds a node), and rebuild only when it returns a
   * different function. The router uses it for the current page. `onRender` receives each new node.
   */
  view(select: () => (() => N) | undefined, onRender?: (node: N) => void): Mountable<N, E>
  /** Mount slot content from a parent, or `fallback` when the parent provided none. */
  slot(content: SlotContent<N, E> | undefined, fallback?: SlotContent<N, E>): Mountable<N, E>
  /** Build `build()` and attach it to `container`. Returns a disposer that also removes it. */
  mount(container: E, build: () => N): () => void
}

const warned = new Set<string>()
function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(`[tessera] ${message}`)
}

/** Attributes whose value is an address the browser follows or loads. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href'])

/** An address that would run script in this page: `javascript:` or `vbscript:`, however it is spelled. */
const runsScript = (value: string): boolean =>
  // The browser ignores tabs, newlines and control characters in a scheme, and leading whitespace.
  // eslint-disable-next-line no-control-regex -- those characters are the point
  /^(?:javascript|vbscript):/i.test(value.replace(/[\u0000-\u0020\u007f-\u009f]+/g, ''))

/**
 * What may be set for an attribute or property. An address that would run script becomes `about:blank`, and an event
 * handler attribute (`onclick`) is not set: both are what a value taken from data (an API answer, a query string)
 * could use to run code in the page. Anything else is returned as it is.
 */
function safely(name: string, value: unknown): { value: unknown; refused?: string } {
  if (/^on[a-z]{3,}$/i.test(name))
    return { value: null, refused: 'is an event handler written as an attribute' }
  if (typeof value === 'string' && URL_ATTRIBUTES.has(name.toLowerCase()) && runsScript(value))
    return { value: 'about:blank', refused: 'was a script address' }
  return { value }
}

export function createRenderer<N, E extends N>(adapter: RendererAdapter<N, E>): Renderer<N, E> {
  function text(source: string | number | (() => string | number)): N {
    if (typeof source !== 'function') return adapter.createText(String(source))
    const node = adapter.createText('')
    let last = ''
    effect(() => {
      const value = source()
      if (isSignal(value)) {
        warnOnce(
          'A signal was rendered as text without being unwrapped. Only top-level bindings unwrap in templates; destructure it to a top-level binding or read .value.',
        )
      }
      const next = String(value)
      if (next === last) return
      last = next
      adapter.setText(node, next)
    })
    return node
  }

  function guarded(name: string, value: unknown): unknown {
    const checked = safely(name, value)
    if (checked.refused)
      warnOnce(
        `The value of "${name}" ${checked.refused}, so it was not used. Addresses must be http, https, mailto, tel or relative, and handlers are written @click.`,
      )
    return checked.value
  }

  function attrValue(value: string | boolean | null): string | null {
    if (value === true) return ''
    if (value === false || value === null || value === undefined) return null
    return String(value)
  }

  /** Insert one child before `anchor`. Returns the node it created, if it created exactly one. */
  function append(parent: E, child: Child<N, E>, anchor: N | null): N | undefined {
    if (typeof child === 'string' || typeof child === 'number' || typeof child === 'function') {
      const node = text(child as string | number | (() => string | number))
      adapter.insert(parent, node, anchor)
      return node
    }
    if (isMountable<N, E>(child)) {
      child.mount(parent, anchor)
      return undefined
    }
    adapter.insert(parent, child, anchor)
    return child
  }

  function el(tag: string, options: ElementOptions = {}, ...children: Child<N, E>[]): E {
    const element = adapter.createElement(tag, options.ns)

    for (const [name, value] of Object.entries(options.attrs ?? {})) {
      if (typeof value === 'function') {
        effect(() =>
          adapter.setAttribute(element, name, attrValue(guarded(name, value()) as string | null)),
        )
      } else {
        adapter.setAttribute(element, name, attrValue(guarded(name, value) as string | null))
      }
    }
    for (const [name, value] of Object.entries(options.props ?? {})) {
      if (typeof value === 'function') {
        effect(() => adapter.setProperty(element, name, guarded(name, (value as () => unknown)())))
      } else {
        adapter.setProperty(element, name, guarded(name, value))
      }
    }
    for (const [type, handler] of Object.entries(options.on ?? {})) {
      adapter.addListener(element, type, handler)
      if (getOwner()) onCleanup(() => adapter.removeListener(element, type, handler))
    }

    for (const attach of options.use ?? []) {
      const cleanup = attach(element)
      if (typeof cleanup === 'function' && getOwner()) onCleanup(cleanup)
    }

    for (const child of children) append(element, child, null)
    return element
  }

  function each<T, K>(
    items: () => readonly T[],
    key: (item: T) => K,
    render: (item: ReadonlySignal<T>) => N,
  ): Mountable<N, E> {
    return {
      [MOUNTABLE]: true,
      mount(parent, anchor) {
        const owner = getOwner()
        const marker = adapter.createText('')
        adapter.insert(parent, marker, anchor)

        interface Entry {
          item: ReturnType<typeof state<T>>
          node: N
          dispose: () => void
        }
        const entries = new Map<K, Entry>()

        function create(value: T): Entry {
          const item = state(value)
          const scope = createScope(owner)
          const node = runInScope(scope, () => render(item))
          return { item, node, dispose: () => scope.dispose() }
        }

        effect(() => {
          const list = items()
          const keys = list.map(key)
          const seen = new Set<K>()
          for (const k of keys) {
            if (seen.has(k)) {
              throw new Error(
                `Duplicate key ${String(k)} in each. Keys must be unique within a list.`,
              )
            }
            seen.add(k)
          }

          for (const [k, entry] of entries) {
            if (!seen.has(k)) {
              entry.dispose()
              adapter.remove(entry.node)
              entries.delete(k)
            }
          }

          // Walk backwards so each node is positioned relative to its already-placed successor.
          let next: N = marker
          for (let i = list.length - 1; i >= 0; i--) {
            const k = keys[i] as K
            const value = list[i] as T
            let entry = entries.get(k)
            if (!entry) {
              entry = create(value)
              entries.set(k, entry)
              adapter.insert(parent, entry.node, next)
            } else {
              entry.item.value = value
              if (adapter.nextSibling(entry.node) !== next) adapter.move(parent, entry.node, next)
            }
            next = entry.node
          }
        })

        onCleanup(() => {
          for (const entry of entries.values()) {
            entry.dispose()
            adapter.remove(entry.node)
          }
          entries.clear()
          adapter.remove(marker)
        })
      },
    }
  }

  function cond(select: () => number, branches: Array<() => N>): Mountable<N, E> {
    return {
      [MOUNTABLE]: true,
      mount(parent, anchor) {
        const owner = getOwner()
        const marker = adapter.createText('')
        adapter.insert(parent, marker, anchor)
        const index = derived(select)
        let current: { node: N; dispose: () => void } | undefined

        const clear = () => {
          if (!current) return
          current.dispose()
          adapter.remove(current.node)
          current = undefined
        }

        effect(() => {
          const i = index.value
          clear()
          const make = branches[i]
          if (!make) return
          const scope = createScope(owner)
          const node = runInScope(scope, make)
          adapter.insert(parent, node, marker)
          current = { node, dispose: () => scope.dispose() }
        })

        onCleanup(() => {
          clear()
          adapter.remove(marker)
        })
      },
    }
  }

  function view(
    select: () => (() => N) | undefined,
    onRender?: (node: N) => void,
  ): Mountable<N, E> {
    return {
      [MOUNTABLE]: true,
      mount(parent, anchor) {
        const owner = getOwner()
        const marker = adapter.createText('')
        adapter.insert(parent, marker, anchor)
        const current = derived(select)
        let shown: { node: N; dispose: () => void } | undefined

        const clear = () => {
          if (!shown) return
          shown.dispose()
          adapter.remove(shown.node)
          shown = undefined
        }

        effect(() => {
          const make = current.value
          clear()
          if (!make) return
          const scope = createScope(owner)
          const node = runInScope(scope, make)
          adapter.insert(parent, node, marker)
          shown = { node, dispose: () => scope.dispose() }
          untrack(() => onRender?.(node))
        })

        onCleanup(() => {
          clear()
          adapter.remove(marker)
        })
      },
    }
  }

  function slot(
    content: SlotContent<N, E> | undefined,
    fallback?: SlotContent<N, E>,
  ): Mountable<N, E> {
    return {
      [MOUNTABLE]: true,
      mount(parent, anchor) {
        const marker = adapter.createText('')
        adapter.insert(parent, marker, anchor)
        const scope = createScope(getOwner())
        const nodes: N[] = []
        runInScope(scope, () => {
          for (const child of (content ?? fallback)?.() ?? []) {
            const node = append(parent, child, marker)
            if (node !== undefined) nodes.push(node)
          }
        })
        onCleanup(() => {
          scope.dispose()
          for (const node of nodes) adapter.remove(node)
          adapter.remove(marker)
        })
      },
    }
  }

  function mount(container: E, build: () => N): () => void {
    return createRoot((dispose) => {
      const node = build()
      adapter.insert(container, node, null)
      return () => {
        dispose()
        adapter.remove(node)
      }
    })
  }

  return { adapter, el, text, each, cond, view, slot, mount }
}

function isMountable<N, E extends N>(value: unknown): value is Mountable<N, E> {
  return typeof value === 'object' && value !== null && MOUNTABLE in value
}
