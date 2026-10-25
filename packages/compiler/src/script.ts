/**
 * A light scanner for the `<script>` block. It does not parse TypeScript. It tokenizes the code and reads
 * only what the compiler needs: top-level bindings and whether each holds a signal, imports to hoist,
 * `emit('name')` calls, and impure `derived()` callbacks. Type stripping is left to the host (Vite's esbuild).
 */

export interface Token {
  type: 'id' | 'num' | 'str' | 'tpl' | 're' | 'p'
  value: string
  start: number
  end: number
  /** A line break comes before this token. */
  nl: boolean
}

const PUNCTUATORS = [
  '>>>=',
  '...',
  '===',
  '!==',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '**',
  '<<',
  '>>',
]

export function tokenize(code: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let nl = false

  const push = (type: Token['type'], start: number, end: number) => {
    tokens.push({ type, value: code.slice(start, end), start, end, nl })
    nl = false
  }

  while (i < code.length) {
    const c = code[i]!
    if (c === '\n') {
      nl = true
      i++
    } else if (/\s/.test(c)) {
      i++
    } else if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++
    } else if (c === '/' && code[i + 1] === '*') {
      const close = code.indexOf('*/', i + 2)
      const end = close === -1 ? code.length : close + 2
      if (code.slice(i, end).includes('\n')) nl = true
      i = end
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
      push('str', i, Math.min(j + 1, code.length))
      i = Math.min(j + 1, code.length)
    } else if (c === '`') {
      const end = skipTemplate(code, i)
      push('tpl', i, end)
      i = end
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] ?? ''))) {
      const m =
        /^(0[xXbBoO][0-9a-fA-F_]+|[0-9][0-9_]*\.?[0-9_]*(?:[eE][+-]?[0-9]+)?n?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)/.exec(
          code.slice(i),
        )!
      push('num', i, i + m[0].length)
      i += m[0].length
    } else if (/[A-Za-z_$#]/.test(c)) {
      let j = i + 1
      while (j < code.length && /[\w$]/.test(code[j]!)) j++
      push('id', i, j)
      i = j
    } else if (c === '/' && regexAllowed(tokens)) {
      let j = i + 1
      let inClass = false
      while (j < code.length && code[j] !== '\n') {
        if (code[j] === '\\') j++
        else if (code[j] === '[') inClass = true
        else if (code[j] === ']') inClass = false
        else if (code[j] === '/' && !inClass) break
        j++
      }
      j++
      while (j < code.length && /[a-z]/.test(code[j]!)) j++
      push('re', i, j)
      i = j
    } else {
      const p = PUNCTUATORS.find((candidate) => code.startsWith(candidate, i)) ?? c
      push('p', i, i + p.length)
      i += p.length
    }
  }
  return tokens
}

function regexAllowed(tokens: Token[]): boolean {
  const prev = tokens[tokens.length - 1]
  if (!prev) return true
  if (prev.type === 'num' || prev.type === 'str' || prev.type === 'tpl' || prev.type === 're')
    return false
  if (prev.type === 'id')
    return [
      'return',
      'typeof',
      'case',
      'do',
      'else',
      'in',
      'of',
      'void',
      'delete',
      'throw',
      'new',
      'yield',
      'await',
    ].includes(prev.value)
  return ![')', ']', '}'].includes(prev.value)
}

function skipTemplate(code: string, i: number): number {
  for (let j = i + 1; j < code.length; j++) {
    const c = code[j]
    if (c === '\\') j++
    else if (c === '`') return j + 1
    else if (c === '$' && code[j + 1] === '{') {
      let depth = 1
      j += 2
      while (j < code.length && depth > 0) {
        if (code[j] === '{') depth++
        else if (code[j] === '}') depth--
        else if (code[j] === '`') j = skipTemplate(code, j) - 1
        else if (code[j] === '"' || code[j] === "'") {
          const q = code[j]
          j++
          while (j < code.length && code[j] !== q) j += code[j] === '\\' ? 2 : 1
        }
        j++
      }
      j--
    }
  }
  return code.length
}

export type SignalKind =
  'signal' | 'props' | 'plain' | 'callable' | 'unknown' | 'resource' | 'action'

