import { DEFAULT_BEHAVIORS, type BehaviorRequirements } from './behaviors'
import { nearest, type ContractCode, type ContractDiagnostic } from './diagnostics'
import { JsonSyntaxError, lineTable, parseJsonc, type JsonNode, type JsonProp } from './jsonc'
import { ARIA_ROLES } from './roles'

export interface Contrast {
  foreground: string
  background: string
}

export interface Contract {
  name: string
  role: string
  /** The public anatomy: documented class names. Always includes `root`. */
  parts: string[]
  /** Variant name to allowed values. The first value is the default. */
  variants: Record<string, string[]>
  states: string[]
  behavior?: string
  /** Slot name to description. */
  slots: Record<string, string>
  /** Event name to description. */
  events: Record<string, string>
  description?: string
  contrast: Contrast[]
  since?: string
  deprecated?: string
  renamedFrom?: string
  /** Variant name to the values that are deprecated and why. The values are still allowed. */
  deprecatedValues?: Record<string, Record<string, string>>
  /** Variant name to the values that were renamed: old value to its replacement. The old value is no longer allowed. */
  renamedValues?: Record<string, Record<string, string>>
  forkedFrom?: { component: string; version: string }
}

export interface ParseContractOptions {
  /** File the contract came from. Its base name must equal the contract name. */
  file: string
  /** Where the contract text starts inside `file`, so positions point into the real file. Defaults to 1:1. */
  origin?: { line: number; column: number }
  /** Behavior requirements. Defaults to the provisional table in `DEFAULT_BEHAVIORS`. */
  behaviors?: Readonly<Record<string, BehaviorRequirements>>
}

export interface ParsedContract {
  /** Present only when there are no errors. */
  contract: Contract | undefined
  diagnostics: ContractDiagnostic[]
  file: string
  /** Position of a value (or, with `'key'`, of the property name) at a JSON path such as `['parts', 2]`. */
  locate(
    path: ReadonlyArray<string | number>,
    at?: 'value' | 'key',
  ): { line: number; column: number }
}

const FIELDS = [
  'name',
  'role',
  'parts',
  'variants',
  'states',
  'behavior',
  'slots',
  'events',
  'description',
  'contrast',
  'since',
  'deprecated',
  'renamedFrom',
  'deprecatedValues',
  'renamedValues',
  'forkedFrom',
] as const

const PASCAL = /^[A-Z][A-Za-z0-9]*$/
const PART = /^[a-z][a-zA-Z0-9-]*$/
const VARIANT = /^[a-z][A-Za-z0-9]*$/
const VARIANT_VALUE = /^[A-Za-z0-9_-]+$/
const STATE = /^[a-z][a-z0-9-]*$/
const MEMBER = /^[a-z][A-Za-z0-9-]*$/
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

const q = (s: string) => JSON.stringify(s)
const list = (xs: readonly string[]) => xs.map(q).join(', ')

