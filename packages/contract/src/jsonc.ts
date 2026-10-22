/**
 * A small JSONC parser (JSON with `//` and block comments, trailing commas tolerated) that keeps the
 * source offset of every node, so contract errors can point at a line and column. It has no
 * dependencies and no Node APIs, so it runs in a browser.
 */

export type JsonNode =
  | { type: 'object'; start: number; end: number; props: JsonProp[] }
  | { type: 'array'; start: number; end: number; items: JsonNode[] }
  | { type: 'string'; start: number; end: number; value: string }
  | { type: 'number'; start: number; end: number; value: number }
  | { type: 'boolean'; start: number; end: number; value: boolean }
  | { type: 'null'; start: number; end: number }

export interface JsonProp {
  key: string
  keyStart: number
  keyEnd: number
  value: JsonNode
}

export class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message)
  }
}

export function parseJsonc(text: string): JsonNode {
  let i = 0

  const fail = (message: string, at = i): never => {
    throw new JsonSyntaxError(message, at)
  }

  function skip(): void {
    for (;;) {
      const c = text[i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++
      else if (c === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++
      } else if (c === '/' && text[i + 1] === '*') {
        const close = text.indexOf('*/', i + 2)
        if (close === -1) fail('Unterminated comment', i)
        i = close + 2
      } else return
    }
  }

  function string(): { value: string; start: number; end: number } {
    const start = i
    i++
    let value = ''
    for (;;) {
      const c = text[i]
      if (c === undefined || c === '\n') return fail('Unterminated string', start)
      if (c === '"') {
        i++
        return { value, start, end: i }
      }
      if (c === '\\') {
        const e = text[i + 1]
        const simple: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        }
        if (e !== undefined && e in simple) {
          value += simple[e]
          i += 2
        } else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
          value += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16))
          i += 6
        } else fail('Invalid escape sequence in string', i)
      } else {
        value += c
        i++
      }
    }
  }

  function value(): JsonNode {
    skip()
    const start = i
    const c = text[i]
    if (c === '{') {
      i++
      const props: JsonProp[] = []
      for (;;) {
        skip()
        if (text[i] === '}') {
          i++
          return { type: 'object', start, end: i, props }
        }
        if (text[i] !== '"') return fail('Expected a property name in double quotes')
        const key = string()
        skip()
        if (text[i] !== ':') return fail('Expected ":" after the property name')
        i++
        props.push({ key: key.value, keyStart: key.start, keyEnd: key.end, value: value() })
        skip()
        if (text[i] === ',') i++
        else if (text[i] !== '}') return fail('Expected "," or "}"')
      }
    }
    if (c === '[') {
      i++
      const items: JsonNode[] = []
      for (;;) {
        skip()
        if (text[i] === ']') {
          i++
          return { type: 'array', start, end: i, items }
        }
        items.push(value())
        skip()
        if (text[i] === ',') i++
        else if (text[i] !== ']') return fail('Expected "," or "]"')
      }
    }
    if (c === '"') {
      const s = string()
      return { type: 'string', start: s.start, end: s.end, value: s.value }
    }
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i))
    if (number) {
      i += number[0].length
      return { type: 'number', start, end: i, value: Number(number[0]) }
    }
    for (const [word, v] of [
      ['true', true],
      ['false', false],
    ] as const) {
      if (text.startsWith(word, i)) {
        i += word.length
        return { type: 'boolean', start, end: i, value: v }
      }
    }
    if (text.startsWith('null', i)) {
      i += 4
      return { type: 'null', start, end: i }
    }
    return fail(c === undefined ? 'Unexpected end of contract' : `Unexpected character "${c}"`)
  }

  const root = value()
  skip()
  if (i < text.length) fail('Unexpected content after the contract object')
  return root
}

/** Convert source offsets to 1-based line and column, optionally shifted to where the text sits in a larger file. */
export function lineTable(
  text: string,
  origin: { line: number; column: number } = { line: 1, column: 1 },
) {
  const starts = [0]
  for (let n = 0; n < text.length; n++) if (text[n] === '\n') starts.push(n + 1)
  return (offset: number): { line: number; column: number } => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    const column = offset - starts[lo]! + 1
    return {
      line: origin.line + lo,
      column: lo === 0 ? origin.column + column - 1 : column,
    }
  }
}