export interface Binding {
  name: string
  kind: 'const' | 'let' | 'var' | 'function' | 'class' | 'import' | 'builtin'
  /**
   * How the template reads it. `signal`: a signal made by state() or derived(), read as `.value`.
   * `props`: the object returned by props(), whose members are signals (not unwrapped when reached through it).
   * `plain`: a literal or object that is not a signal. `callable`: a function or class.
   * `unknown`: anything else, unwrapped at runtime.
   * `resource`: what `get()` returns, whose `data`, `error`, `loading` and `refreshing` are signals.
   * `action`: what `post()`, `put()`, `patch()` and `del()` return, a function whose `pending`, `error` and `data` are signals.
   */
  signal: SignalKind
  /** For an object literal holding signals: the keys that hold them. */
  nestedSignals?: Set<string>
  start: number
}

export interface ImportStatement {
  start: number
  end: number
  names: string[]
  typeOnly: boolean
  /** `{ local, source, default? }` for each binding, for resolving components by import. */
  entries: Array<{ local: string; imported: string; source: string }>
}

export interface ScriptIssue {
  offset: number
  message: string
}

export interface ScriptAnalysis {
  imports: ImportStatement[]
  bindings: Map<string, Binding>
  /** Every identifier token, to decide which framework APIs to import. */
  identifiers: Set<string>
  /** Where each identifier is first used as a name (not as a property after a dot). */
  firstUse: Map<string, number>
  /** Offsets of identifiers that are called, such as `state(0)`. */
  calls: Map<string, number>
  /** Offsets and literal names of `emit('name')` calls. */
  emits: Array<{ name: string; offset: number }>
  impure: ScriptIssue[]
  /** `name.get(`, `name.post(` and the like, with `name` not after a dot: possibly a call on an api. */
  apiCalls: Array<{ name: string; verb: string; offset: number }>
  /** Each `const x = get(...)` and the like that was kept as a read or a write. */
  dataCalls: DataCall[]
}

/** A call to `get`, `post`, `put`, `patch` or `del` (on the shared api or on a named one) whose result is kept. */
export interface DataCall {
  kind: 'resource' | 'action'
  verb: string
  /** The api it is made on, if it is a named one: `github` in `github.get('/users')`. */
  api?: string
  /** How to show it in a message: `github.get('/users')`. */
  call: string
  /** Where the call starts in the script. */
  offset: number
  /** The name it was kept as, when it was not destructured. */
  binding?: string
  /** For a destructured one: each member taken, and the name it is taken as. */
  members?: Array<{ key: string; local: string }>
}

const isId = (t: Token | undefined, value?: string) =>
  t?.type === 'id' && (value === undefined || t.value === value)
const isP = (t: Token | undefined, value: string) => t?.type === 'p' && t.value === value

const OPEN = new Set(['(', '[', '{'])
const CLOSE = new Set([')', ']', '}'])
const ASSIGN = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '<<=',
  '>>=',
  '>>>=',
  '&=',
  '|=',
  '^=',
  '&&=',
  '||=',
  '??=',
])
const BLOCKISH = new Set([
  'function',
  'class',
  'if',
  'for',
  'while',
  'try',
  'switch',
  'interface',
  'enum',
  'namespace',
  'do',
])
const SIGNAL_MAKERS = new Set(['state', 'derived', 'constant'])
const DATA_VERBS = new Set(['get', 'post', 'put', 'patch', 'del'])
/** The members of a read and of a write that are signals, read as `.value` in a template. */
export const READ_SIGNALS: ReadonlySet<string> = new Set(['data', 'error', 'loading', 'refreshing'])
export const WRITE_SIGNALS: ReadonlySet<string> = new Set(['pending', 'error', 'data'])

/**
 * Is `tokens[from..to)` one call of `get`, `post`... (or of one of those on a named api), with nothing after it? A type
 * argument (`get<Task[]>('/tasks')`) is allowed. Whether the name is really Tessera's, and not one the script defines,
 * is decided afterwards, when every binding is known.
 */
function dataCall(
  tokens: Token[],
  from: number,
  to: number,
  apis: ReadonlySet<string> | undefined,
): DataCall | undefined {
  let j = from
  let api: string | undefined
  if (
    isId(tokens[j]) &&
    isP(tokens[j + 1], '.') &&
    isId(tokens[j + 2]) &&
    DATA_VERBS.has(tokens[j + 2]!.value) &&
    apis?.has(tokens[j]!.value)
  ) {
    api = tokens[j]!.value
    j += 2
  } else if (!(isId(tokens[j]) && DATA_VERBS.has(tokens[j]!.value))) return undefined
  const verb = tokens[j]!.value
  j++
  if (isP(tokens[j], '<')) {
    let depth = 0
    for (; j < to; j++) {
      const t = tokens[j]!
      if (isP(t, '<')) depth++
      else if (isP(t, '>')) depth--
      else if (isP(t, '>>')) depth -= 2
      if (depth <= 0) {
        j++
        break
      }
    }
  }
  if (!isP(tokens[j], '(')) return undefined
  const close = matching(tokens, j)
  if (close + 1 < to) return undefined
  const first = tokens[j + 1]
  const argument =
    first?.type === 'str' && (isP(tokens[j + 2], ',') || isP(tokens[j + 2], ')'))
      ? first.value
      : '…'
  return {
    kind: verb === 'get' ? 'resource' : 'action',
    verb,
    ...(api ? { api } : {}),
    call: `${api ? `${api}.` : ''}${verb}(${argument})`,
    offset: tokens[from]!.start,
  }
}

