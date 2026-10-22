import { nearest, type Contract } from '@tessera/contract'
import type { Reporter } from './diagnostics'
import { rewriteExpression, type ExprScope } from './expr'
import { BEHAVIOR_EVENTS, BEHAVIOR_REQUIREMENTS } from '@tessera/behavior'
import { unknownRoute } from './routes'
import type { Binding } from './script'
import type { Attr, ElementNode, TemplateNode, TextNode } from './template'

export interface ComponentInfo {
  contract: Contract
  /** Module to import the component from, as written in the importing file. */
  importPath: string
}

export interface ComponentResolver {
  resolve(tag: string): ComponentInfo | undefined
  /** Names offered as "Did you mean" suggestions for an unknown tag. */
  names(): string[]
  /** The import line to add for a component that exists but is not importable here (auto-imports off). */
  importHint?(tag: string): string | undefined
}

export interface GenerateContext {
  report: Reporter
  bindings: ReadonlyMap<string, Binding>
  /** Contract of the file being compiled, if it has one. */
  contract?: Contract
  resolver?: ComponentResolver
  /** Offset of the template block's content, for errors about the template as a whole. */
  templateStart: number
  /** Prepended to every class name in the template, such as `t-Button__`. */
  classPrefix: string
  /** Route patterns (`/blog/:slug`). When given, a literal `to` on `<Link>` must match one. */
  routes?: readonly string[]
}

export interface Generated {
  /** JavaScript expression for the root element. */
  root: string
  /** Static class of the root element, which a parent's `class` is appended to. */
  rootClass?: string
  /** Every class used in the template, for checking contract parts. */
  classes: Set<string>
  rootClasses: string[]
  /** Components used by tag, with where to import them from. */
  components: Map<string, ComponentInfo>
  /** Behaviors the template wires, so the module imports them. */
  behaviors: Set<string>
}

type Locals = ReadonlyMap<string, 'signal' | 'plain'>

const DIRECTIVES = new Set(['if', 'else-if', 'else', 'each', 'key', 'slot'])
const PROPERTY_ATTRS = new Set(['value', 'checked', 'selected', 'indeterminate'])
const BINDABLE = new Set(['input', 'textarea', 'select'])

/** Elements the browser already activates with Enter and Space. */
function isNativelyPressable(el: ElementNode): boolean {
  const attr = (name: string) => el.attrs.find((a) => a.name === name || a.name === `:${name}`)
  if (el.tag === 'button' || el.tag === 'summary') return true
  if (el.tag === 'a') return attr('href') !== undefined
  if (el.tag === 'input') return ['button', 'submit', 'reset'].includes(attr('type')?.value ?? '')
  return false
}

const q = (s: string) => JSON.stringify(s)
const isComponentTag = (tag: string) => /^[A-Z]/.test(tag)

