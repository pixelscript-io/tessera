import type { Reporter } from './diagnostics'

export interface Attr {
  name: string
  nameStart: number
  /** `null` for an attribute written with no value, such as `disabled`. */
  value: string | null
  /** Offset of the first character of the value, inside the quotes. */
  valueStart: number
}

export interface ElementNode {
  type: 'element'
  tag: string
  attrs: Attr[]
  children: TemplateNode[]
  start: number
  /** Offset just after the opening tag's name, for errors about the tag itself. */
  end: number
  /** Offset just after the `>` of the opening tag. */
  openEnd: number
  /** Written as `<tag />`, or a void element such as `<input>`. */
  selfClosing: boolean
  /** Offset of the `</tag>` that closes it, if it has one. */
  closeStart?: number
}

export type TextPart =
  { kind: 'text'; value: string } | { kind: 'expr'; code: string; start: number }

export interface TextNode {
  type: 'text'
  parts: TextPart[]
  start: number
}

export type TemplateNode = ElementNode | TextNode

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

/**
 * Parse the HTML-like template. `start`/`end` delimit the template block's content in `source`, so every
 * node carries an offset into the whole file. Tag names keep their case (components are PascalCase).
 */
export function parseTemplate(
  source: string,
  start: number,
  end: number,
  report: Reporter,
): TemplateNode[] {
  const root: TemplateNode[] = []
  const stack: ElementNode[] = []
  const children = () => (stack.length ? stack[stack.length - 1]!.children : root)
  let i = start

  while (i < end) {
    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4)
      i = close === -1 || close > end ? end : close + 3
      continue
    }

    if (source.startsWith('</', i)) {
      const m = /^<\/([A-Za-z][A-Za-z0-9-]*)\s*>/.exec(source.slice(i, end))
      if (!m) {
        report.error('T4003', i, 'Malformed closing tag.')
        i += 2
        continue
      }
      const open = stack[stack.length - 1]
      if (!open) {
        report.error(
          'T4003',
          i,
          `Unexpected closing tag </${m[1]}>, which has no matching opening tag.`,
        )
      } else if (open.tag !== m[1]) {
        report.error(
          'T4003',
          i,
          `Unexpected closing tag </${m[1]}>. Expected </${open.tag}> to close the <${open.tag}> at line ${lineOf(source, open.start)}.`,
        )
        // Recover: pop until the matching tag, if it is open.
        const idx = stack.findLastIndex((n) => n.tag === m[1])
        if (idx !== -1) stack.length = idx
      } else {
        open.closeStart = i
        stack.pop()
      }
      i += m[0].length
      continue
    }

    if (source[i] === '<' && /[A-Za-z]/.test(source[i + 1] ?? '')) {
      const tag = parseOpenTag(source, i, end, report)
      if (!tag) break
      children().push(tag.node)
      if (VOID.has(tag.node.tag)) tag.node.selfClosing = true
      if (!tag.selfClosing && !VOID.has(tag.node.tag)) stack.push(tag.node)
      i = tag.next
      continue
    }

    // Text with {expressions}.
    const text = parseText(source, i, end, report)
    if (text.node.parts.length) children().push(text.node)
    i = text.next
  }

  for (const open of stack) {
    report.error('T4003', open.start, `The <${open.tag}> tag is never closed. Add </${open.tag}>.`)
  }
  return root
}

function lineOf(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i++) if (source[i] === '\n') line++
  return line
}

