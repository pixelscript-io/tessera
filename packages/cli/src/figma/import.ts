import { VERSION } from '../version'
import { compareRank, learn, rankOf, sameWhen, winner, type Condition } from './learn'
import {
  FigmaError,
  type ComponentSetFile,
  type Effect,
  type FigmaMap,
  type FigmaNode,
  type Paint,
  type PartRef,
  type PartSpec,
  type Report,
  type Rgba,
} from './model'

/** What a property is when a variant says nothing about it, so a rule can put it back. */
const INITIAL: Record<string, string> = {
  background: 'transparent',
  'box-shadow': 'none',
  outline: 'none',
  'outline-offset': '0',
  'border-radius': '0',
  padding: '0',
  gap: '0',
  opacity: '1',
  display: 'none',
}

const n2 = (n: number): number => Math.round(n * 100) / 100
const px = (n: number): string => `${n2(n)}px`
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
/** A number as a token name: 3.5 is "3p5". */
const numName = (n: number): string => String(n2(n)).replace('.', 'p').replace('-', 'neg')

type Json = Record<string, unknown>

/** The tokens the import makes, in the groups the compiler governs, as one DTCG document. */
export class TokenSet {
  private groups = new Map<string, Map<string, Json>>()
  readonly names: string[] = []

  private add(group: string, name: string, type: string, value: unknown): string {
    const bucket = this.groups.get(group) ?? new Map<string, Json>()
    this.groups.set(group, bucket)
    const existing = bucket.get(name)
    const next = { $type: type, $value: value }
    if (existing && JSON.stringify(existing) !== JSON.stringify(next)) {
      // The same name for two values (two styles with one name): keep the first and number the next.
      let i = 2
      while (bucket.has(`${name}-${i}`)) i++
      return this.add(group, `${name}-${i}`, type, value)
    }
    if (!existing) {
      bucket.set(name, next)
      this.names.push(`$${group}.${name}`)
    }
    return `$${group}.${name}`
  }

  color(c: Rgba, alpha = 1, styleName?: string): string {
    const a = n2((c.a ?? 1) * alpha)
    const hex = [c.r, c.g, c.b]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
    const name = styleName
      ? `figma-${slug(styleName)}`
      : `figma-${hex}${a < 1 ? `-a${Math.round(a * 100)}` : ''}`
    return this.add('color', name, 'color', {
      colorSpace: 'srgb',
      components: [n2(c.r * 1e4) / 1e4, n2(c.g * 1e4) / 1e4, n2(c.b * 1e4) / 1e4].map(
        (v) => +v.toFixed(4),
      ),
      ...(a < 1 ? { alpha: a } : {}),
    })
  }

  private dimension(group: string, value: number): string {
    if (value === 0) return '0'
    return this.add(group, `figma-${numName(value)}`, 'dimension', { value: n2(value), unit: 'px' })
  }
  space = (v: number) => this.dimension('space', v)
  radius = (v: number) => this.dimension('radius', v)
  fontSize = (v: number) => this.dimension('font.size', v)

  opacity(v: number): string {
    return this.add('opacity', `figma-${Math.round(v * 100)}`, 'number', n2(v))
  }

