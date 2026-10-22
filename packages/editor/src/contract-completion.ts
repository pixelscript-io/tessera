import { ARIA_ROLES, DEFAULT_BEHAVIORS, contractSchema } from '@tessera/contract'
import { blockRange } from './service'

export interface Completion {
  label: string
  /** Text to put in place of the replaced range. */
  insert: string
  detail?: string
  kind: 'property' | 'value'
}

export interface CompletionResult {
  /** Offsets in the file of the text the completion replaces. */
  replaceStart: number
  replaceEnd: number
  items: Completion[]
}

interface Frame {
  kind: 'object' | 'array'
  /** The property name this container is the value of (in its parent object). */
  parentKey?: string
  /** The enclosing container was an array. */
  inArray: boolean
  /** Object: property whose value is being written. */
  key?: string
  pendingKey?: string
  expectKey: boolean
  seen: Set<string>
}

const FIELD_DETAIL = contractSchema.properties as Record<string, { description?: string }>

/**
 * Completions inside the `<contract>` block: field names, ARIA roles, behaviors and declared parts.
 * The scan is tolerant of half-typed JSON, since this runs while the user is mid-edit.
 */
export function completeContract(source: string, offset: number): CompletionResult | undefined {
  const range = blockRange(source, 'contract')
  if (!range || offset < range.start || offset > range.end) return undefined

  const stack: Frame[] = []
  const parts: string[] = []
  let inString: { start: number; text: string } | undefined

  const frame = () => stack[stack.length - 1]
  const open = (kind: 'object' | 'array') => {
    const parent = frame()
    stack.push({
      kind,
      parentKey: parent?.kind === 'object' ? parent.key : parent?.parentKey,
      inArray: parent?.kind === 'array',
      expectKey: kind === 'object',
      seen: new Set(),
    })
  }
  const closeValue = () => {
    const f = frame()
    if (f?.kind === 'object') {
      f.key = undefined
      f.expectKey = false
    }
  }

  let i = range.start
  while (i < offset) {
    const c = source[i]!
    if (c === '/' && source[i + 1] === '/') {
      while (i < offset && source[i] !== '\n') i++
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 || end + 2 > offset ? offset : end + 2
    } else if (c === '"') {
      let j = i + 1
      while (j < offset && source[j] !== '"' && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1
      if (j >= offset || source[j] !== '"') {
        inString = { start: i, text: source.slice(i + 1, offset) }
        i = offset
      } else {
        const text = source.slice(i + 1, j)
        const f = frame()
        if (f?.kind === 'object' && f.expectKey) f.pendingKey = text
        else if (f?.kind === 'array' && f.parentKey === 'parts' && stack.length === 2)
          parts.push(text)
        else closeValue()
        i = j + 1
      }
    } else if (c === '{') {
      open('object')
      i++
    } else if (c === '[') {
      open('array')
      i++
    } else if (c === '}' || c === ']') {
      stack.pop()
      closeValue()
      i++
    } else if (c === ':') {
      const f = frame()
      if (f?.kind === 'object' && f.pendingKey !== undefined) {
        f.key = f.pendingKey
        f.seen.add(f.pendingKey)
        f.pendingKey = undefined
        f.expectKey = false
      }
      i++
    } else if (c === ',') {
      const f = frame()
      if (f?.kind === 'object') {
        f.key = undefined
        f.expectKey = true
      }
      i++
    } else {
      i++
    }
  }

  const top = frame()
  if (!top) return undefined

  const keysFor = (f: Frame): string[] | undefined => {
    if (stack.length === 1) return Object.keys(contractSchema.properties)
    if (f.parentKey === 'contrast' && f.inArray) return ['foreground', 'background']
    if (f.parentKey === 'forkedFrom' && !f.inArray) return ['component', 'version']
    return undefined
  }

  const valuesFor = (f: Frame): string[] | undefined => {
    if (stack.length === 1 && f.key === 'role') return [...ARIA_ROLES]
    if (stack.length === 1 && f.key === 'behavior') return Object.keys(DEFAULT_BEHAVIORS)
    if (
      f.parentKey === 'contrast' &&
      f.inArray &&
      (f.key === 'foreground' || f.key === 'background')
    ) {
      return parts
    }
    return undefined
  }

  // Where the replaced text ends: the rest of the string being typed, if there is one.
  const stringEnd = (from: number) => {
    const close = source.indexOf('"', from)
    const newline = source.indexOf('\n', from)
    return close !== -1 && (newline === -1 || close < newline) && close <= range.end ? close : from
  }

  if (top.kind === 'object' && top.expectKey) {
    const keys = keysFor(top)?.filter((k) => !top.seen.has(k))
    if (!keys?.length) return undefined
    const describe = (k: string) => FIELD_DETAIL[k]?.description
    if (inString) {
      return {
        replaceStart: inString.start + 1,
        replaceEnd: stringEnd(offset),
        items: keys.map((k) => ({ label: k, insert: k, detail: describe(k), kind: 'property' })),
      }
    }
    // A bare word being typed is replaced by the quoted key.
    const word = /[A-Za-z]*$/.exec(source.slice(range.start, offset))![0]
    return {
      replaceStart: offset - word.length,
      replaceEnd: offset,
      items: keys
        .filter((k) => k.startsWith(word))
        .map((k) => ({ label: k, insert: `"${k}": `, detail: describe(k), kind: 'property' })),
    }
  }

  if (top.kind === 'object' && top.key !== undefined) {
    const values = valuesFor(top)
    if (!values?.length) return undefined
    if (inString) {
      return {
        replaceStart: inString.start + 1,
        replaceEnd: stringEnd(offset),
        items: values.map((v) => ({ label: v, insert: v, kind: 'value' })),
      }
    }
    const word = /[A-Za-z]*$/.exec(source.slice(range.start, offset))![0]
    return {
      replaceStart: offset - word.length,
      replaceEnd: offset,
      items: values
        .filter((v) => v.startsWith(word))
        .map((v) => ({ label: v, insert: `"${v}"`, kind: 'value' })),
    }
  }
  return undefined
}
