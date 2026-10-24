import { isColorFunction } from '@tessera/tokens'

/** A piece of a declaration value that style enforcement cares about. Offsets are absolute in the file. */
export type Atom =
  | { kind: 'token'; path: string; start: number; end: number; cssVar?: string }
  | { kind: 'raw'; start: number; end: number; args: RawArg[] }
  | { kind: 'length'; value: number; unit: string; text: string; start: number; end: number }
  | { kind: 'duration'; value: number; unit: string; text: string; start: number; end: number }
  | { kind: 'number'; value: number; text: string; start: number; end: number }
  | { kind: 'color'; text: string; start: number; end: number }
  | { kind: 'ident'; text: string; start: number; end: number }

/** One argument of `raw(...)`, trimmed, with where it starts. */
export interface RawArg {
  text: string
  start: number
}

const LENGTH_UNITS = new Set([
  'px',
  'rem',
  'em',
  'ex',
  'ch',
  'lh',
  'rlh',
  'cap',
  'ic',
  'vw',
  'vh',
  'vmin',
  'vmax',
  'vi',
  'vb',
  'svw',
  'svh',
  'lvw',
  'lvh',
  'dvw',
  'dvh',
  'cqw',
  'cqh',
  'cqi',
  'cqb',
  'cqmin',
  'cqmax',
  'cm',
  'mm',
  'q',
  'in',
  'pt',
  'pc',
])

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i

/** Index of the `)` that matches the `(` at `open`, skipping strings. -1 if there is none. */
function closeParen(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]!
    if (c === '"' || c === "'") {
      i++
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return -1
}

/** Split the inside of a call on top-level commas, keeping each part's offset. */
function splitArgs(inner: string, base: number): RawArg[] {
  const args: RawArg[] = []
  let depth = 0
  let from = 0
  const push = (to: number) => {
    const part = inner.slice(from, to)
    const lead = part.length - part.trimStart().length
    args.push({ text: part.trim(), start: base + from + lead })
  }
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (c === '"' || c === "'") {
      i++
      while (i < inner.length && inner[i] !== c) i += inner[i] === '\\' ? 2 : 1
    } else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      push(i)
      from = i + 1
    }
  }
  push(inner.length)
  return args
}

/**
 * Break a declaration value into the atoms the enforcement rules look at. Functions that write colors
 * and `raw()` are single atoms; `url()` and `var()` are skipped; other functions (`calc`, `translate`,
 * gradients) are entered, so a raw length inside `calc()` is still seen.
 */
export interface TokenizeOptions {
  /**
   * Plain CSS: a `var(--name)` that names a design token is a token atom, and `$path` is not one. Given the name of a
   * custom property, return the token's path (known or not), or undefined for a custom property that is not a token.
   */
  resolveVar?: (name: string) => string | undefined
}

export function tokenizeValue(value: string, base: number, options: TokenizeOptions = {}): Atom[] {
  const atoms: Atom[] = []
  const scan = (from: number, to: number) => {
    let i = from
    while (i < to) {
      const c = value[i]!
      if (c === '"' || c === "'") {
        i++
        while (i < to && value[i] !== c) i += value[i] === '\\' ? 2 : 1
        i++
      } else if (c === '$' && !options.resolveVar) {
        const m = /^\$([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)/.exec(value.slice(i, to))
        if (m) {
          atoms.push({ kind: 'token', path: m[1]!, start: base + i, end: base + i + m[0].length })
          i += m[0].length
        } else i++
      } else if (c === '#') {
        const m = /^#[0-9a-fA-F]{3,8}(?![\w-])/.exec(value.slice(i, to))
        if (m) {
          atoms.push({ kind: 'color', text: m[0], start: base + i, end: base + i + m[0].length })
          i += m[0].length
        } else i++
      } else if (/[A-Za-z_]/.test(c) || (c === '-' && /[A-Za-z_-]/.test(value[i + 1] ?? ''))) {
        const m = /^-?-?[A-Za-z_][\w-]*/.exec(value.slice(i, to))!
        const name = m[0]
        const end = i + name.length
        if (value[end] === '(') {
          const close = closeParen(value, end)
          const stop = close === -1 ? to : Math.min(close, to - 1)
          const lower = name.toLowerCase()
          if (lower === 'raw') {
            atoms.push({
              kind: 'raw',
              start: base + i,
              end: base + stop + 1,
              args: splitArgs(value.slice(end + 1, stop), base + end + 1),
            })
          } else if (isColorFunction(lower)) {
            atoms.push({
              kind: 'color',
              text: value.slice(i, stop + 1),
              start: base + i,
              end: base + stop + 1,
            })
          } else if (lower === 'var' && options.resolveVar) {
            const name = /^\s*(--[\w-]+)/.exec(value.slice(end + 1, stop))?.[1]
            const path = name === undefined ? undefined : options.resolveVar(name)
            if (name !== undefined && path !== undefined) {
              atoms.push({
                kind: 'token',
                path,
                cssVar: name,
                start: base + i,
                end: base + stop + 1,
              })
            } else if (name !== undefined) {
              // A custom property that is not a token: its fallback, if any, is still a value to check.
              const comma = value.indexOf(',', end + 1)
              if (comma > -1 && comma < stop) scan(comma + 1, stop)
            }
          } else if (lower !== 'url' && lower !== 'var') {
            scan(end + 1, stop)
          }
          i = stop + 1
        } else {
          atoms.push({ kind: 'ident', text: name, start: base + i, end: base + end })
          i = end
        }
      } else if (/[0-9.+-]/.test(c)) {
        const m = NUMBER.exec(value.slice(i, to))
        if (!m) {
          i++
          continue
        }
        const unit = /^[A-Za-z%]*/.exec(value.slice(i + m[0].length, to))![0]
        const text = m[0] + unit
        const n = parseFloat(m[0])
        const start = base + i
        const end = start + text.length
        const lowerUnit = unit.toLowerCase()
        if (LENGTH_UNITS.has(lowerUnit))
          atoms.push({ kind: 'length', value: n, unit: lowerUnit, text, start, end })
        else if (lowerUnit === 'ms' || lowerUnit === 's')
          atoms.push({ kind: 'duration', value: n, unit: lowerUnit, text, start, end })
        else if (unit === '') atoms.push({ kind: 'number', value: n, text, start, end })
        i += text.length
      } else i++
    }
  }
  scan(0, value.length)
  return atoms
}