  shadow(effects: Effect[], styleName?: string): string | undefined {
    // Figma lists effects from the bottom up and CSS from the top down.
    const layers = [...effects]
      .reverse()
      .filter((e) => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
      .map((e) => ({
        color: this.colorValue(e.color ?? { r: 0, g: 0, b: 0, a: 1 }),
        offsetX: { value: n2(e.offset?.x ?? 0), unit: 'px' },
        offsetY: { value: n2(e.offset?.y ?? 0), unit: 'px' },
        blur: { value: n2(e.radius ?? 0), unit: 'px' },
        spread: { value: n2(e.spread ?? 0), unit: 'px' },
        ...(e.type === 'INNER_SHADOW' ? { inset: true } : {}),
      }))
    if (!layers.length) return undefined
    const name = styleName
      ? `figma-${slug(styleName)}`
      : `figma-${layers.map((l) => `${l.offsetY.value}-${l.blur.value}-${l.spread.value}`).join('_')}`
    return this.add('shadow', name, 'shadow', layers)
  }

  private colorValue(c: Rgba): Json {
    return {
      colorSpace: 'srgb',
      components: [c.r, c.g, c.b].map((v) => +v.toFixed(4)),
      ...((c.a ?? 1) < 1 ? { alpha: n2(c.a ?? 1) } : {}),
    }
  }

  /** The document, one group per kind, marked as semantic so a component may use them. */
  toDtcg(): Json {
    const out: Json = {
      $description: 'Made by `tessera figma import` from the styles and values of a Figma design.',
    }
    for (const [group, bucket] of [...this.groups].sort(([a], [b]) => a.localeCompare(b))) {
      const node: Json = { $extensions: { tessera: { tier: 'semantic' } } }
      for (const [name, token] of bucket) node[name] = token
      // "font.size" is a group inside "font".
      let target = out
      const parts = group.split('.')
      for (const part of parts.slice(0, -1)) target = (target[part] ??= {}) as Json
      const last = parts[parts.length - 1]!
      target[last] = { ...((target[last] as Json) ?? {}), ...node }
    }
    return out
  }
}

/** A variant: its place on each axis, and its tree. */
interface Variant {
  node: FigmaNode
  axes: Record<string, string>
}

const parseVariant = (node: FigmaNode): Variant => ({
  node,
  axes: Object.fromEntries(
    node.name.split(',').map((p) => {
      const at = p.indexOf('=')
      return [p.slice(0, at).trim(), p.slice(at + 1).trim()]
    }),
  ),
})

function descendants(node: FigmaNode): FigmaNode[] {
  return (node.children ?? []).flatMap((c) => [c, ...descendants(c)])
}

/** The layer a part is, in one variant: the n-th layer of that name, or nothing if this variant has none. */
function findLayer(root: FigmaNode, ref: PartRef): FigmaNode | undefined {
  if (ref === '$') return root
  const found = descendants(root).filter((d) => d.name === ref.layer)
  return found[ref.index ?? 0]
}

/** The layer of a variant that a part is, with the reference that found it. */
function resolvePart(
  root: FigmaNode,
  spec: PartSpec,
): { layer: FigmaNode; ref: PartRef } | undefined {
  for (const ref of [spec].flat()) {
    const layer = findLayer(root, ref)
    if (layer) return { layer, ref }
  }
  return undefined
}

const firstText = (node: FigmaNode, name?: string): FigmaNode | undefined =>
  node.type === 'TEXT' && (!name || node.name === name)
    ? node
    : descendants(node).find((d) => d.type === 'TEXT' && (!name || d.name === name))

const ALIGN: Record<string, string> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_BETWEEN: 'space-between',
  BASELINE: 'baseline',
}

interface Context {
  tokens: TokenSet
  styles: ComponentSetFile['styles']
  report: Report
  skipped: Set<string>
}

const skip = (ctx: Context, message: string) => ctx.skipped.add(message)

const visible = <T extends { visible?: boolean }>(list: T[] | undefined): T[] =>
  (list ?? []).filter((x) => x.visible !== false)

const solid = (paints: Paint[] | undefined): Paint | undefined =>
  visible(paints).find((p) => p.type === 'SOLID')

function paintColor(ctx: Context, paint: Paint, styleId: string | undefined): string {
  const styleName = styleId ? ctx.styles[styleId]?.name : undefined
  if (!styleName) ctx.report.unbound.push(`a color with no style: ${JSON.stringify(paint.color)}`)
  return ctx.tokens.color(paint.color!, paint.opacity ?? 1, styleName)
}