export function parseContract(source: string, options: ParseContractOptions): ParsedContract {
  const { file } = options
  const behaviors = options.behaviors ?? DEFAULT_BEHAVIORS
  const position = lineTable(source, options.origin)
  const diagnostics: ContractDiagnostic[] = []

  const report = (code: ContractCode, offset: number, message: string, hint?: string) => {
    diagnostics.push({ code, severity: 'error', message, hint, file, ...position(offset) })
  }

  let ast: JsonNode
  try {
    ast = parseJsonc(source)
  } catch (e) {
    if (!(e instanceof JsonSyntaxError)) throw e
    report('T3001', e.offset, e.message)
    return { contract: undefined, diagnostics, file, locate: () => position(0) }
  }

  const locate: ParsedContract['locate'] = (path, at = 'value') => {
    let node: JsonNode = ast
    let keyOffset = ast.start
    for (const step of path) {
      if (node.type === 'object' && typeof step === 'string') {
        const prop: JsonProp | undefined = node.props.find((p) => p.key === step)
        if (!prop) break
        keyOffset = prop.keyStart
        node = prop.value
      } else if (node.type === 'array' && typeof step === 'number' && node.items[step]) {
        node = node.items[step]!
        keyOffset = node.start
      } else break
    }
    return position(at === 'key' ? keyOffset : node.start)
  }

  if (ast.type !== 'object') {
    report('T3003', ast.start, 'A contract must be a JSON object.')
    return { contract: undefined, diagnostics, file, locate }
  }

  // Field names: duplicates, unknown, and required.
  const fields = new Map<string, JsonProp>()
  for (const prop of ast.props) {
    if (fields.has(prop.key)) {
      report('T3007', prop.keyStart, `Duplicate field ${q(prop.key)}.`)
      continue
    }
    fields.set(prop.key, prop)
    if (!(FIELDS as readonly string[]).includes(prop.key)) {
      const close = nearest(prop.key, FIELDS)
      report(
        'T3002',
        prop.keyStart,
        `Unknown contract field ${q(prop.key)}.`,
        close ? `Did you mean ${q(close)}?` : `Known fields: ${list(FIELDS)}.`,
      )
    }
  }
  for (const required of ['name', 'role', 'parts'] as const) {
    if (!fields.has(required)) report('T3012', ast.start, `Missing required field ${q(required)}.`)
  }

  const str = (
    node: JsonNode,
    what: string,
    pattern?: RegExp,
    shape?: string,
  ): string | undefined => {
    if (node.type !== 'string') {
      report('T3003', node.start, `${what} must be a string.`)
      return undefined
    }
    if (pattern && !pattern.test(node.value)) {
      report('T3003', node.start, `${what} must be ${shape}, got ${q(node.value)}.`)
      return undefined
    }
    return node.value
  }

  const stringMap = (
    node: JsonNode,
    field: string,
    what: string,
    keyPattern: RegExp,
  ): Record<string, string> => {
    const out: Record<string, string> = {}
    if (node.type !== 'object') {
      report('T3003', node.start, `${q(field)} must be an object of ${what} names to descriptions.`)
      return out
    }
    const seen = new Set<string>()
    for (const prop of node.props) {
      if (seen.has(prop.key)) {
        report('T3007', prop.keyStart, `Duplicate ${what} ${q(prop.key)}.`)
        continue
      }
      seen.add(prop.key)
      if (!keyPattern.test(prop.key)) {
        report(
          'T3003',
          prop.keyStart,
          `${what[0]!.toUpperCase()}${what.slice(1)} name ${q(prop.key)} must start with a lowercase letter and use only letters, numbers and "-".`,
        )
      }
      const description = str(prop.value, `The description of ${what} ${q(prop.key)}`)
      out[prop.key] = description ?? ''
    }
    return out
  }

  // name
  let name: string | undefined
  const nameProp = fields.get('name')
  if (nameProp) {
    name = str(nameProp.value, '"name"', PASCAL, 'PascalCase (for example "Button")')
    if (
      name === undefined &&
      nameProp.value.type === 'string' &&
      /^[a-z]/.test(nameProp.value.value)
    ) {
      const v = nameProp.value.value
      diagnostics[diagnostics.length - 1]!.hint =
        `Did you mean ${q(v[0]!.toUpperCase() + v.slice(1))}?`
    }
    if (name !== undefined) {
      const base = file
        .split(/[\\/]/)
        .pop()!
        .replace(/\.[^.]+$/, '')
      if (name !== base) {
        report(
          'T3004',
          nameProp.value.start,
          `Contract name ${q(name)} does not match the file name ${q(file.split(/[\\/]/).pop()!)}.`,
          `Rename the contract to ${q(base)} or rename the file.`,
        )
      }
    }
  }

  // role
  let role: string | undefined
  const roleProp = fields.get('role')
  if (roleProp) {
    role = str(roleProp.value, '"role"')
    if (role !== undefined && !(ARIA_ROLES as readonly string[]).includes(role)) {
      const close = nearest(role, ARIA_ROLES)
      report(
        'T3005',
        roleProp.value.start,
        `Unknown ARIA role ${q(role)}.`,
        close ? `Did you mean ${q(close)}?` : undefined,
      )
      role = undefined
    }
  }

  // parts
  const parts: string[] = []
  const partsProp = fields.get('parts')
  if (partsProp) {
    const node = partsProp.value
    if (node.type !== 'array') {
      report('T3003', node.start, '"parts" must be an array of part names.')
    } else {
      const before = diagnostics.length
      for (const item of node.items) {
        const part = str(
          item,
          'A part name',
          PART,
          'a lowercase name using letters, numbers and "-"',
        )
        if (part === undefined) continue
        if (parts.includes(part)) report('T3007', item.start, `Duplicate part ${q(part)}.`)
        else parts.push(part)
      }
      if (!parts.includes('root') && diagnostics.length === before) {
        report(
          'T3006',
          node.start,
          `The parts list must include "root", the part carried by the component's root element. Found: ${parts.length ? list(parts) : 'no parts'}.`,
        )
      }
    }
  }

  // variants
  const variants: Record<string, string[]> = {}
  const variantsProp = fields.get('variants')
  if (variantsProp) {
    const node = variantsProp.value
    if (node.type !== 'object') {
      report(
        'T3003',
        node.start,
        '"variants" must be an object of variant names to arrays of allowed values.',
      )
    } else {
      const seenNames = new Set<string>()
      for (const prop of node.props) {
        if (seenNames.has(prop.key)) {
          report('T3007', prop.keyStart, `Duplicate variant ${q(prop.key)}.`)
          continue
        }
        seenNames.add(prop.key)
        if (!VARIANT.test(prop.key)) {
          report(
            'T3003',
            prop.keyStart,
            `Variant name ${q(prop.key)} must be camelCase, starting with a lowercase letter.`,
          )
        }
        if (prop.value.type !== 'array') {
          report(
            'T3003',
            prop.value.start,
            `Variant ${q(prop.key)} must be an array of allowed values.`,
          )
          continue
        }
        if (prop.value.items.length === 0) {
          report(
            'T3003',
            prop.value.start,
            `Variant ${q(prop.key)} must list at least one value. The first value is the default.`,
          )
          continue
        }
        const values: string[] = []
        for (const item of prop.value.items) {
          const v = str(
            item,
            `A value of variant ${q(prop.key)}`,
            VARIANT_VALUE,
            'letters, numbers, "-" and "_"',
          )
          if (v === undefined) continue
          if (values.includes(v))
            report('T3007', item.start, `Duplicate value ${q(v)} in variant ${q(prop.key)}.`)
          else values.push(v)
        }
        variants[prop.key] = values
      }
    }
  }

  // states
  const states: string[] = []
  const statesProp = fields.get('states')
  if (statesProp) {
    if (statesProp.value.type !== 'array') {
      report('T3003', statesProp.value.start, '"states" must be an array of state names.')
    } else {
      for (const item of statesProp.value.items) {
        const s = str(item, 'A state name', STATE, 'lowercase letters, numbers and "-"')
        if (s === undefined) continue
        if (states.includes(s)) report('T3007', item.start, `Duplicate state ${q(s)}.`)
        else states.push(s)
      }
    }
  }

  const slotsProp = fields.get('slots')
  const slots = slotsProp ? stringMap(slotsProp.value, 'slots', 'slot', MEMBER) : {}
  const eventsProp = fields.get('events')
  const events = eventsProp ? stringMap(eventsProp.value, 'events', 'event', MEMBER) : {}

  // behavior
  let behavior: string | undefined
  const behaviorProp = fields.get('behavior')
  if (behaviorProp) {
    behavior = str(behaviorProp.value, '"behavior"')
    if (behavior !== undefined) {
      const requirements = behaviors[behavior]
      if (!requirements) {
        const close = nearest(behavior, Object.keys(behaviors))
        report(
          'T3008',
          behaviorProp.value.start,
          `Unknown behavior ${q(behavior)}. Known behaviors: ${list(Object.keys(behaviors))}.`,
          close ? `Did you mean ${q(close)}?` : undefined,
        )
        behavior = undefined
      } else {
        const need = (
          kind: 'part' | 'event' | 'state',
          required: readonly string[],
          have: readonly string[],
          field: string,
        ) => {
          for (const item of required) {
            if (!have.includes(item)) {
              report(
                'T3009',
                behaviorProp.value.start,
                `Behavior ${q(behavior!)} requires the ${kind} ${q(item)}, which is not in ${field}.`,
                `Add ${q(item)} to ${field}.`,
              )
            }
          }
        }
        if (partsProp?.value.type === 'array') need('part', requirements.parts, parts, 'parts')
        need('event', requirements.events, Object.keys(events), 'events')
        need('state', requirements.states, states, 'states')
      }
    }
  }

  // contrast
  const contrast: Contrast[] = []
  const contrastProp = fields.get('contrast')
  if (contrastProp) {
    if (contrastProp.value.type !== 'array') {
      report(
        'T3003',
        contrastProp.value.start,
        '"contrast" must be an array of { "foreground", "background" } pairs.',
      )
    } else {
      for (const item of contrastProp.value.items) {
        if (item.type !== 'object') {
          report(
            'T3003',
            item.start,
            'A contrast pairing must be an object like { "foreground": "label", "background": "root" }.',
          )
          continue
        }
        const pair: Partial<Contrast> = {}
        for (const prop of item.props) {
          if (prop.key !== 'foreground' && prop.key !== 'background') {
            const close = nearest(prop.key, ['foreground', 'background'])
            report(
              'T3002',
              prop.keyStart,
              `Unknown contrast field ${q(prop.key)}.`,
              close ? `Did you mean ${q(close)}?` : undefined,
            )
            continue
          }
          const part = str(prop.value, `Contrast ${q(prop.key)}`)
          if (part === undefined) continue
          if (partsProp?.value.type === 'array' && !parts.includes(part)) {
            const close = nearest(part, parts)
            report(
              'T3010',
              prop.value.start,
              `Contrast ${q(prop.key)} names ${q(part)}, which is not a declared part.`,
              close ? `Did you mean ${q(close)}?` : `Declared parts: ${list(parts)}.`,
            )
            continue
          }
          pair[prop.key] = part
        }
        for (const key of ['foreground', 'background'] as const) {
          if (!item.props.some((p) => p.key === key))
            report('T3012', item.start, `A contrast pairing is missing ${q(key)}.`)
        }
        if (pair.foreground !== undefined && pair.background !== undefined)
          contrast.push(pair as Contrast)
      }
    }
  }

  // plain optional strings
  const optional = (key: 'description' | 'since' | 'deprecated' | 'renamedFrom') => {
    const prop = fields.get(key)
    if (!prop) return undefined
    if (key === 'since') return str(prop.value, '"since"', SEMVER, 'a version such as "1.2.0"')
    if (key === 'renamedFrom')
      return str(prop.value, '"renamedFrom"', PASCAL, 'a PascalCase component name')
    return str(prop.value, q(key))
  }
  const description = optional('description')
  const since = optional('since')
  const deprecated = optional('deprecated')
  const renamedFrom = optional('renamedFrom')

  let forkedFrom: Contract['forkedFrom']
  const forkedProp = fields.get('forkedFrom')
  if (forkedProp) {
    const node = forkedProp.value
    if (node.type !== 'object') {
      report(
        'T3003',
        node.start,
        '"forkedFrom" must be an object like { "component": "Button", "version": "1.2.0" }.',
      )
    } else {
      const out: Partial<NonNullable<Contract['forkedFrom']>> = {}
      for (const prop of node.props) {
        if (prop.key === 'component')
          out.component = str(
            prop.value,
            '"forkedFrom.component"',
            PASCAL,
            'a PascalCase component name',
          )
        else if (prop.key === 'version')
          out.version = str(prop.value, '"forkedFrom.version"', SEMVER, 'a version such as "1.2.0"')
        else {
          const close = nearest(prop.key, ['component', 'version'])
          report(
            'T3002',
            prop.keyStart,
            `Unknown forkedFrom field ${q(prop.key)}.`,
            close ? `Did you mean ${q(close)}?` : undefined,
          )
        }
      }
      for (const key of ['component', 'version'] as const) {
        if (!node.props.some((p) => p.key === key))
          report('T3012', node.start, `"forkedFrom" is missing ${q(key)}.`)
      }
      if (out.component !== undefined && out.version !== undefined)
        forkedFrom = out as NonNullable<Contract['forkedFrom']>
    }
  }

  // deprecatedValues and renamedValues: variant name to value to a message or a replacement.
  const valueMap = (
    key: 'deprecatedValues' | 'renamedValues',
  ): Record<string, Record<string, string>> | undefined => {
    const prop = fields.get(key)
    if (!prop) return undefined
    const node = prop.value
    const example =
      key === 'renamedValues'
        ? '{ "tone": { "danger": "destructive" } }'
        : '{ "tone": { "neutral": "Use ghost." } }'
    if (node.type !== 'object') {
      report('T3003', node.start, `"${key}" must be an object like ${example}.`)
      return undefined
    }
    const out: Record<string, Record<string, string>> = {}
    for (const variant of node.props) {
      const allowed = variants[variant.key]
      if (!allowed) {
        const close = nearest(variant.key, Object.keys(variants))
        report(
          'T3014',
          variant.keyStart,
          `"${key}" names the variant ${q(variant.key)}, which this component does not have.`,
          close ? `Did you mean ${q(close)}?` : undefined,
        )
        continue
      }
      if (variant.value.type !== 'object') {
        report('T3003', variant.value.start, `"${key}.${variant.key}" must be an object of values.`)
        continue
      }
      const inner: Record<string, string> = {}
      for (const entry of variant.value.props) {
        const text = str(entry.value, `"${key}.${variant.key}.${entry.key}"`)
        if (text === undefined) continue
        if (key === 'deprecatedValues') {
          if (!allowed.includes(entry.key)) {
            report(
              'T3014',
              entry.keyStart,
              `${q(entry.key)} is deprecated but is not a value of ${variant.key}. A deprecated value is still allowed; to remove one, use "renamedValues".`,
            )
            continue
          }
        } else {
          if (allowed.includes(entry.key)) {
            report(
              'T3014',
              entry.keyStart,
              `${q(entry.key)} is listed as renamed but is still a value of ${variant.key}. Remove it from "variants" once it is renamed.`,
            )
            continue
          }
          if (!allowed.includes(text)) {
            report(
              'T3014',
              entry.value.start,
              `${q(entry.key)} was renamed to ${q(text)}, which is not a value of ${variant.key}.`,
              `Allowed values: ${list(allowed)}.`,
            )
            continue
          }
        }
        inner[entry.key] = text
      }
      if (Object.keys(inner).length) out[variant.key] = inner
    }
    return Object.keys(out).length ? out : undefined
  }
  const deprecatedValues = valueMap('deprecatedValues')
  const renamedValues = valueMap('renamedValues')

  const failed = diagnostics.some((d) => d.severity === 'error')
  const contract: Contract | undefined =
    failed || name === undefined || role === undefined
      ? undefined
      : {
          name,
          role,
          parts,
          variants,
          states,
          ...(behavior !== undefined ? { behavior } : {}),
          slots,
          events,
          ...(description !== undefined ? { description } : {}),
          contrast,
          ...(since !== undefined ? { since } : {}),
          ...(deprecated !== undefined ? { deprecated } : {}),
          ...(renamedFrom !== undefined ? { renamedFrom } : {}),
          ...(deprecatedValues ? { deprecatedValues } : {}),
          ...(renamedValues ? { renamedValues } : {}),
          ...(forkedFrom ? { forkedFrom } : {}),
        }

  return { contract, diagnostics, file, locate }
}