/** The members an object pattern takes, and the names it takes them as: `{ data: tasks, loading }`. */
function objectPatternMembers(
  tokens: Token[],
  from: number,
  to: number,
): Array<{ key: string; local: string }> {
  const out: Array<{ key: string; local: string }> = []
  const close = to - 1
  let depth = 0
  let entry = from + 1
  for (let j = from + 1; j <= close; j++) {
    const t = tokens[j]!
    if (t.type === 'p' && OPEN.has(t.value)) depth++
    else if (t.type === 'p' && CLOSE.has(t.value) && j < close) depth--
    else if (depth === 0 && (j === close || isP(t, ','))) {
      const key = tokens[entry]
      if (key && (isId(key) || key.type === 'str') && !isP(tokens[entry - 1], '...')) {
        const name = key.type === 'str' ? key.value.slice(1, -1) : key.value
        if (isP(tokens[entry + 1], ':')) {
          if (isId(tokens[entry + 2])) out.push({ key: name, local: tokens[entry + 2]!.value })
        } else out.push({ key: name, local: name })
      }
      entry = j + 1
    }
  }
  return out
}

/** A line break does not end a statement when the code obviously continues. */
function continues(prev: Token, next: Token): boolean {
  if (
    next.type === 'id' &&
    ['else', 'catch', 'finally', 'in', 'of', 'instanceof', 'as', 'satisfies'].includes(next.value)
  )
    return true
  if (
    next.type === 'p' &&
    [
      '.',
      '?.',
      ',',
      ')',
      ']',
      '}',
      '?',
      ':',
      '=>',
      '&&',
      '||',
      '??',
      '+',
      '*',
      '/',
      '%',
      '**',
      '==',
      '===',
      '!=',
      '!==',
      '<',
      '>',
      '<=',
      '>=',
      '&',
      '|',
      '^',
      '=',
    ].includes(next.value)
  )
    return true
  if (prev.type === 'p' && !['++', '--', ')', ']', '}'].includes(prev.value)) return true
  if (
    prev.type === 'id' &&
    [
      'new',
      'typeof',
      'void',
      'delete',
      'await',
      'yield',
      'extends',
      'implements',
      'in',
      'of',
      'instanceof',
      'as',
      'extends',
    ].includes(prev.value)
  )
    return true
  return false
}

function statementEnd(tokens: Token[], from: number): number {
  let first = tokens[from]!
  let k = from
  while (
    isId(first, 'export') ||
    isId(first, 'default') ||
    isId(first, 'async') ||
    isId(first, 'declare')
  ) {
    first = tokens[++k] ?? first
  }
  const blockish = BLOCKISH.has(first.value) || isP(first, '{')
  let depth = 0
  for (let j = from; j < tokens.length; j++) {
    const t = tokens[j]!
    if (t.type === 'p' && OPEN.has(t.value)) depth++
    else if (t.type === 'p' && CLOSE.has(t.value)) depth--
    if (depth !== 0) continue
    if (isP(t, ';')) return j + 1
    const next = tokens[j + 1]
    if (next && isP(t, '}') && blockish && !continues(t, next)) return j + 1
    if (next && next.nl && !continues(t, next)) return j + 1
  }
  return tokens.length
}

/** Matching close index for the bracket at `open`. */
function matching(tokens: Token[], open: number): number {
  let depth = 0
  for (let j = open; j < tokens.length; j++) {
    const t = tokens[j]!
    if (t.type !== 'p') continue
    if (OPEN.has(t.value)) depth++
    else if (CLOSE.has(t.value) && --depth === 0) return j
  }
  return tokens.length - 1
}

interface PatternName {
  name: string
  start: number
}