/** The CSS of one layer of one variant, as property to value (values may hold `$tokens`). */
function layerStyle(
  ctx: Context,
  node: FigmaNode,
  role: 'root' | 'part',
  text?: FigmaNode,
): Record<string, string> {
  const out: Record<string, string> = {}
  out.display = role === 'root' ? 'inline-flex' : 'flex'
  if (node.layoutMode === 'VERTICAL') out['flex-direction'] = 'column'
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    out['align-items'] = ALIGN[node.counterAxisAlignItems ?? 'MIN'] ?? 'flex-start'
    out['justify-content'] = ALIGN[node.primaryAxisAlignItems ?? 'MIN'] ?? 'flex-start'
    if (node.itemSpacing) out.gap = ctx.tokens.space(node.itemSpacing)
  } else {
    // An icon holder: what is inside is centered in it.
    out['align-items'] = 'center'
    out['justify-content'] = 'center'
  }
  if (node.layoutSizingHorizontal === 'FIXED' && node.absoluteBoundingBox)
    out.width = px(node.absoluteBoundingBox.width)
  if (node.layoutSizingVertical === 'FIXED' && node.absoluteBoundingBox)
    out.height = px(node.absoluteBoundingBox.height)
  if (node.layoutSizingHorizontal === 'FIXED' || node.layoutSizingVertical === 'FIXED')
    out['flex-shrink'] = '0'

  // A stroke sits inside the box in Figma and does not change its size, so it is drawn as an outline pulled inward
  // (a border would add to the size).
  const stroke = visible(node.strokes)[0]
  const weight = stroke ? (node.strokeWeight ?? 1) : 0
  if (stroke && node.strokeAlign && node.strokeAlign !== 'INSIDE')
    skip(
      ctx,
      `A stroke that is ${node.strokeAlign.toLowerCase()}, on "${node.name}": drawn inside, as the others.`,
    )
  const pad = [
    node.paddingTop ?? 0,
    node.paddingRight ?? 0,
    node.paddingBottom ?? 0,
    node.paddingLeft ?? 0,
  ]
  if (pad.some(Boolean)) {
    const t = pad.map((v) => ctx.tokens.space(v))
    out.padding =
      t[0] === t[2] && t[1] === t[3] ? (t[0] === t[1] ? t[0]! : `${t[0]} ${t[1]}`) : t.join(' ')
  }

  const radii =
    node.rectangleCornerRadii ?? (node.cornerRadius ? Array(4).fill(node.cornerRadius) : undefined)
  if (radii?.some(Boolean)) {
    const t = (radii as number[]).map((v) => ctx.tokens.radius(v))
    out['border-radius'] = t.every((v) => v === t[0]) ? t[0]! : t.join(' ')
  }

  const fill = node.type === 'TEXT' ? undefined : solid(node.fills)
  const fillStyle = node.styles?.fills ?? node.styles?.fill
  if (visible(node.fills).some((p) => p.type !== 'SOLID') && node.type !== 'TEXT')
    skip(ctx, `A fill that is not a plain color, on "${node.name}".`)
  const fillToken = fill ? paintColor(ctx, fill, fillStyle) : undefined

  if (stroke?.type === 'SOLID') {
    out.outline = `${px(weight)} solid ${paintColor(ctx, stroke, node.styles?.strokes ?? node.styles?.stroke)}`
    out['outline-offset'] = px(-weight)
  } else if (
    stroke?.type === 'GRADIENT_LINEAR' &&
    stroke.gradientStops &&
    stroke.gradientHandlePositions
  ) {
    // A gradient border: the fill over the inside, the gradient over the edge, the fill under both.
    const [a, b] = stroke.gradientHandlePositions as [
      { x: number; y: number },
      { x: number; y: number },
    ]
    const angle = Math.round((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI)
    const stops = stroke.gradientStops
      .map((s) => `${ctx.tokens.color(s.color, stroke.opacity ?? 1)} ${n2(s.position * 100)}%`)
      .join(', ')
    // The fill, smaller by the stroke on each side, over the gradient, over the fill.
    const under = fillToken ?? 'transparent'
    const inner = `calc(100% - ${px(weight * 2)})`
    out.background = `linear-gradient(${under}, ${under}) center / ${inner} ${inner} no-repeat, linear-gradient(${angle}deg, ${stops}), ${under}`
  } else if (stroke) {
    skip(ctx, `A stroke of type ${stroke.type}, on "${node.name}".`)
  }
  if (out.background === undefined && fillToken) out.background = fillToken

  const effects = visible(node.effects)
  if (effects.length) {
    const effectStyle = node.styles?.effect
    const token = ctx.tokens.shadow(
      effects,
      effectStyle ? ctx.styles[effectStyle]?.name : undefined,
    )
    if (token) out['box-shadow'] = token
  }
  if (node.opacity !== undefined && node.opacity < 1) out.opacity = ctx.tokens.opacity(node.opacity)

  if (text?.style) {
    const s = text.style
    if (s.fontFamily) out['font-family'] = `${s.fontFamily}, sans-serif`
    if (s.fontSize) out['font-size'] = ctx.tokens.fontSize(s.fontSize)
    if (s.fontWeight) out['font-weight'] = String(s.fontWeight)
    if (s.lineHeightPx) out['line-height'] = px(s.lineHeightPx)
    if (s.letterSpacing) out['letter-spacing'] = px(s.letterSpacing)
    const ink = solid(text.fills)
    if (ink) out.color = paintColor(ctx, ink, text.styles?.fills ?? text.styles?.fill)
  }
  return out
}

