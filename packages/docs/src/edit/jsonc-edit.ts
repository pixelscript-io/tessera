import { parseJsonc, type JsonNode, type JsonProp } from '@tessera/contract'

/**
 * Edits to JSONC text that change only what they name. A contract is JSONC with comments, and a person's layout
 * and comments are theirs: these functions replace a value, add or remove a property or an array item, and
 * leave every other character where it was. Each returns the new text; it is re-parsed between steps, so a step
 * can build on the last.
 */

export interface TextEdit {
  start: number
  end: number
  text: string
}

export function applyEdits(text: string, edits: TextEdit[]): string {
  // Edits at the same place keep the order they were given in (a comma, then the line that follows it).
  const merged: TextEdit[] = []
  for (const e of edits) {
    const same = merged.find((m) => m.start === e.start && m.end === m.start && e.end === e.start)
    if (same) same.text += e.text
    else merged.push({ ...e })
  }
  let out = text
  for (const e of merged.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }
  return out
}

const json = (value: unknown) => JSON.stringify(value)

/** The text of the line that `offset` is on, from its start. */
const lineStart = (text: string, offset: number) => text.lastIndexOf('\n', offset - 1) + 1
const lineEnd = (text: string, offset: number) => {
  const i = text.indexOf('\n', offset)
  return i === -1 ? text.length : i
}
const indentOf = (text: string, offset: number) =>
  /^[ \t]*/.exec(text.slice(lineStart(text, offset)))![0]

/** Skip spaces and tabs forward from `offset`. */
function skipBlank(text: string, offset: number): number {
  let i = offset
  while (text[i] === ' ' || text[i] === '\t') i++
  return i
}

/** The node at `path` (object keys and array indexes), or undefined. */
function nodeAt(root: JsonNode, path: Array<string | number>): JsonNode | undefined {
  let node: JsonNode | undefined = root
  for (const step of path) {
    if (!node) return undefined
    if (node.type === 'object' && typeof step === 'string') {
      node = node.props.find((p) => p.key === step)?.value
    } else if (node.type === 'array' && typeof step === 'number') node = node.items[step]
    else return undefined
  }
  return node
}

/**
 * Where a new member goes after `last` (the last property or item of a container), and whether it needs a comma
 * first. A trailing comma and a comment on the same line are kept in place: the new member goes after both.
 */
function afterLast(
  text: string,
  last: { end: number },
): { at: number; needsComma: boolean; commaAt: number } {
  let i = skipBlank(text, last.end)
  let needsComma = true
  if (text[i] === ',') {
    needsComma = false
    i = skipBlank(text, i + 1)
  }
  // A comment on the same line stays with the member it follows.
  if (text.startsWith('//', i)) i = lineEnd(text, i)
  else if (text.startsWith('/*', i)) {
    const close = text.indexOf('*/', i + 2)
    if (close !== -1 && !text.slice(i, close).includes('\n')) i = close + 2
  }
  return { at: i, needsComma, commaAt: last.end }
}

/** Add `"key": value` to the object at `path`. */
function addProp(text: string, path: string[], key: string, valueJson: string): string {
  const root = parseJsonc(text)
  const obj = nodeAt(root, path)
  if (!obj || obj.type !== 'object')
    throw new Error(`There is no object at ${path.join('.') || 'the top level'}.`)
  const member = `${json(key)}: ${valueJson}`
  const multiline = text.slice(obj.start, obj.end).includes('\n')

  if (!obj.props.length) {
    // `{}` becomes `{ "key": v }`, or a block when the object is already spread over lines.
    if (!multiline)
      return applyEdits(text, [{ start: obj.start, end: obj.end, text: `{ ${member} }` }])
    const base = indentOf(text, obj.start)
    return applyEdits(text, [
      { start: obj.start, end: obj.end, text: `{\n${base}  ${member}\n${base}}` },
    ])
  }

  const last = obj.props[obj.props.length - 1]!
  const { at, needsComma, commaAt } = afterLast(text, last.value)
  if (!multiline) {
    const edits: TextEdit[] = [{ start: last.value.end, end: last.value.end, text: `, ${member}` }]
    // `{ "a": 1, }` already has a comma: the member goes after it.
    if (!needsComma) edits[0] = { start: at, end: at, text: ` ${member},` }
    return applyEdits(text, edits)
  }
  const indent = indentOf(text, last.keyStart)
  const edits: TextEdit[] = []
  if (needsComma) edits.push({ start: commaAt, end: commaAt, text: ',' })
  // After the last member's own line (and its comment): a new line, with a comma only if the container wants one.
  edits.push({
    start: lineEnd(text, at),
    end: lineEnd(text, at),
    text: `\n${indent}${member}${needsComma ? '' : ','}`,
  })
  return applyEdits(text, edits)
}

/** Add an item to the array at `path`. */
function addItem(text: string, path: string[], valueJson: string): string {
  const root = parseJsonc(text)
  const arr = nodeAt(root, path)
  if (!arr || arr.type !== 'array') throw new Error(`There is no array at ${path.join('.')}.`)
  if (!arr.items.length) {
    return applyEdits(text, [{ start: arr.start, end: arr.end, text: `[${valueJson}]` }])
  }
  const last = arr.items[arr.items.length - 1]!
  const multiline = text.slice(arr.start, arr.end).includes('\n')
  if (!multiline)
    return applyEdits(text, [{ start: last.end, end: last.end, text: `, ${valueJson}` }])
  const indent = indentOf(text, last.start)
  const { at, needsComma, commaAt } = afterLast(text, last)
  const edits: TextEdit[] = []
  if (needsComma) edits.push({ start: commaAt, end: commaAt, text: ',' })
  edits.push({
    start: lineEnd(text, at),
    end: lineEnd(text, at),
    text: `\n${indent}${valueJson}${needsComma ? '' : ','}`,
  })
  return applyEdits(text, edits)
}

