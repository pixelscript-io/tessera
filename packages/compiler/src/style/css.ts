/**
 * A small CSS parser for `<style>` blocks, with nesting. It finds rules, at-rules and declarations and
 * records where each starts, so checks can point at real positions and rewrites can be applied to the
 * original text without reprinting it. It does not validate CSS; browsers do that.
 */

export interface CssRule {
  type: 'rule'
  selector: string
  selectorStart: number
  children: CssNode[]
  start: number
}

export interface CssAtRule {
  type: 'at'
  name: string
  params: string
  paramsStart: number
  /** Undefined for statement at-rules such as `@import`. */
  children?: CssNode[]
  start: number
}

export interface CssDecl {
  type: 'decl'
  prop: string
  propStart: number
  /** The value without a trailing `!important`. */
  value: string
  valueStart: number
  important: boolean
  start: number
}

export type CssNode = CssRule | CssAtRule | CssDecl

export interface CssError {
  offset: number
  message: string
}

/** Parse `css`, whose first character sits at `base` in the file. */
export function parseCss(css: string, base: number): { nodes: CssNode[]; errors: CssError[] } {
  const errors: CssError[] = []
  let i = 0

  const skipSpace = () => {
    for (;;) {
      while (i < css.length && /\s/.test(css[i]!)) i++
      if (css.startsWith('/*', i)) {
        const end = css.indexOf('*/', i + 2)
        if (end === -1) {
          errors.push({ offset: base + i, message: 'Unterminated comment.' })
          i = css.length
        } else i = end + 2
      } else return
    }
  }

  /** Read up to the next `{`, `;` or `}` outside parentheses, brackets, strings and comments. */
  const prelude = (): { text: string; start: number; end: number; stop: string } => {
    const start = i
    let depth = 0
    while (i < css.length) {
      const c = css[i]!
      if (c === '"' || c === "'") {
        i++
        while (i < css.length && css[i] !== c) i += css[i] === '\\' ? 2 : 1
        i++
        continue
      }
      if (c === '/' && css[i + 1] === '*') {
        const end = css.indexOf('*/', i + 2)
        i = end === -1 ? css.length : end + 2
        continue
      }
      if (c === '(' || c === '[') depth++
      else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
      else if (depth === 0 && (c === '{' || c === ';' || c === '}')) {
        return { text: css.slice(start, i), start, end: i, stop: c }
      }
      i++
    }
    return { text: css.slice(start), start, end: css.length, stop: '' }
  }

  const declaration = (text: string, start: number): CssDecl | undefined => {
    // The first colon outside parentheses separates property from value.
    let depth = 0
    let colon = -1
    for (let k = 0; k < text.length; k++) {
      const c = text[k]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === ':' && depth === 0) {
        colon = k
        break
      }
    }
    if (colon === -1) {
      if (text.trim()) {
        errors.push({
          offset: base + start + (text.length - text.trimStart().length),
          message: `Expected a declaration like "property: value", found "${text.trim()}".`,
        })
      }
      return undefined
    }
    const rawValue = text.slice(colon + 1)
    const leading = rawValue.length - rawValue.trimStart().length
    let value = rawValue.trim()
    const important = /!\s*important$/i.test(value)
    if (important) value = value.replace(/\s*!\s*important$/i, '')
    return {
      type: 'decl',
      prop: text.slice(0, colon).trim(),
      propStart: base + start + (text.length - text.trimStart().length),
      value,
      valueStart: base + start + colon + 1 + leading,
      important,
      start: base + start,
    }
  }

  const atRule = (text: string, start: number, children?: CssNode[]): CssAtRule => {
    const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(text)!
    return {
      type: 'at',
      name: m[1]!,
      params: m[2]!,
      paramsStart: base + start + text.length - m[2]!.length,
      ...(children ? { children } : {}),
      start: base + start,
    }
  }

  const block = (nested: boolean): CssNode[] => {
    const nodes: CssNode[] = []
    for (;;) {
      skipSpace()
      if (i >= css.length) {
        if (nested) errors.push({ offset: base + css.length, message: 'A "{" is never closed.' })
        return nodes
      }
      if (css[i] === '}') {
        i++
        if (!nested) {
          errors.push({ offset: base + i - 1, message: 'Unexpected "}".' })
          continue
        }
        return nodes
      }
      const p = prelude()
      const lead = p.text.length - p.text.trimStart().length
      const text = p.text.trim()
      const start = p.start + lead

      if (p.stop === '{') {
        i = p.end + 1
        const children = block(true)
        nodes.push(
          text.startsWith('@')
            ? atRule(text, start, children)
            : {
                type: 'rule',
                selector: text,
                selectorStart: base + start,
                children,
                start: base + start,
              },
        )
      } else {
        // `;`, `}` or the end of the input: a declaration, or a statement at-rule.
        i = p.stop === ';' ? p.end + 1 : p.end
        if (text.startsWith('@')) nodes.push(atRule(text, start))
        else if (text) {
          const decl = declaration(p.text, p.start)
          if (decl) nodes.push(decl)
        }
      }
    }
  }

  const nodes = block(false)
  return { nodes, errors }
}

/** Class names written in a selector, with the offset where each name starts (just after its dot). */
export function selectorClasses(
  selector: string,
  base: number,
): Array<{ name: string; start: number }> {
  const out: Array<{ name: string; start: number }> = []
  let i = 0
  while (i < selector.length) {
    const c = selector[i]!
    if (c === '\\') i += 2
    else if (c === '"' || c === "'") {
      i++
      while (i < selector.length && selector[i] !== c) i += selector[i] === '\\' ? 2 : 1
      i++
    } else if (c === '[') {
      // Attribute selectors can hold dots inside quoted values.
      while (i < selector.length && selector[i] !== ']') {
        if (selector[i] === '"' || selector[i] === "'") {
          const q = selector[i]
          i++
          while (i < selector.length && selector[i] !== q) i++
        }
        i++
      }
      i++
    } else if (c === '.' && /[A-Za-z_-]/.test(selector[i + 1] ?? '')) {
      const m = /^[A-Za-z_-][\w-]*/.exec(selector.slice(i + 1))!
      out.push({ name: m[0], start: base + i + 1 })
      i += 1 + m[0].length
    } else i++
  }
  return out
}