/** One rule to write: where it applies and what it sets. */
interface Rule {
  part: string
  when: Condition[]
  decls: Array<[string, string]>
  /** Where it was first needed: rules with as many conditions are written in this order. */
  order: number
}

/** The axes of a variant set, with each value's place in the Tessera component. */
export interface AxisInfo {
  figma: string
  /** The prop it is, or `undefined` for the state. */
  prop?: string
  values: string[]
  defaultValue: string
  /** For the state: the pseudo-class of each value ('' for the one that needs none). */
  states?: Record<string, string>
}

export interface ImportResult {
  tess: string
  tokens: Record<string, unknown>
  report: Report
  axes: AxisInfo[]
  /** What the comparison needs for each variant. */
  variants: Array<{
    id: string
    name: string
    props: Record<string, string>
    state: string
    width: number
    height: number
    /** How far the picture reaches past the box (a shadow), on each side. */
    bleed: { left: number; top: number; right: number; bottom: number }
    /** The boxes of the parts whose pixels are not compared, from the corner of the box. */
    ignore: Array<{ x: number; y: number; width: number; height: number }>
    /** Where each part is in this variant, from the corner of the box (null: it is not there). */
    boxes: Record<string, { x: number; y: number; width: number; height: number } | null>
    file: string
  }>
}

/**
 * Turns one Figma component set into a component. The rules for each part are worked out from what the variants have
 * in common: a property that the size alone decides is written once for each size, and one that the hierarchy and the
 * state decide once for each pair.
 */
