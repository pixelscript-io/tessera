import {
  FigmaError,
  type ComponentSetFile,
  type FigmaMap,
  type FigmaNode,
  type PartRef,
  type PartSpec,
} from './model'

/**
 * Works out the map from the design itself, so an import needs nothing but the link. Figma says a lot about what a
 * component is: its variant properties, which of them is the state, which layer each switch and swap controls, and
 * where the text is. What it cannot say is behavior, so the kind is read from the name (only a button can be built).
 */

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** A property's name as a person reads it: no emoji, no "#id" that Figma adds to a switch or a swap. */
const clean = (name: string): string =>
  name
    .replace(/#.*$/, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const pascal = (s: string): string =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('')

function descendants(node: FigmaNode): FigmaNode[] {
  return (node.children ?? []).flatMap((c) => [c, ...descendants(c)])
}

/**
 * What a state value of a design is in CSS, read by what it says: "Hover", "Hovered", "Hover/active" are `:hover`; a
 * name with "focus" is `:focus-visible`; "Pressed" and "Active" are `:active`; "Disabled" is `:disabled`; "Default",
 * "Rest" and the like need none. `undefined` is a name this cannot read (it needs a hand-written map).
 */
function stateOf(value: string): string | null | undefined {
  const v = slug(value)
  if (/disabled|inactive/.test(v)) return 'disabled'
  if (/focus/.test(v)) return 'focus-visible'
  if (/hover/.test(v)) return 'hover'
  if (/press|active|down/.test(v)) return 'active'
  if (/^(default|rest|enabled|normal|idle|base|empty)$/.test(v)) return null
  return undefined
}

const isState = (name: string, options: string[]): boolean =>
  /^(state|status)$/i.test(name) ||
  options.some((o) => {
    const state = stateOf(o)
    return state !== undefined && state !== null
  })

export function inferMap(file: ComponentSetFile): FigmaMap {
  const set = file.set
  const defs = set.componentPropertyDefinitions ?? {}
  const variants = (set.children ?? []).filter((c) => c.type === 'COMPONENT')
  if (!variants.length) throw new FigmaError('F007', `The set "${set.name}" has no variants.`)
  // What it is: a button by its name; otherwise a label in a row (a badge, a tag, a chip), by its layout. Anything else
  // (a card, an avatar, an input) needs more than this can read.
  const kind: 'button' | 'inline' | undefined = /button|btn/i.test(set.name)
    ? 'button'
    : variants.some((v) => v.layoutMode === 'HORIZONTAL') &&
        variants.some((v) => descendants(v).some((d) => d.type === 'TEXT'))
      ? 'inline'
      : undefined
  if (!kind)
    throw new FigmaError(
      'F001',
      `The component set "${set.name}" is not a button or a label in a row, and those are the only ones that can be imported so far.`,
      'If it is one of those, give a map with "kind": "button" or "inline" (--map).',
    )

  // The variant properties: each is a prop, except the state.
  const props: FigmaMap['props'] = {}
  for (const [name, def] of Object.entries(defs)) {
    if (def.type !== 'VARIANT') continue
    const options = def.variantOptions ?? []
    if (isState(name, options)) {
      const states: Record<string, string | null> = {}
      const unknown: string[] = []
      for (const o of options) {
        const state = stateOf(o)
        if (state === undefined) unknown.push(o)
        else states[o] = state
      }
      if (unknown.length)
        throw new FigmaError(
          'F004',
          `The state values ${unknown.map((u) => `"${u}"`).join(', ')} of "${name}" are not ones this can read.`,
          'Give a map (--map) saying which pseudo-class each is, or null for the one that needs none.',
        )
      props[name] = { states }
    } else {
      props[name] = { prop: slug(name), default: String(def.defaultValue ?? options[0]) }
    }
  }

  // The label: the text, and the layer in the row of the button that holds it. A variant may have it in a frame, or bare.
  const labelSpecs: PartRef[] = []
  let sample: string | undefined
  for (const v of variants) {
    const text = descendants(v).find((d) => d.type === 'TEXT')
    if (!text) continue
    sample ??= text.characters
    const container =
      (v.children ?? []).find((c) => c === text || descendants(c).includes(text)) ?? text
    const spec = { layer: container.name, text: text.name }
    if (!labelSpecs.some((s) => JSON.stringify(s) === JSON.stringify(spec))) labelSpecs.push(spec)
  }
  // A frame that holds the text comes before the bare text: a variant that has the frame is read with its padding.
  labelSpecs.sort(
    (x, y) =>
      Number(typeof x === 'object' && 'layer' in x && x.layer === x.text) -
      Number(typeof y === 'object' && 'layer' in y && y.layer === y.text),
  )
  if (!labelSpecs.length)
    throw new FigmaError(
      'F016',
      `The component set "${set.name}" has no text layer to be its label.`,
    )

  // The switches: each one that a layer is tied to is a slot (an icon), before or after the label by where the layer is.
  const ignore: Record<string, string> = {}
  const slots: NonNullable<FigmaMap['slots']> = {}
  const before: Array<[string, PartSpec]> = []
  const after: Array<[string, PartSpec]> = []
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === 'VARIANT') continue
    if (def.type === 'INSTANCE_SWAP') {
      ignore[name] = 'the icon is what the slot holds'
      continue
    }
    if (def.type !== 'BOOLEAN') {
      ignore[name] = 'not used by the import'
      continue
    }
    let layer: FigmaNode | undefined
    let where: FigmaNode | undefined
    for (const v of variants) {
      const found = descendants(v).find((d) => d.componentPropertyReferences?.visible === name)
      if (found) {
        layer = found
        where = v
        break
      }
    }
    if (!layer || !where) {
      ignore[name] = 'no layer is tied to it'
      continue
    }
    const row = where.children ?? []
    const text = descendants(where).find((d) => d.type === 'TEXT')
    const textAt = row.findIndex(
      (c) => c === text || (text !== undefined && descendants(c).includes(text)),
    )
    const at = row.findIndex((c) => c === layer || descendants(c).includes(layer))
    const side = at < textAt ? 'before' : 'after'
    const slot = slug(clean(name))
    // The swap that the same layer carries belongs to the same slot.
    const swap = layer.componentPropertyReferences?.mainComponent
    if (swap) ignore[swap] = 'the icon is what the slot holds'
    const spec: PartSpec = [{ property: swap ? [name, swap] : [name] }, { beside: 'label', side }]
    slots[slot] = {
      description: `${clean(name).toLowerCase()}, ${side} the label (optional)`,
      side,
    }
    ;(side === 'before' ? before : after).push([slot, spec])
  }

  // With no switch for a side, the layer there (if any variant has one) is a slot all the same, found beside the label.
  for (const side of ['before', 'after'] as const) {
    const list = side === 'before' ? before : after
    if (list.length) continue
    const there = variants.some((v) => {
      const row = v.children ?? []
      const text = descendants(v).find((d) => d.type === 'TEXT')
      const at = row.findIndex(
        (c) => c === text || (text !== undefined && descendants(c).includes(text)),
      )
      return at >= 0 && (side === 'before' ? at > 0 : at < row.length - 1)
    })
    if (!there) continue
    const slot = side === 'before' ? 'leading' : 'trailing'
    slots[slot] = { description: `something ${side} the label (optional)`, side }
    list.push([slot, { beside: 'label', side }])
  }

  const parts: Record<string, PartSpec> = { root: '$' }
  for (const [slot, spec] of before) parts[slot] = spec
  parts.label = labelSpecs.length === 1 ? labelSpecs[0]! : labelSpecs
  for (const [slot, spec] of after) parts[slot] = spec

  const name = pascal(set.name.split('/').pop() ?? set.name)
  return {
    component: set.name,
    name,
    kind,
    role: kind === 'button' ? 'button' : 'generic',
    description:
      kind === 'button'
        ? 'Triggers an action. Press it with a mouse, a finger, Enter or Space.'
        : `${name}, imported from Figma.`,
    ...(kind === 'button' ? { behavior: 'press' } : {}),
    props,
    ignore,
    parts,
    slots,
    ...(sample ? { sample } : {}),
    fidelity: { threshold: 0.01, ignore: [...Object.keys(slots), 'label'] },
  }
}
