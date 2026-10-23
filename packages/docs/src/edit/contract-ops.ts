import {
  appendItemIn,
  hasIn,
  keysAt,
  removeIn,
  removeItem,
  reorderStrings,
  replaceItem,
  setIn,
  stringAt,
  stringsAt,
} from './jsonc-edit'

/**
 * The changes a person can make to a component's contract through the manager. Each is a description of what they
 * want, not text: `editContract` turns it into the smallest change to the contract's JSONC.
 */
export type ContractOp =
  | { kind: 'description'; value: string }
  | { kind: 'since'; value: string }
  /** `null` removes the deprecation. */
  | { kind: 'deprecated'; value: string | null }
  | { kind: 'addVariant'; variant: string; values: string[] }
  | { kind: 'addValue'; variant: string; value: string }
  /** The old value is renamed in place, and `renamedValues` records it so the codemod can update every use. */
  | { kind: 'renameValue'; variant: string; from: string; to: string }
  /** `message: null` removes the deprecation. The value stays allowed. */
  | { kind: 'deprecateValue'; variant: string; value: string; message: string | null }
  | { kind: 'removeValue'; variant: string; value: string }
  | { kind: 'setDefault'; variant: string; value: string }
  /** Add a slot, or change a slot's description. */
  | { kind: 'slot'; name: string; description: string }
  | { kind: 'event'; name: string; description: string }

/** A change that cannot be made, with a sentence that says why. */
export class OpError extends Error {}

/** A sentence for the change, for the pending-change panel and for a commit message. */
export function describeOp(component: string, op: ContractOp): string {
  switch (op.kind) {
    case 'description':
      return `Change the description of ${component}`
    case 'since':
      return `Set the version ${component} was introduced in to ${op.value}`
    case 'deprecated':
      return op.value === null ? `Remove the deprecation of ${component}` : `Deprecate ${component}`
    case 'addVariant':
      return `Add the variant ${op.variant} to ${component}`
    case 'addValue':
      return `Add ${op.variant} "${op.value}" to ${component}`
    case 'renameValue':
      return `Rename ${component}.${op.variant} "${op.from}" to "${op.to}"`
    case 'deprecateValue':
      return op.message === null
        ? `Remove the deprecation of ${component}.${op.variant} "${op.value}"`
        : `Deprecate ${component}.${op.variant} "${op.value}"`
    case 'removeValue':
      return `Remove ${component}.${op.variant} "${op.value}"`
    case 'setDefault':
      return `Make "${op.value}" the default of ${component}.${op.variant}`
    case 'slot':
      return `Change the ${op.name} slot of ${component}`
    case 'event':
      return `Change the ${op.name} event of ${component}`
  }
}

function needVariant(text: string, variant: string): string[] {
  if (!hasIn(text, ['variants', variant])) {
    const known = keysAt(text, ['variants'])
    throw new OpError(
      `${variant} is not a variant of this component.${known.length ? ` Its variants: ${known.join(', ')}.` : ''}`,
    )
  }
  return stringsAt(text, ['variants', variant])
}

const q = (s: string) => JSON.stringify(s)

/** Apply an operation to the text of a contract (the JSONC between `<contract>` and `</contract>`). */
export function editContract(text: string, op: ContractOp): string {
  switch (op.kind) {
    case 'description':
      return op.value === ''
        ? removeIn(text, ['description'])
        : setIn(text, ['description'], q(op.value))
    case 'since':
      return op.value === '' ? removeIn(text, ['since']) : setIn(text, ['since'], q(op.value))
    case 'deprecated':
      return op.value === null
        ? removeIn(text, ['deprecated'])
        : setIn(text, ['deprecated'], q(op.value))

    case 'addVariant': {
      if (hasIn(text, ['variants', op.variant])) {
        throw new OpError(`${op.variant} is already a variant of this component.`)
      }
      if (!op.values.length)
        throw new OpError('A variant needs at least one value. The first is the default.')
      return setIn(text, ['variants', op.variant], `[${op.values.map(q).join(', ')}]`)
    }
    case 'addValue': {
      const current = needVariant(text, op.variant)
      if (current.includes(op.value))
        throw new OpError(`${op.variant} already has the value "${op.value}".`)
      return appendItemIn(text, ['variants', op.variant], q(op.value))
    }
    case 'renameValue': {
      const current = needVariant(text, op.variant)
      const index = current.indexOf(op.from)
      if (index === -1) throw new OpError(`${op.variant} has no value "${op.from}".`)
      if (current.includes(op.to))
        throw new OpError(`${op.variant} already has the value "${op.to}".`)
      let out = replaceItem(text, ['variants', op.variant], index, op.to)
      // A rename made earlier that pointed at the old name now points at the new one.
      for (const old of keysAt(out, ['renamedValues', op.variant])) {
        if (stringAt(out, ['renamedValues', op.variant, old]) === op.from) {
          out = setIn(out, ['renamedValues', op.variant, old], q(op.to))
        }
      }
      out = setIn(out, ['renamedValues', op.variant, op.from], q(op.to))
      // A deprecation of the old name is carried to the new one.
      const why = stringAt(out, ['deprecatedValues', op.variant, op.from])
      if (why !== undefined) {
        out = removeIn(out, ['deprecatedValues', op.variant, op.from])
        out = setIn(out, ['deprecatedValues', op.variant, op.to], q(why))
      }
      return out
    }
    case 'deprecateValue': {
      const current = needVariant(text, op.variant)
      if (!current.includes(op.value))
        throw new OpError(`${op.variant} has no value "${op.value}".`)
      return op.message === null
        ? removeIn(text, ['deprecatedValues', op.variant, op.value])
        : setIn(text, ['deprecatedValues', op.variant, op.value], q(op.message))
    }
    case 'removeValue': {
      const current = needVariant(text, op.variant)
      const index = current.indexOf(op.value)
      if (index === -1) throw new OpError(`${op.variant} has no value "${op.value}".`)
      if (current.length === 1) {
        throw new OpError(
          `${op.variant} would have no values. Remove the variant in the file instead.`,
        )
      }
      const out = removeItem(text, ['variants', op.variant], index)
      return removeIn(out, ['deprecatedValues', op.variant, op.value])
    }
    case 'setDefault': {
      const current = needVariant(text, op.variant)
      if (!current.includes(op.value))
        throw new OpError(`${op.variant} has no value "${op.value}".`)
      if (current[0] === op.value) {
        throw new OpError(`"${op.value}" is already the default of ${op.variant}.`)
      }
      return reorderStrings(
        text,
        ['variants', op.variant],
        [op.value, ...current.filter((v) => v !== op.value)],
      )
    }
    case 'slot':
    case 'event':
      return setIn(text, [op.kind === 'slot' ? 'slots' : 'events', op.name], q(op.description))
  }
}