/** Names bound by a pattern in tokens[from, to). */
function patternNames(tokens: Token[], from: number, to: number): PatternName[] {
  const first = tokens[from]
  if (!first || from >= to) return []
  if (first.type === 'id') return [{ name: first.value, start: first.start }]
  if (!isP(first, '{') && !isP(first, '[')) return []

  const names: PatternName[] = []
  const close = matching(tokens, from)
  let segStart = from + 1
  const flush = (end: number) => {
    let s = segStart
    if (s >= end) return
    if (isP(tokens[s], '...')) s++
    const isObject = isP(first, '{')
    if (isObject && tokens[s]?.type !== 'p') {
      // `key: target`, `key = default`, or `key`.
      if (isP(tokens[s + 1], ':')) names.push(...patternNames(tokens, s + 2, end))
      else names.push({ name: tokens[s]!.value, start: tokens[s]!.start })
    } else if (isObject && isP(tokens[s], '[')) {
      // computed key; skip
    } else {
      names.push(...patternNames(tokens, s, end))
    }
  }
  let depth = 0
  for (let j = from + 1; j < close; j++) {
    const t = tokens[j]!
    if (t.type === 'p' && OPEN.has(t.value)) depth++
    else if (t.type === 'p' && CLOSE.has(t.value)) depth--
    else if (depth === 0 && isP(t, ',')) {
      flush(j)
      segStart = j + 1
    }
  }
  flush(close)
  return names
}

function patternEnd(tokens: Token[], from: number): number {
  const t = tokens[from]
  if (t && (isP(t, '{') || isP(t, '['))) return matching(tokens, from) + 1
  return from + 1
}

function classifyInit(
  tokens: Token[],
  from: number,
  to: number,
): { signal: SignalKind; nested?: Set<string> } {
  const first = tokens[from]
  if (!first || from >= to) return { signal: 'unknown' }

  if (
    isId(first) &&
    SIGNAL_MAKERS.has(first.value) &&
    (isP(tokens[from + 1], '(') || isP(tokens[from + 1], '<'))
  ) {
    return { signal: 'signal' }
  }
  if (isId(first, 'props') && (isP(tokens[from + 1], '(') || isP(tokens[from + 1], '<')))
    return { signal: 'props' }

  // Arrow function or function expression at the top level of the initializer.
  let depth = 0
  for (let j = from; j < to; j++) {
    const t = tokens[j]!
    if (t.type === 'p' && OPEN.has(t.value)) depth++
    else if (t.type === 'p' && CLOSE.has(t.value)) depth--
    else if (depth === 0 && isP(t, '=>')) return { signal: 'callable' }
  }
  if (
    isId(first, 'function') ||
    (isId(first, 'async') && isId(tokens[from + 1], 'function')) ||
    isId(first, 'class')
  ) {
    return { signal: 'callable' }
  }

  if (isP(first, '{')) {
    const nested = new Set<string>()
    const close = matching(tokens, from)
    let depth2 = 0
    for (let j = from + 1; j < close; j++) {
      const t = tokens[j]!
      if (t.type === 'p' && OPEN.has(t.value)) depth2++
      else if (t.type === 'p' && CLOSE.has(t.value)) depth2--
      else if (
        depth2 === 0 &&
        (t.type === 'id' || t.type === 'str') &&
        isP(tokens[j + 1], ':') &&
        isId(tokens[j + 2]) &&
        SIGNAL_MAKERS.has(tokens[j + 2]!.value) &&
        (isP(tokens[j + 3], '(') || isP(tokens[j + 3], '<'))
      ) {
        nested.add(t.type === 'str' ? t.value.slice(1, -1) : t.value)
      }
    }
    return { signal: 'plain', nested: nested.size ? nested : undefined }
  }
  if (
    ['num', 'str', 'tpl'].includes(first.type) ||
    isP(first, '[') ||
    isId(first, 'true') ||
    isId(first, 'false') ||
    isId(first, 'null') ||
    isId(first, 'undefined')
  ) {
    return { signal: 'plain' }
  }
  return { signal: 'unknown' }
}

