import type { RendererAdapter } from './adapter'
import { createDomAdapter } from './adapter'
import { createRenderer, type Mountable, type Renderer, type SlotContent } from './renderer'
import {
  type ReadonlySignal,
  constant,
  createScope,
  derived,
  effect,
  getOwner,
  runInScope,
} from './signals'

let renderer: Renderer<any, any> | undefined

/** Choose the renderer that compiled components use. By default, the DOM. */
export function setRenderer(adapter: RendererAdapter<any, any>): void {
  renderer = createRenderer(adapter)
}

export function getRenderer(): Renderer<Node, Element> {
  renderer ??= createRenderer(createDomAdapter())
  return renderer as Renderer<Node, Element>
}

/** What a parent passes when it uses a component. Compiled templates build this. */
export interface ComponentInput {
  /** Every attribute the parent set, as read-only signals. Static values are constant signals. */
  props?: Record<string, ReadonlySignal<unknown>>
  /** Handlers for the events the parent listens to. */
  events?: Record<string, (detail?: unknown) => void>
  slots?: Record<string, SlotContent>
}

export interface ComponentContext {
  /**
   * The component's props as read-only signals: its contract variants plus any extra props named in
   * `defaults`. Call it more than once; each prop is one signal.
   */
  props<T extends Record<string, unknown> = Record<string, never>>(
    defaults?: T,
  ): { [K in keyof T]: ReadonlySignal<T[K]> } & Record<string, ReadonlySignal<any>>
  emit(name: string, detail?: unknown): void
  slot(name: string, fallback?: SlotContent): Mountable<any, any>
  /**
   * Finish the component: put variant `data-*` attributes and the attributes the parent passed that
   * the component did not claim as props (`class`, `aria-*`, ...) on the root element.
   * `rootClass` is the root's static class, which a parent's `class` is appended to.
   */
  root<T>(node: T, rootClass?: string): T
}

export type Component = (input?: ComponentInput) => any

type Setup = (ctx: ComponentContext) => any

interface Instance {
  input: ComponentInput
  node: any
  dispose: () => void
}

interface Definition {
  variants: Record<string, string>
  setup: Setup
  instances: Set<Instance>
  component: Component
}

const definitions = new Map<string, Definition>()

/**
 * Wrap a compiled setup function as a component. `variants` maps each contract variant to its default
 * (the first allowed value). With an `hmrId`, re-evaluating the module swaps the implementation and
 * re-renders live instances in place.
 */
export function defineComponent(
  name: string,
  variants: Record<string, string>,
  setup: Setup,
  hmrId?: string,
): Component {
  const existing = hmrId === undefined ? undefined : definitions.get(hmrId)
  if (existing) {
    existing.variants = variants
    existing.setup = setup
    for (const instance of [...existing.instances]) replace(existing, instance)
    return existing.component
  }

  const definition: Definition = {
    variants,
    setup,
    instances: new Set(),
    component: undefined as unknown as Component,
  }
  definition.component = (input = {}) => {
    const instance: Instance = { input, node: undefined, dispose: () => {} }
    render(definition, instance)
    if (hmrId !== undefined) definition.instances.add(instance)
    return instance.node
  }
  if (hmrId !== undefined) definitions.set(hmrId, definition)
  return definition.component
}

function render(definition: Definition, instance: Instance): void {
  const scope = createScope(getOwner())
  instance.dispose = () => scope.dispose()
  instance.node = runInScope(scope, () =>
    definition.setup(createContext(definition.variants, instance.input)),
  )
}

function replace(definition: Definition, instance: Instance): void {
  const adapter = getRenderer().adapter
  const old = instance.node
  const parent = adapter.parentNode(old)
  instance.dispose()
  render(definition, instance)
  if (parent) {
    adapter.insert(parent, instance.node, old)
    adapter.remove(old)
  }
}

function createContext(
  variantDefaults: Record<string, string>,
  input: ComponentInput,
): ComponentContext {
  const passed = input.props ?? {}
  const claimed = new Set<string>()
  const signals = new Map<string, ReadonlySignal<any>>()

  const prop = (key: string, fallback: unknown): ReadonlySignal<any> => {
    claimed.add(key)
    const known = signals.get(key)
    if (known) return known
    const given = passed[key]
    let signal: ReadonlySignal<any>
    if (!given) signal = constant(fallback)
    else if (fallback === undefined) signal = given
    else signal = derived(() => (given.value === undefined ? fallback : given.value))
    signals.set(key, signal)
    return signal
  }

  // Variants are props whether or not the script asks for them.
  for (const [key, value] of Object.entries(variantDefaults)) prop(key, value)

  const r = getRenderer()
  const adapter = r.adapter

  return {
    props(defaults = {} as never) {
      const out: Record<string, ReadonlySignal<any>> = {}
      for (const key of Object.keys(variantDefaults)) out[key] = prop(key, variantDefaults[key])
      for (const [key, value] of Object.entries(defaults)) out[key] = prop(key, value)
      return out as never
    },
    emit(event, detail) {
      input.events?.[event]?.(detail)
    },
    slot(slotName, fallback) {
      return r.slot(input.slots?.[slotName], fallback)
    },
    root(node, rootClass) {
      const el = node as any
      for (const key of Object.keys(variantDefaults)) {
        const signal = prop(key, variantDefaults[key])
        effect(() => adapter.setAttribute(el, `data-${key}`, String(signal.value)))
      }
      for (const [key, signal] of Object.entries(passed)) {
        if (claimed.has(key)) continue
        effect(() => {
          const value = signal.value
          if (key === 'class') {
            const joined = [rootClass, value]
              .filter((v) => v !== undefined && v !== '' && v !== false && v !== null)
              .join(' ')
            adapter.setAttribute(el, 'class', joined === '' ? null : joined)
          } else if (value === true) adapter.setAttribute(el, key, '')
          else if (value === false || value === null || value === undefined)
            adapter.setAttribute(el, key, null)
          else adapter.setAttribute(el, key, String(value))
        })
      }
      return node
    },
  }
}