function parseOpenTag(
  source: string,
  start: number,
  end: number,
  report: Reporter,
): { node: ElementNode; selfClosing: boolean; next: number } | undefined {
  const name = /^<([A-Za-z][A-Za-z0-9._:-]*)/.exec(source.slice(start, end))!
  const node: ElementNode = {
    type: 'element',
    tag: name[1]!,
    attrs: [],
    children: [],
    start,
    end: start + name[0].length,
    openEnd: start + name[0].length,
    selfClosing: false,
  }
  let i = start + name[0].length

  for (;;) {
    while (i < end && /\s/.test(source[i]!)) i++
    if (i >= end) {
      report.error('T4003', start, `The <${node.tag}> tag is never closed with ">".`)
      return undefined
    }
    if (source[i] === '>') {
      node.openEnd = i + 1
      return { node, selfClosing: false, next: i + 1 }
    }
    if (source.startsWith('/>', i)) {
      node.openEnd = i + 2
      node.selfClosing = true
      return { node, selfClosing: true, next: i + 2 }
    }

    const attr = /^[^\s=>/"'][^\s=>"']*/.exec(source.slice(i, end))
    if (!attr) {
      report.error(
        'T4003',
        i,
        `Unexpected character ${JSON.stringify(source[i])} in the <${node.tag}> tag.`,
      )
      i++
      continue
    }
    const nameStart = i
    i += attr[0].length
    let j = i
    while (j < end && /\s/.test(source[j]!)) j++
    if (source[j] !== '=') {
      node.attrs.push({ name: attr[0], nameStart, value: null, valueStart: i })
      continue
    }
    j++
    while (j < end && /\s/.test(source[j]!)) j++
    const quote = source[j]
    if (quote === '"' || quote === "'") {
      const close = source.indexOf(quote, j + 1)
      if (close === -1 || close > end) {
        report.error('T4003', j, `The value of "${attr[0]}" is missing its closing ${quote}.`)
        return undefined
      }
      node.attrs.push({
        name: attr[0],
        nameStart,
        value: source.slice(j + 1, close),
        valueStart: j + 1,
      })
      i = close + 1
    } else {
      const bare = /^[^\s>]+/.exec(source.slice(j, end))
      if (!bare) {
        report.error('T4003', j, `The attribute "${attr[0]}" has "=" but no value.`)
        i = j
        continue
      }
      node.attrs.push({ name: attr[0], nameStart, value: bare[0], valueStart: j })
      i = j + bare[0].length
    }
  }
}

function parseText(
  source: string,
  start: number,
  end: number,
  report: Reporter,
): { node: TextNode; next: number } {
  const parts: TextPart[] = []
  let buffer = ''
  let i = start

  const flush = () => {
    if (buffer) parts.push({ kind: 'text', value: buffer })
    buffer = ''
  }

  while (i < end) {
    const c = source[i]!
    if (c === '<' && (/[A-Za-z/]/.test(source[i + 1] ?? '') || source.startsWith('<!--', i))) break
    if (c === '{') {
      const close = findBraceEnd(source, i + 1, end)
      if (close === -1) {
        report.error('T4003', i, 'This "{" is never closed. Write a literal brace as {"{"}.')
        buffer += source.slice(i, end)
        i = end
        break
      }
      flush()
      parts.push({ kind: 'expr', code: source.slice(i + 1, close), start: i + 1 })
      i = close + 1
      continue
    }
    buffer += c
    i++
  }
  flush()
  return { node: { type: 'text', parts, start }, next: i }
}

/** Index of the `}` that closes an expression, skipping strings and template literals. */
export function findBraceEnd(source: string, from: number, end: number): number {
  let depth = 1
  for (let i = from; i < end; i++) {
    const c = source[i]!
    if (c === '"' || c === "'") {
      i = skipString(source, i, end)
    } else if (c === '`') {
      i = skipTemplate(source, i, end)
    } else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

function skipString(source: string, i: number, end: number): number {
  const quote = source[i]
  for (let j = i + 1; j < end; j++) {
    if (source[j] === '\\') j++
    else if (source[j] === quote) return j
  }
  return end
}

function skipTemplate(source: string, i: number, end: number): number {
  for (let j = i + 1; j < end; j++) {
    const c = source[j]
    if (c === '\\') j++
    else if (c === '`') return j
    else if (c === '$' && source[j + 1] === '{') {
      const close = findBraceEnd(source, j + 2, end)
      if (close === -1) return end
      j = close
    }
  }
  return end
}