function parseImport(tokens: Token[], from: number, to: number): ImportStatement {
  const stmt: ImportStatement = {
    start: tokens[from]!.start,
    end: tokens[to - 1]!.end,
    names: [],
    typeOnly: false,
    entries: [],
  }
  let j = from + 1
  if (isId(tokens[j], 'type') && !isId(tokens[j + 1], 'from') && !isP(tokens[j + 1], ',')) {
    stmt.typeOnly = true
    j++
  }
  const sourceToken = tokens.slice(from, to).findLast((t) => t.type === 'str')
  const source = sourceToken ? sourceToken.value.slice(1, -1) : ''
  const add = (local: string, imported: string) => {
    stmt.names.push(local)
    stmt.entries.push({ local, imported, source })
  }
  if (isId(tokens[j]) && !isId(tokens[j], 'from')) {
    add(tokens[j]!.value, 'default')
    j++
    if (isP(tokens[j], ',')) j++
  }
  if (isP(tokens[j], '*') && isId(tokens[j + 1], 'as') && isId(tokens[j + 2])) {
    add(tokens[j + 2]!.value, '*')
  } else if (isP(tokens[j], '{')) {
    const close = matching(tokens, j)
    for (let k = j + 1; k < close; k++) {
      let t = tokens[k]!
      if (
        isId(t, 'type') &&
        isId(tokens[k + 1]) &&
        !isId(tokens[k + 1], 'as') &&
        !isP(tokens[k + 1], ',')
      ) {
        k++
        continue
      }
      if (!isId(t)) continue
      let local = t.value
      const imported = t.value
      if (isId(tokens[k + 1], 'as') && isId(tokens[k + 2])) {
        t = tokens[k + 2]!
        local = t.value
        k += 2
      }
      add(local, imported)
    }
  }
  return stmt
}