export function importComponentSet(file: ComponentSetFile, map: FigmaMap): ImportResult {
  const set = file.set
  if (map.kind !== 'button')
    throw new FigmaError(
      'F001',
      `"kind" is "${map.kind}", and only "button" can be imported so far.`,
      'Set "kind": "button" in the map.',
    )
  if (set.name !== map.component)
    throw new FigmaError(
      'F002',
      `The map is for the component set "${map.component}", but the file has "${set.name}".`,
    )
  const defs = set.componentPropertyDefinitions ?? {}

  // Every property of the set is accounted for in the map, or the import says which is not.
  const axes: AxisInfo[] = []
  for (const [name, def] of Object.entries(defs)) {
    const given = map.props[name]
    if (def.type === 'VARIANT') {
      if (!given)
        throw new FigmaError(
          'F003',
          `The variant property "${name}" is not in the map.`,
          `Add it to "props" in the map: { "prop": "..." }, or, for a state, { "states": { ... } }.`,
        )
      const options = def.variantOptions ?? []
      if ('states' in given) {
        const missing = options.filter((o) => !(o in given.states))
        if (missing.length)
          throw new FigmaError(
            'F004',
            `The state values ${missing.map((m) => `"${m}"`).join(', ')} of "${name}" are not in the map.`,
            `Give each a pseudo-class name, or null for the one that needs none.`,
          )
        axes.push({
          figma: name,
          values: options,
          defaultValue: String(def.defaultValue ?? options[0]),
          states: Object.fromEntries(
            Object.entries(given.states).map(([k, v]) => [
              k,
              v === null ? '' : v === 'focus-visible' ? ':focus-visible' : `:${v}`,
            ]),
          ),
        })
      } else {
        axes.push({
          figma: name,
          prop: given.prop,
          values: options,
          defaultValue: given.default ?? String(def.defaultValue ?? options[0]),
        })
      }
    } else if (!(name in (map.ignore ?? {}))) {
      throw new FigmaError(
        'F005',
        `The ${def.type.toLowerCase()} property "${name}" is not in the map.`,
        `Add it to "ignore" with why it is not a prop, for example "a slot".`,
      )
    }
  }
  for (const given of Object.keys(map.props)) {
    if (!(given in defs))
      throw new FigmaError(
        'F006',
        `The map names the property "${given}", which the set does not have.`,
      )
  }
  const stateAxis = axes.find((a) => a.states)
  const propAxes = axes.filter((a) => !a.states)

  const variants = (set.children ?? []).filter((c) => c.type === 'COMPONENT').map(parseVariant)
  if (!variants.length) throw new FigmaError('F007', `The set "${set.name}" has no variants.`)

  const report: Report = { mapped: [], tokens: [], skipped: [], unbound: [] }
  const ctx: Context = { tokens: new TokenSet(), styles: file.styles, report, skipped: new Set() }

  // The layers, per part: the CSS each variant gives each part.
  const partNames = Object.keys(map.parts)
  if (!partNames.includes('root') || map.parts.root !== '$')
    throw new FigmaError('F008', 'The map\'s "parts" needs "root": "$", the component itself.')
  const perVariant = variants.map((v) => {
    const styles = new Map<string, Record<string, string> | undefined>()
    const boxes = new Map<string, FigmaNode | undefined>()
    for (const part of partNames) {
      const found = resolvePart(v.node, map.parts[part]!)
      boxes.set(part, found?.layer)
      if (!found || found.layer.visible === false) {
        styles.set(part, undefined)
        continue
      }
      const { layer, ref } = found
      const text = ref !== '$' && ref.text ? firstText(layer, ref.text) : undefined
      styles.set(part, layerStyle(ctx, layer, ref === '$' ? 'root' : 'part', text))
    }
    const root = styles.get('root')
    // An icon is a slot and takes the color of the text (as a stroke in the design does). It is set on the icon's own
    // part, not on the root: the root's background and a color there would be checked against each other as one block.
    const ink = partNames.map((p) => styles.get(p)?.color).find(Boolean)
    for (const slot of Object.keys(map.slots ?? {})) {
      const style = styles.get(slot)
      if (style && ink) style.color = ink
    }
    // The design's focus ring is a shadow. A focus state also needs an outline, so that it shows where shadows are
    // removed (a high-contrast mode): a transparent one costs nothing where shadows show.
    const state = stateAxis ? stateAxis.states![v.axes[stateAxis.figma]!] : undefined
    if (root && state === ':focus-visible' && !root.outline) {
      root.outline = '2px solid transparent'
      root['outline-offset'] = '0'
    }
    return { styles, boxes }
  })

  // The rules: for each property of each part, a base and the conditions that change it.
  const places = variants.map((v) => v.axes)
  const learnAxes = axes.map((a) => ({
    name: a.figma,
    values: a.values,
    defaultValue: a.defaultValue,
  }))
  const light = new Set(stateAxis ? [stateAxis.figma] : [])
  const items: Array<{
    part: string
    when: Condition[]
    prop: string
    value: string
    seq: number
  }> = []
  const checks: Array<{ part: string; prop: string; values: string[]; base: string | undefined }> =
    []
  for (const part of partNames) {
    const props = new Set<string>()
    for (const pv of perVariant)
      for (const key of Object.keys(pv.styles.get(part) ?? {})) props.add(key)
    for (const prop of props) {
      const values = perVariant.map((pv) => {
        const style = pv.styles.get(part)
        if (!style) return prop === 'display' ? 'none' : (INITIAL[prop] ?? 'initial')
        return style[prop] ?? INITIAL[prop] ?? 'initial'
      })
      const { base, rules: learned } = learn({ places, values, axes: learnAxes, light })
      // A base that is the property's initial value needs no line (a display never does: it is what hides a part).
      const baseWritten = base === INITIAL[prop] && prop !== 'display' ? undefined : base
      if (baseWritten !== undefined)
        items.push({ part, when: [], prop, value: baseWritten, seq: items.length })
      for (const r of learned)
        items.push({ part, when: r.when, prop, value: r.value, seq: items.length })
      checks.push({ part, prop, values, base: baseWritten })
    }
  }
  // Rules are written from the weakest to the strongest, which is the order the cascade needs; rules with the same
  // conditions are one rule.
  const order = learnAxes.map((a) => a.name)
  const ordered: Rule[] = []
  for (const item of [...items].sort(
    (x, y) =>
      partNames.indexOf(x.part) - partNames.indexOf(y.part) ||
      compareRank(rankOf(x.when, order), rankOf(y.when, order)) ||
      x.seq - y.seq,
  )) {
    const same = ordered.find((r) => r.part === item.part && sameWhen(r.when, item.when))
    if (same) same.decls.push([item.prop, item.value])
    else
      ordered.push({
        part: item.part,
        when: item.when,
        decls: [[item.prop, item.value]],
        order: item.seq,
      })
  }
  // What the stylesheet gives each variant is what the design has: checked here, in the order the rules are written.
  for (const { part, prop, values, base } of checks) {
    const list = ordered
      .filter((r) => r.part === part && r.decls.some(([p]) => p === prop))
      .map((r) => ({ when: r.when, value: r.decls.find(([p]) => p === prop)![1] }))
    variants.forEach((v, i) => {
      const got = winner(v.axes, base ?? INITIAL[prop] ?? 'initial', list, order)
      if (got !== values[i])
        throw new FigmaError(
          'F009',
          `The rules for "${prop}" of "${part}" do not give "${v.node.name}" what the design has: ${got} instead of ${values[i]}.`,
          'This is a fault in the importer. Report it with the map.',
        )
    })
  }

  const axisOf = new Map(axes.map((a) => [a.figma, a]))
  const selector = (r: Rule): string => {
    let attrs = ''
    let pseudo = ''
    for (const c of r.when) {
      const a = axisOf.get(c.axis)!
      if (a.states) {
        const own = a.states[c.value] ?? ''
        // No pseudo-class: not any of the others, written so that it weighs nothing.
        pseudo =
          own === ''
            ? `:where(:not(${Object.values(a.states).filter(Boolean).join(', ')}))`
            : own === ':hover'
              ? ':hover:where(:not(:disabled))'
              : own
      } else attrs += `[data-${a.prop}='${slug(c.value)}']`
    }
    const root = `.root${attrs}${pseudo}`
    return r.part === 'root' ? root : `${root} .${r.part}`
  }
  const css: string[] = []
  for (const rule of ordered) {
    const body = rule.decls.map(([p, v]) => `  ${p}: ${v};`).join('\n')
    css.push(`${selector(rule)} {\n${body}\n}`)
  }
  const slotParts = Object.keys(map.slots ?? {})
  if (slotParts.length)
    css.push(`${slotParts.map((p) => `.${p}:empty`).join(',\n')} {\n  display: none;\n}`)
  css.push(`.label {\n  white-space: nowrap;\n}`)
  // What a button has that the design does not draw: the browser's own border and focus ring (the design's focus state
  // is a rule above, and a stroke is an outline that a rule above sets).
  css.push(
    `.root {\n  box-sizing: border-box;\n  margin: 0;\n  border: 0;\n  outline: none;\n  cursor: pointer;\n}`,
  )
  css.push(`.root:disabled {\n  cursor: not-allowed;\n}`)

  // The contract.
  const variantsDecl = Object.fromEntries(
    propAxes.map((a) => [
      a.prop!,
      [slug(a.defaultValue), ...a.values.filter((v) => v !== a.defaultValue).map(slug)],
    ]),
  )
  const states = stateAxis
    ? Object.values(stateAxis.states!)
        .filter(Boolean)
        .map((s) => s.slice(1))
    : []
  const sample =
    map.sample ??
    firstText(findLayer(variants[0]!.node, '$') ?? variants[0]!.node)?.characters ??
    map.name
  const slotsDecl: Record<string, string> = { default: 'label content', ...(map.slots ?? {}) }
  const contract = {
    name: map.name,
    role: map.role,
    description: map.description,
    since: VERSION.replace(/\.\d+$/, '.0'),
    parts: partNames.map((p) => p),
    variants: variantsDecl,
    states,
    ...(map.behavior ? { behavior: map.behavior } : {}),
    slots: slotsDecl,
    events: {
      press: "fired on click, Enter, or Space, with { source: 'pointer' | 'keyboard' | 'virtual' }",
    },
    preview: { slots: { default: sample } },
  }
  const iconPart = partNames.find((p) => p === 'icon')
  const endPart = partNames.find((p) => p === 'icon-end')
  const template = [
    `  <button class="root" :type="type" :disabled="disabled" @press="emit('press', $event)">`,
    ...(iconPart ? [`    <span class="icon"><slot name="icon" /></span>`] : []),
    `    <span class="label"><slot /></span>`,
    ...(endPart ? [`    <span class="icon-end"><slot name="icon-end" /></span>`] : []),
    `  </button>`,
  ].join('\n')

  const tess = `<contract>
${JSON.stringify(contract, null, 2)}
</contract>

<script>
const { disabled, type } = props({ disabled: false, type: 'button' })
</script>

<template>
${template}
</template>

<style>
${css.join('\n\n')}
</style>
`

  // What the comparison needs.
  const outVariants: ImportResult['variants'] = variants.map((v, i) => {
    const bb = v.node.absoluteBoundingBox!
    const rb = v.node.absoluteRenderBounds ?? bb
    const rel = (b: { x: number; y: number; width: number; height: number }) => ({
      x: n2(b.x - bb.x),
      y: n2(b.y - bb.y),
      width: n2(b.width),
      height: n2(b.height),
    })
    const boxes = Object.fromEntries(
      partNames.map((p) => {
        const layer = perVariant[i]!.boxes.get(p)
        return [
          p,
          layer && layer.visible !== false && layer.absoluteBoundingBox
            ? rel(layer.absoluteBoundingBox)
            : null,
        ]
      }),
    )
    const ignore = (map.fidelity?.ignore ?? [])
      .map((p) => boxes[p])
      .filter((b): b is NonNullable<typeof b> => !!b)
    return {
      id: v.node.id,
      name: v.node.name,
      props: Object.fromEntries(propAxes.map((a) => [a.prop!, slug(v.axes[a.figma]!)])),
      state: stateAxis ? (stateAxis.states![v.axes[stateAxis.figma]!] ?? '') : '',
      width: bb.width,
      height: bb.height,
      bleed: {
        left: bb.x - rb.x,
        top: bb.y - rb.y,
        right: rb.x + rb.width - (bb.x + bb.width),
        bottom: rb.y + rb.height - (bb.y + bb.height),
      },
      ignore,
      boxes,
      file: `${slug(v.node.name)}.png`,
    }
  })

  report.mapped.push(
    `${variants.length} variants of "${set.name}"`,
    ...axes.map((a) =>
      a.states
        ? `${a.figma} (${a.values.length} values) is the state: ${Object.entries(a.states)
            .map(([k, v]) => `${k} ${v || '(none)'}`)
            .join(', ')}`
        : `${a.figma} (${a.values.length} values) is the prop "${a.prop}"`,
    ),
    ...partNames.map((p) => `part "${p}"`),
  )
  report.tokens.push(...ctx.tokens.names)
  report.skipped.push(...ctx.skipped)
  report.unbound = [...new Set(report.unbound)]
  return { tess, tokens: ctx.tokens.toDtcg(), report, axes, variants: outVariants }
}