export function generateTemplate(
  nodes: TemplateNode[],
  source: string,
  ctx: GenerateContext,
): Generated | undefined {
  const { report } = ctx
  const classes = new Set<string>()
  const components = new Map<string, ComponentInfo>()
  const behaviors = new Set<string>()

  const rootNodes = nodes.filter(
    (n) => !(n.type === 'text' && n.parts.every((p) => p.kind === 'text' && p.value.trim() === '')),
  )
  if (rootNodes.length === 0) {
    report.error(
      'T4004',
      ctx.templateStart,
      'The template is empty. A component needs exactly one root element.',
    )
    return undefined
  }
  const elements = rootNodes.filter((n): n is ElementNode => n.type === 'element')
  if (rootNodes.length > 1 || elements.length !== 1) {
    const at = rootNodes[1]?.start ?? rootNodes[0]!.start
    report.error(
      'T4004',
      at,
      `A template must have exactly one root element, found ${rootNodes.length}. Wrap them in a single element such as <div class="root">.`,
    )
    return undefined
  }
  const rootElement = elements[0]!
  for (const attr of rootElement.attrs) {
    if (
      attr.name === 'if' ||
      attr.name === 'else-if' ||
      attr.name === 'else' ||
      attr.name === 'each'
    ) {
      report.error(
        'T4004',
        attr.nameStart,
        `The root element cannot use "${attr.name}". Put it on an element inside the root.`,
      )
      return undefined
    }
  }

  const scoped = (value: string) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => ctx.classPrefix + c)
      .join(' ')

  const exprScope = (locals: Locals): ExprScope => ({ bindings: ctx.bindings, locals })

  /** Rewrite an attribute's expression. Reports and returns undefined on a problem. */
  function attrExpr(attr: Attr, locals: Locals, mode: 'expr' | 'handler' = 'expr') {
    if (attr.value === null || attr.value.trim() === '') {
      report.error(
        'T4011',
        attr.nameStart,
        `"${attr.name}" needs a value, for example ${attr.name}="expression".`,
      )
      return undefined
    }
    return rewriteExpression(attr.value, attr.valueStart, mode, exprScope(locals), report)
  }

  function handler(attr: Attr, locals: Locals): string | undefined {
    const result = attrExpr(attr, locals, 'handler')
    if (!result) return undefined
    if (!result.simplePath) return `($event: any) => { ${result.code} }`
    // A plain function is the handler itself, so its own parameter types are checked against the event.
    if (ctx.bindings.get(result.code)?.signal === 'callable') return result.code
    return `(...$a: any[]) => (${result.code} as any)(...$a)`
  }

  function genText(node: TextNode, locals: Locals): string | undefined {
    const parts = node.parts
    // Whitespace that contains a line break at either end of the text is formatting, not content.
    const normalized = parts.map((p, i) => {
      if (p.kind !== 'text') return p
      let value = p.value
      if (i === 0 && /^\s*\n/.test(value)) value = value.replace(/^\s+/, '')
      if (i === parts.length - 1 && /\n\s*$/.test(value)) value = value.replace(/\s+$/, '')
      return { kind: 'text' as const, value: value.replace(/\s+/g, ' ') }
    })
    const pieces: string[] = []
    let sole = ''
    let dynamic = false
    for (const part of normalized) {
      if (part.kind === 'text') {
        if (part.value !== '') pieces.push(q(part.value))
      } else {
        const result = rewriteExpression(part.code, part.start, 'expr', exprScope(locals), report)
        if (!result) return undefined
        dynamic = true
        pieces.push(`(${result.code})`)
        sole = result.code
      }
    }
    if (pieces.length === 0) return undefined
    if (!dynamic) return pieces.join(' + ')
    if (pieces.length === 1) return `() => (${sole})`
    return `() => ${pieces.join(' + ')}`
  }

  const stripped = (el: ElementNode): ElementNode => ({
    ...el,
    attrs: el.attrs.filter((a) => !DIRECTIVES.has(a.name)),
  })

  function genChildren(children: TemplateNode[], locals: Locals): string[] {
    const out: string[] = []
    const isBlank = (n: TemplateNode | undefined) =>
      n?.type === 'text' && n.parts.every((p) => p.kind === 'text' && p.value.trim() === '')

    for (let i = 0; i < children.length; i++) {
      const node = children[i]!
      if (node.type === 'text') {
        const text = genText(node, locals)
        if (text !== undefined) out.push(text)
        continue
      }

      const elseAttr = node.attrs.find((a) => a.name === 'else' || a.name === 'else-if')
      if (elseAttr) {
        report.error(
          'T4011',
          elseAttr.nameStart,
          `"${elseAttr.name}" needs an element with "if" or "else-if" right before it.`,
        )
        continue
      }

      const ifAttr = node.attrs.find((a) => a.name === 'if')
      const eachAttr = node.attrs.find((a) => a.name === 'each')
      if (ifAttr && eachAttr) {
        report.error(
          'T4011',
          eachAttr.nameStart,
          'An element cannot have both "if" and "each". Put one of them on a wrapper element.',
        )
        continue
      }

      if (eachAttr) {
        const each = genEach(node, eachAttr, locals)
        if (each) out.push(each)
        continue
      }

      if (!ifAttr) {
        const keyAttr = node.attrs.find((a) => a.name === 'key')
        if (keyAttr)
          report.error('T4011', keyAttr.nameStart, '"key" is only used together with "each".')
        const value = genNode(stripped(node), locals)
        if (value) out.push(value)
        continue
      }

      // if / else-if / else chain.
      const branches: Array<{ test: string | null; value: string | undefined }> = []
      const test = attrExpr(ifAttr, locals)
      branches.push({ test: test?.code ?? 'false', value: genNode(stripped(node), locals) })
      let j = i + 1
      for (;;) {
        let k = j
        while (isBlank(children[k])) k++
        const next = children[k]
        if (next?.type !== 'element') break
        const elseIf = next.attrs.find((a) => a.name === 'else-if')
        const plainElse = next.attrs.find((a) => a.name === 'else')
        if (!elseIf && !plainElse) break
        if (elseIf) {
          const t = attrExpr(elseIf, locals)
          branches.push({ test: t?.code ?? 'false', value: genNode(stripped(next), locals) })
        } else {
          branches.push({ test: null, value: genNode(stripped(next), locals) })
        }
        j = k + 1
        if (plainElse) break
      }
      i = j - 1

      let select = '-1'
      for (let b = branches.length - 1; b >= 0; b--) {
        const branch = branches[b]!
        select = branch.test === null ? String(b) : `(${branch.test}) ? ${b} : ${select}`
      }
      out.push(
        `$r.cond(() => ${select}, [${branches.map((b) => `() => ${b.value ?? 'null'}`).join(', ')}])`,
      )
    }
    return out
  }

  function genEach(node: ElementNode, eachAttr: Attr, locals: Locals): string | undefined {
    const match = /^\s*([A-Za-z_$][\w$]*)\s+in\s+([\s\S]+)$/.exec(eachAttr.value ?? '')
    if (!match) {
      report.error(
        'T4011',
        eachAttr.valueStart,
        `"each" must look like each="item in items", got ${q(eachAttr.value ?? '')}.`,
      )
      return undefined
    }
    const item = match[1]!
    const itemsStart = eachAttr.valueStart + eachAttr.value!.length - match[2]!.length
    const keyAttr = node.attrs.find((a) => a.name === 'key')
    if (!keyAttr) {
      report.error(
        'T4011',
        node.end,
        `"each" needs a key, for example <${node.tag} each="${item} in items" key="${item}.id">.`,
      )
      return undefined
    }
    const items = rewriteExpression(match[2]!, itemsStart, 'expr', exprScope(locals), report)
    const key = keyAttr.value
      ? rewriteExpression(
          keyAttr.value,
          keyAttr.valueStart,
          'expr',
          exprScope(new Map([...locals, [item, 'plain']])),
          report,
        )
      : (report.error(
          'T4011',
          keyAttr.nameStart,
          '"key" needs a value, for example key="item.id".',
        ),
        undefined)
    const body = genNode(stripped(node), new Map([...locals, [item, 'signal']]))
    if (!items || !key || !body) return undefined
    return `$r.each(() => (${items.code}), (${item}) => (${key.code}), (${item}) => ${body})`
  }

  function genNode(el: ElementNode, locals: Locals): string | undefined {
    if (el.tag === 'slot') return genSlot(el, locals)
    if (isComponentTag(el.tag)) return genComponent(el, locals)
    return genElement(el, locals)
  }

  function genElement(el: ElementNode, locals: Locals): string | undefined {
    const attrs: string[] = []
    const props: string[] = []
    const handlers = new Map<string, string[]>()
    let ok = true

    for (const attr of el.attrs) {
      const { name } = attr
      if (name.startsWith(':')) {
        const result = attrExpr(attr, locals)
        if (!result) {
          ok = false
          continue
        }
        if (name === ':class') {
          report.warn(
            'W4102',
            attr.nameStart,
            'Class names produced by :class are not scoped to this component, so they will not match classes in <style>.',
            'Use a data attribute, or if/else with static class attributes.',
          )
        }
        const target = PROPERTY_ATTRS.has(name.slice(1)) ? props : attrs
        target.push(`${q(name.slice(1))}: () => (${result.code})`)
      } else if (name.startsWith('@')) {
        const fn = handler(attr, locals)
        if (!fn) {
          ok = false
          continue
        }
        const event = name.slice(1)
        handlers.set(event, [...(handlers.get(event) ?? []), fn])
      } else if (name.startsWith('bind:')) {
        const prop = name.slice(5)
        const target = attr.value?.trim() ?? ''
        const binding = ctx.bindings.get(target)
        if (prop !== 'value' || !BINDABLE.has(el.tag)) {
          report.error(
            'T4011',
            attr.nameStart,
            `"${name}" works only as bind:value on <input>, <textarea> and <select>.`,
          )
          ok = false
        } else if (!binding || binding.signal !== 'signal') {
          report.error(
            'T4011',
            attr.valueStart,
            binding
              ? `bind:value needs a signal made with state(), but "${target}" is not one.`
              : `bind:value needs a signal made with state(), but "${target}" is not declared in <script>.`,
            binding
              ? undefined
              : nearest(target, ctx.bindings.keys())
                ? `Did you mean "${nearest(target, ctx.bindings.keys())}"?`
                : undefined,
          )
          ok = false
        } else {
          props.push(`"value": () => ${target}.value`)
          handlers.set('input', [
            ...(handlers.get('input') ?? []),
            `($e: any) => { ${target}.value = $e.target.value }`,
          ])
        }
      } else if (DIRECTIVES.has(name)) {
        continue
      } else {
        if (name === 'class' && attr.value) {
          for (const c of attr.value.split(/\s+/).filter(Boolean)) classes.add(c)
          attrs.push(`${q(name)}: ${q(scoped(attr.value))}`)
        } else {
          attrs.push(`${q(name)}: ${attr.value === null ? 'true' : q(attr.value)}`)
        }
      }
    }
    if (!ok) return undefined

    // Events a behavior produces (`@press`) are wired to the behavior, not to the DOM.
    const use: string[] = []
    for (const [event, fns] of [...handlers]) {
      const behavior = BEHAVIOR_EVENTS[event]
      if (!behavior) continue
      handlers.delete(event)
      const at = el.attrs.find((a) => a.name === `@${event}`)!.nameStart
      const declared = ctx.contract?.behavior
      if (declared !== behavior) {
        report.error(
          'T4015',
          at,
          `@${event} is an event of the "${behavior}" behavior, but this component's contract does not declare it.`,
          ctx.contract
            ? `Add "behavior": "${behavior}" to <contract>.`
            : 'Behaviors belong to components with a contract.',
        )
        return undefined
      }
      if (!BEHAVIOR_REQUIREMENTS[behavior]?.implemented) {
        report.error('T4015', at, `The "${behavior}" behavior is not built yet.`)
        return undefined
      }
      behaviors.add(behavior)
      const handlerCode =
        fns.length === 1 ? fns[0]! : `($e: any) => { ${fns.map((f) => `(${f})($e)`).join('; ')} }`
      const native = isNativelyPressable(el)
      use.push(
        `($el: any) => $attachPress($r.adapter, $el, { onPress: ${handlerCode}, native: ${native}, role: ${q(ctx.contract!.role)} })`,
      )
    }

    const on = [...handlers].map(([event, fns]) =>
      fns.length === 1
        ? `${q(event)}: ${fns[0]}`
        : `${q(event)}: ($e: any) => { ${fns.map((f) => `(${f})($e)`).join('; ')} }`,
    )
    const options = [
      attrs.length ? `attrs: { ${attrs.join(', ')} }` : '',
      props.length ? `props: { ${props.join(', ')} }` : '',
      on.length ? `on: { ${on.join(', ')} }` : '',
      use.length ? `use: [${use.join(', ')}]` : '',
    ].filter(Boolean)
    const children = genChildren(el.children, locals)
    const args = [
      q(el.tag),
      ...(options.length || children.length
        ? [options.length ? `{ ${options.join(', ')} }` : '{}']
        : []),
      ...children,
    ]
    return `$r.el(${args.join(', ')})`
  }

  function genSlot(el: ElementNode, locals: Locals): string | undefined {
    const nameAttr = el.attrs.find((a) => a.name === 'name')
    const name = nameAttr?.value ?? 'default'
    const contract = ctx.contract
    if (contract && !(name in contract.slots)) {
      const close = nearest(name, Object.keys(contract.slots))
      report.error(
        'T4009',
        nameAttr ? nameAttr.valueStart : el.start,
        `Slot ${q(name)} is not declared in the contract.`,
        close ? `Did you mean ${q(close)}?` : `Add ${q(name)} to "slots" in <contract>.`,
      )
      return undefined
    }
    const fallback = genChildren(el.children, locals)
    return fallback.length
      ? `$ctx.slot(${q(name)}, () => [${fallback.join(', ')}])`
      : `$ctx.slot(${q(name)})`
  }

  function genComponent(el: ElementNode, locals: Locals): string | undefined {
    const info = ctx.resolver?.resolve(el.tag)
    if (!info) {
      const close = nearest(el.tag, ctx.resolver?.names() ?? [])
      report.error(
        'T4007',
        el.start + 1,
        `Unknown component <${el.tag}>.`,
        ctx.resolver?.importHint?.(el.tag) ??
          (close
            ? `Did you mean <${close}>?`
            : `Import it in <script>, for example: import ${el.tag} from "./${el.tag}.tess"`),
      )
      return undefined
    }
    components.set(el.tag, info)
    const { contract } = info
    const props: string[] = []
    const events: string[] = []
    let ok = true

    for (const attr of el.attrs) {
      const { name } = attr
      if (DIRECTIVES.has(name)) continue
      if (name.startsWith('@')) {
        const event = name.slice(1)
        if (!(event in contract.events)) {
          const close = nearest(event, Object.keys(contract.events))
          report.error(
            'T4010',
            attr.nameStart,
            `${contract.name} has no event ${q(event)}.`,
            close
              ? `Did you mean ${q(close)}?`
              : `Declared events: ${Object.keys(contract.events).map(q).join(', ') || 'none'}.`,
          )
          ok = false
          continue
        }
        const fn = handler(attr, locals)
        if (!fn) ok = false
        else events.push(`${q(event)}: ${fn}`)
      } else if (name.startsWith(':')) {
        const result = attrExpr(attr, locals)
        if (!result) ok = false
        else props.push(`${q(name.slice(1))}: $derived(() => (${result.code}))`)
      } else if (name.startsWith('bind:')) {
        report.error(
          'T4011',
          attr.nameStart,
          `"${name}" works only on <input>, <textarea> and <select>.`,
        )
        ok = false
      } else {
        const allowed = contract.variants[name]
        if (allowed && attr.value !== null && !allowed.includes(attr.value)) {
          const close = nearest(attr.value, allowed)
          report.error(
            'T4008',
            attr.valueStart,
            `${contract.name}.${name} has no value ${q(attr.value)}.`,
            close ? `Did you mean ${q(close)}?` : `Allowed values: ${allowed.map(q).join(', ')}.`,
          )
          ok = false
          continue
        }
        if (name === 'to' && contract.name === 'Link' && attr.value !== null && ctx.routes) {
          const problem = unknownRoute(attr.value, ctx.routes)
          if (problem) {
            report.error('T6004', attr.valueStart, problem.message, problem.hint)
            ok = false
            continue
          }
        }
        // A class written here belongs to this file's <style>, so it is scoped like any other.
        const value = name === 'class' && attr.value ? scoped(attr.value) : attr.value
        props.push(`${q(name)}: $constant(${value === null ? 'true' : q(value)})`)
      }
    }

    // Children go to the default slot, or to the named slot given by their `slot` attribute.
    const groups = new Map<string, TemplateNode[]>()
    for (const child of el.children) {
      const slotAttr =
        child.type === 'element' ? child.attrs.find((a) => a.name === 'slot') : undefined
      const name = slotAttr?.value ?? 'default'
      if (slotAttr && !(name in contract.slots)) {
        const close = nearest(name, Object.keys(contract.slots))
        report.error(
          'T4009',
          slotAttr.valueStart,
          `${contract.name} has no slot ${q(name)}.`,
          close
            ? `Did you mean ${q(close)}?`
            : `Declared slots: ${Object.keys(contract.slots).map(q).join(', ') || 'none'}.`,
        )
        ok = false
        continue
      }
      if (
        !slotAttr &&
        child.type === 'text' &&
        child.parts.every((p) => p.kind === 'text' && p.value.trim() === '')
      )
        continue
      if (!slotAttr && !('default' in contract.slots)) {
        report.error(
          'T4009',
          child.start,
          `${contract.name} has no default slot, but <${el.tag}> has content.`,
          'Declare a "default" slot in the component contract, or remove the content.',
        )
        ok = false
        break
      }
      groups.set(name, [...(groups.get(name) ?? []), child])
    }
    const slots = [...groups].map(
      ([name, nodes]) => `${q(name)}: () => [${genChildren(nodes, locals).join(', ')}]`,
    )
    if (!ok) return undefined

    const input = [
      props.length ? `props: { ${props.join(', ')} }` : '',
      events.length ? `events: { ${events.join(', ')} }` : '',
      slots.length ? `slots: { ${slots.join(', ')} }` : '',
    ].filter(Boolean)
    return `${el.tag}(${input.length ? `{ ${input.join(', ')} }` : ''})`
  }

  const root = genNode(stripped(rootElement), new Map())
  if (root === undefined) return undefined

  const rootClassAttr = rootElement.attrs.find((a) => a.name === 'class')
  return {
    root,
    rootClass: rootClassAttr?.value ? scoped(rootClassAttr.value) : undefined,
    classes,
    rootClasses: rootClassAttr?.value?.split(/\s+/).filter(Boolean) ?? [],
    components,
    behaviors,
  }
}