/** The default value of each variant: its first allowed value. */
export function variantDefaults(contract: Contract): Record<string, string> {
  return Object.fromEntries(Object.entries(contract.variants).map(([k, v]) => [k, v[0]!]))
}

export interface TemplateFacts {
  /** Every class name used anywhere in the template. */
  classes: Iterable<string>
  /** Class names on the template's single root element. Skip the root check by leaving it out. */
  rootClasses?: Iterable<string>
}

/**
 * Check a parsed contract against what the template contains: every declared part must appear as a
 * class, and the root element must carry the `root` part. The compiler calls this once it has parsed the template.
 */
export function checkTemplateParts(
  parsed: ParsedContract,
  template: TemplateFacts,
): ContractDiagnostic[] {
  const contract = parsed.contract
  if (!contract) return []
  const out: ContractDiagnostic[] = []
  const used = new Set(template.classes)
  const add = (code: ContractCode, index: number, message: string, hint: string) =>
    out.push({
      code,
      severity: 'error',
      message,
      hint,
      file: parsed.file,
      ...parsed.locate(['parts', index]),
    })

  contract.parts.forEach((part, index) => {
    if (!used.has(part)) {
      const close = nearest(part, used)
      add(
        'T3011',
        index,
        `Part ${q(part)} is declared in the contract, but no element in the template has class=${q(part)}.`,
        close
          ? `Did you mean class=${q(close)}?`
          : `Add class=${q(part)} to an element, or remove ${q(part)} from parts.`,
      )
    }
  })
  if (template.rootClasses && !new Set(template.rootClasses).has('root')) {
    add(
      'T3013',
      contract.parts.indexOf('root'),
      'The template\'s root element must carry class="root".',
      'Add class="root" to the outermost element.',
    )
  }
  return out
}