export function analyzeScript(
  code: string,
  options: { apis?: ReadonlySet<string> } = {},
): ScriptAnalysis {
  const tokens = tokenize(code)
  const result: ScriptAnalysis = {
    imports: [],
    bindings: new Map(),
    identifiers: new Set(),
    firstUse: new Map(),
    calls: new Map(),
    emits: [],
    impure: [],
    apiCalls: [],
    dataCalls: [],
  }

  for (const [i, t] of tokens.entries()) {
    if (t.type !== 'id') continue
    result.identifiers.add(t.value)
    const afterDot = isP(tokens[i - 1], '.') || isP(tokens[i - 1], '?.')
    if (afterDot) continue
    if (!result.firstUse.has(t.value)) result.firstUse.set(t.value, t.start)
    if (isP(tokens[i + 1], '(') && !result.calls.has(t.value)) result.calls.set(t.value, t.start)
    if (
      isP(tokens[i + 1], '.') &&
      isId(tokens[i + 2]) &&
      DATA_VERBS.has(tokens[i + 2]!.value) &&
      (isP(tokens[i + 3], '(') || isP(tokens[i + 3], '<'))
    )
      result.apiCalls.push({ name: t.value, verb: tokens[i + 2]!.value, offset: t.start })
    if (t.value === 'emit' && isP(tokens[i + 1], '(')) {
      const arg = tokens[i + 2]
      if (arg?.type === 'str')
        result.emits.push({ name: arg.value.slice(1, -1), offset: arg.start })
    }
    if (t.value === 'derived' && isP(tokens[i + 1], '(')) {
      const close = matching(tokens, i + 1)
      for (let j = i + 2; j < close; j++) {
        const u = tokens[j]!
        if (isId(u, 'emit') && isP(tokens[j + 1], '(') && !isP(tokens[j - 1], '.')) {
          result.impure.push({ offset: u.start, message: 'it calls emit()' })
        }
        if (isId(u, 'value') && isP(tokens[j - 1], '.')) {
          let s = j - 1
          while (isP(tokens[s], '.') && isId(tokens[s - 1])) s -= 2
          const target = code.slice(tokens[s + 1]!.start, u.end)
          const next = tokens[j + 1]
          const prev = tokens[s]
          if (
            (next?.type === 'p' &&
              (ASSIGN.has(next.value) || next.value === '++' || next.value === '--')) ||
            isP(prev, '++') ||
            isP(prev, '--')
          ) {
            result.impure.push({ offset: tokens[s + 1]!.start, message: `it assigns ${target}` })
          }
        }
      }
    }
  }

  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]!
    if (isP(t, ';')) {
      i++
      continue
    }
    let end = statementEnd(tokens, i)

    if (isId(t, 'import') && !isP(tokens[i + 1], '(') && !isP(tokens[i + 1], '.')) {
      const stmt = parseImport(tokens, i, end)
      result.imports.push(stmt)
      if (!stmt.typeOnly) {
        for (const name of stmt.names) {
          result.bindings.set(name, { name, kind: 'import', signal: 'unknown', start: stmt.start })
        }
      }
      i = end
      continue
    }

    let k = i
    if (isId(tokens[k], 'export')) k++
    if (isId(tokens[k], 'declare')) {
      i = end
      continue
    }

    if (isId(tokens[k], 'const') || isId(tokens[k], 'let') || isId(tokens[k], 'var')) {
      const kind = tokens[k]!.value as 'const' | 'let' | 'var'
      let j = k + 1
      while (j < end) {
        const patternStart = j
        const pEnd = patternEnd(tokens, j)
        const names = patternNames(tokens, patternStart, pEnd)
        j = pEnd
        if (isP(tokens[j], '!')) j++
        if (isP(tokens[j], ':')) {
          // Skip the type annotation up to `=` or a separator.
          let depth = 0
          while (j < end) {
            const u = tokens[j]!
            if (u.type === 'p' && (OPEN.has(u.value) || u.value === '<')) depth++
            else if (u.type === 'p' && (CLOSE.has(u.value) || u.value === '>')) depth--
            else if (u.type === 'p' && u.value === '>>') depth -= 2
            else if (depth <= 0 && (isP(u, '=') || isP(u, ',') || isP(u, ';'))) break
            j++
          }
        }
        let initFrom = j
        let initTo = j
        if (isP(tokens[j], '=')) {
          initFrom = j + 1
          initTo = initFrom
          let depth = 0
          while (initTo < end) {
            const u = tokens[initTo]!
            if (u.type === 'p' && OPEN.has(u.value)) depth++
            else if (u.type === 'p' && CLOSE.has(u.value)) depth--
            else if (
              depth === 0 &&
              isP(u, ',') &&
              isId(tokens[initTo + 1]) &&
              (isP(tokens[initTo + 2], '=') || isP(tokens[initTo + 2], ':'))
            )
              break
            else if (depth === 0 && isP(u, ';')) break
            initTo++
          }
          j = initTo
        }
        const isDestructured = isP(tokens[patternStart], '{') || isP(tokens[patternStart], '[')
        const info = classifyInit(tokens, initFrom, initTo)
        // A read or a write kept as it is, or taken apart by name: which names are signals depends on the member.
        const data = dataCall(tokens, initFrom, initTo, options.apis)
        const members =
          data && isP(tokens[patternStart], '{')
            ? objectPatternMembers(tokens, patternStart, pEnd)
            : undefined
        if (data) {
          result.dataCalls.push({
            ...data,
            ...(!isDestructured && names[0] ? { binding: names[0].name } : {}),
            ...(members ? { members } : {}),
          })
        }
        const signalMembers = data?.kind === 'resource' ? READ_SIGNALS : WRITE_SIGNALS
        for (const { name, start } of names) {
          let signal: SignalKind = info.signal
          if (isDestructured) signal = info.signal === 'props' ? 'signal' : 'unknown'
          else if (info.signal === 'props') signal = 'props'
          if (data) {
            if (!isDestructured) signal = data.kind
            else {
              const member = members?.find((m) => m.local === name)
              signal = member ? (signalMembers.has(member.key) ? 'signal' : 'callable') : 'unknown'
            }
          }
          result.bindings.set(name, {
            name,
            kind,
            signal,
            ...(info.nested && !isDestructured ? { nestedSignals: info.nested } : {}),
            start,
          })
        }
        if (isP(tokens[j], ',')) j++
        else break
      }
      i = end
      continue
    }

    if (isId(tokens[k], 'async') && isId(tokens[k + 1], 'function')) k++
    if (isId(tokens[k], 'function') || isId(tokens[k], 'class')) {
      let n = k + 1
      if (isP(tokens[n], '*')) n++
      if (isId(tokens[n])) {
        const kind = tokens[k]!.value as 'function' | 'class'
        result.bindings.set(tokens[n]!.value, {
          name: tokens[n]!.value,
          kind,
          signal: 'callable',
          start: tokens[n]!.start,
        })
      }
    }
    if (end <= i) end = i + 1
    i = end
  }
  // A `get` (or a named api) that the script defines itself is not Tessera's: what it returns is not a read.
  const mine = (call: DataCall) => result.bindings.has(call.api ?? call.verb)
  result.dataCalls = result.dataCalls.filter((call) => {
    if (!mine(call)) return true
    for (const binding of result.bindings.values()) {
      if (binding.signal === 'resource' || binding.signal === 'action') {
        if (call.binding === binding.name) binding.signal = 'unknown'
      } else if (call.members?.some((m) => m.local === binding.name)) binding.signal = 'unknown'
    }
    return false
  })
  return result
}