/** Set the value at `path`, adding the property (and any objects on the way) if it is not there. */
export function setIn(text: string, path: string[], valueJson: string): string {
  let current = text
  for (let depth = 1; depth <= path.length; depth++) {
    const node = nodeAt(parseJsonc(current), path.slice(0, depth))
    const last = depth === path.length
    if (node) {
      if (last) return applyEdits(current, [{ start: node.start, end: node.end, text: valueJson }])
      continue
    }
    // Missing: add it under its parent, as an empty object unless it is the final value.
    current = addProp(current, path.slice(0, depth - 1), path[depth - 1]!, last ? valueJson : '{}')
    if (last) return current
  }
  return current
}

/** Remove the property at `path`, and the objects it leaves empty. */
export function removeIn(text: string, path: string[]): string {
  const root = parseJsonc(text)
  const parent = nodeAt(root, path.slice(0, -1))
  if (!parent || parent.type !== 'object') return text
  const index = parent.props.findIndex((p) => p.key === path[path.length - 1])
  if (index === -1) return text
  const prop: JsonProp = parent.props[index]!
  const multiline = text.slice(parent.start, parent.end).includes('\n')
  let out: string
  if (parent.props.length === 1) {
    out = applyEdits(text, [{ start: parent.start, end: parent.end, text: '{}' }])
  } else if (multiline && !text.slice(lineStart(text, prop.keyStart), prop.keyStart).trim()) {
    // Its own line: take the whole line, and fix the comma of the neighbour that is now last.
    const start = lineStart(text, prop.keyStart)
    const end = Math.min(text.length, lineEnd(text, prop.value.end) + 1)
    const edits: TextEdit[] = [{ start, end, text: '' }]
    if (index === parent.props.length - 1) {
      const before = parent.props[index - 1]!
      const comma = skipBlank(text, before.value.end)
      if (text[comma] === ',') edits.push({ start: comma, end: comma + 1, text: '' })
    }
    out = applyEdits(text, edits)
  } else if (index === parent.props.length - 1) {
    const before = parent.props[index - 1]!
    out = applyEdits(text, [{ start: before.value.end, end: prop.value.end, text: '' }])
  } else {
    const next = parent.props[index + 1]!
    out = applyEdits(text, [{ start: prop.keyStart, end: next.keyStart, text: '' }])
  }
  // An object this left empty goes too, so renamedValues does not keep an empty { "tone": {} }.
  if (path.length > 1) {
    const up = nodeAt(parseJsonc(out), path.slice(0, -1))
    if (up && up.type === 'object' && up.props.length === 0) return removeIn(out, path.slice(0, -1))
  }
  return out
}

export const appendItemIn = addItem

/**
 * Put the string items of the array at `path` in a new order, by replacing each item where it stands, so the
 * commas, line breaks and comments around them do not move.
 */
export function reorderStrings(text: string, path: string[], order: string[]): string {
  const arr = nodeAt(parseJsonc(text), path)
  if (!arr || arr.type !== 'array') throw new Error(`There is no array at ${path.join('.')}.`)
  const edits = arr.items.map((item, i) => ({
    start: item.start,
    end: item.end,
    text: json(order[i]),
  }))
  return applyEdits(text, edits)
}

/** Replace the string item at `index` of the array at `path`. */
export function replaceItem(text: string, path: string[], index: number, value: string): string {
  const arr = nodeAt(parseJsonc(text), path)
  if (!arr || arr.type !== 'array' || !arr.items[index])
    throw new Error(`There is no item ${index} at ${path.join('.')}.`)
  const item = arr.items[index]!
  return applyEdits(text, [{ start: item.start, end: item.end, text: json(value) }])
}

/** Remove the item at `index` of the array at `path`. */
export function removeItem(text: string, path: string[], index: number): string {
  const arr = nodeAt(parseJsonc(text), path)
  if (!arr || arr.type !== 'array' || !arr.items[index]) return text
  const item = arr.items[index]!
  const next = arr.items[index + 1]
  if (next) return applyEdits(text, [{ start: item.start, end: next.start, text: '' }])
  const before = arr.items[index - 1]
  if (!before) return applyEdits(text, [{ start: arr.start, end: arr.end, text: '[]' }])
  return applyEdits(text, [{ start: before.end, end: item.end, text: '' }])
}

/** The string values of the array at `path`. */
export function stringsAt(text: string, path: string[]): string[] {
  const arr = nodeAt(parseJsonc(text), path)
  if (!arr || arr.type !== 'array') return []
  return arr.items.flatMap((i) => (i.type === 'string' ? [i.value] : []))
}

/** The string at `path`, if there is one. */
export function stringAt(text: string, path: string[]): string | undefined {
  const node = nodeAt(parseJsonc(text), path)
  return node?.type === 'string' ? node.value : undefined
}

/** The keys of the object at `path`. */
export function keysAt(text: string, path: string[]): string[] {
  const node = nodeAt(parseJsonc(text), path)
  return node?.type === 'object' ? node.props.map((p) => p.key) : []
}

export function hasIn(text: string, path: string[]): boolean {
  return nodeAt(parseJsonc(text), path) !== undefined
}
