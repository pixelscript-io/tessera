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

/** What each state value of a design is in CSS. A name that is not here needs a hand-written map. */
const STATES: Record<string, string | null> = {
  default: null,
  rest: null,
  enabled: null,
  normal: null,
  idle: null,
  hover: 'hover',
  hovered: 'hover',
  focus: 'focus-visible',
  focused: 'focus-visible',
  'focus-visible': 'focus-visible',
  pressed: 'active',
  active: 'active',
  disabled: 'disabled',
}

const isState = (name: string, options: string[]): boolean =>
  /^(state|status)$/i.test(name) ||
  options.some((o) => /^(hover|hovered|focus|focused|pressed)$/i.test(o))

export function inferMap(file: ComponentSetFile): FigmaMap {
  const set = file.set
  const defs = set.componentPropertyDefinitions ?? {}
  if (!/button|btn/i.test(set.name))
    throw new FigmaError(
      'F001',
      `The component set "${set.name}" does not look like a button, and only a button can be imported so far.`,
      'If it is one, give a map with "kind": "button" (--map).',
    )
  const variants = (set.children ?? []).filter((c) => c.type === 'COMPONENT')
  if (!variants.length) throw new FigmaError('F007', `The set "${set.name}" has no variants.`)

  // The variant properties: each is a prop, except the state.
  const props: FigmaMap['props'] = {}
  for (const [name, def] of Object.entries(defs)) {
    if (def.type !== 'VARIANT') continue
    const options = def.variantOptions ?? []
    if (isState(name, options)) {
      const states: Record<string, string | null> = {}
      const unknown: string[] = []
      for (const o of options) {
        const key = slug(o)
        if (key in STATES) states[o] = STATES[key]!
        else unknown.push(o)
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

  const parts: Record<string, PartSpec> = { root: '$' }
  for (const [slot, spec] of before) parts[slot] = spec
  parts.label = labelSpecs.length === 1 ? labelSpecs[0]! : labelSpecs
  for (const [slot, spec] of after) parts[slot] = spec

  const name = pascal(set.name.split('/').pop() ?? set.name)
  return {
    component: set.name,
    name,
    kind: 'button',
    role: 'button',
    description: 'Triggers an action. Press it with a mouse, a finger, Enter or Space.',
    behavior: 'press',
    props,
    ignore,
    parts,
    slots,
    ...(sample ? { sample } : {}),
    fidelity: { threshold: 0.01, ignore: [...Object.keys(slots), 'label'] },
  }
}
