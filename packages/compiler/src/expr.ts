import * as acorn from 'acorn'
import { nearest } from '@tessera/contract'
import type { Reporter } from './diagnostics'
import { READ_SIGNALS, WRITE_SIGNALS, type Binding } from './script'

/** Names a template expression can use without declaring them. */
const GLOBALS = new Set([
  'undefined',
  'NaN',
  'Infinity',
  'Math',
  'JSON',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'Date',
  'Intl',
  'Symbol',
  'Map',
  'Set',
  'Promise',
  'RegExp',
  'Error',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'console',
])

/** What a template reads of the script's bindings, so the compiler can tell what a template does with a read. */
export interface TemplateReads {
  /** Every script binding the template names. */
  names: Set<string>
  /** A read or a write the template uses as a whole (passes it on, calls a function with it), not by its members. */
  bare: Set<string>
  /** For a read or a write: the members the template uses (`data`, `loading`, ...). */
  members: Map<string, Set<string>>
}

export interface ExprScope {
  /** Top-level bindings of the script. */
  bindings: ReadonlyMap<string, Binding>
  /** Names from `each` (a signal in the render function, a plain value in `key`). */
  locals: ReadonlyMap<string, 'signal' | 'plain'>
  /** Filled in as expressions are rewritten. */
  reads?: TemplateReads
}

export interface RewriteResult {
  code: string
  /** Handler only: the whole handler is a plain reference such as `inc` or `form.submit`. */
  simplePath: boolean
}

type Node = acorn.Node & Record<string, any>

interface Edit {
  start: number
  end: number
  text: string
}

/**
 * Parse a template expression (or, for handlers, statements) and rewrite names for the template:
 * signals become `name.value`, unknown top-level values go through `$u()`, and assignments to
 * signals write `.value`. `offset` is where `source` sits in the file, for error positions.
 */
export function rewriteExpression(
  source: string,
  offset: number,
  mode: 'expr' | 'handler',
  scope: ExprScope,
  report: Reporter,
): RewriteResult | undefined {
  let ast: Node
  try {
    if (mode === 'expr') {
      ast = acorn.parseExpressionAt(source, 0, { ecmaVersion: 'latest' }) as Node
      if (source.slice(ast.end).trim() !== '') {
        const extra = source.length - source.slice(ast.end).trimStart().length
        report.error(
          'T4005',
          offset + extra,
          'Unexpected content after the expression. Write one expression, such as {count + 1}.',
        )
        return undefined
      }
    } else {
      ast = acorn.parse(source, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }) as Node
    }
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e
    const pos = (e as SyntaxError & { pos?: number }).pos ?? 0
    report.error(
      'T4005',
      offset + pos,
      `Invalid expression: ${e.message.replace(/\s*\(\d+:\d+\)$/, '')}.`,
    )
    return undefined
  }

  const edits: Edit[] = []
  const scopes: Array<Set<string>> = []
  let failed = false

  const isLocal = (name: string) => scopes.some((s) => s.has(name))
  const fail = (
    code: Parameters<Reporter['error']>[0],
    at: number,
    message: string,
    hint?: string,
  ) => {
    failed = true
    report.error(code, offset + at, message, hint)
  }

  function declared(pattern: Node | null, into: Set<string>): void {
    if (!pattern) return
    switch (pattern.type) {
      case 'Identifier':
        into.add(pattern.name)
        break
      case 'ObjectPattern':
        for (const p of pattern.properties)
          declared(p.type === 'RestElement' ? p.argument : p.value, into)
        break
      case 'ArrayPattern':
        for (const el of pattern.elements) declared(el, into)
        break
      case 'AssignmentPattern':
        declared(pattern.left, into)
        break
      case 'RestElement':
        declared(pattern.argument, into)
        break
    }
  }

  function collectDeclarations(statements: Node[], into: Set<string>): void {
    for (const s of statements) {
      if (s.type === 'VariableDeclaration') for (const d of s.declarations) declared(d.id, into)
      else if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration')
        into.add(s.id.name)
    }
  }

  function reference(node: Node, write: boolean): void {
    const name: string = node.name
    if (isLocal(name)) return
    const local = scope.locals.get(name)
    if (local) {
      if (write) {
        fail(
          'T4011',
          node.start,
          `Cannot assign to "${name}", the loop variable of "each". Update the list instead.`,
        )
      } else if (local === 'signal') {
        edits.push({ start: node.start, end: node.end, text: `${name}.value` })
      }
      return
    }
    const binding = scope.bindings.get(name)
    if (binding) {
      scope.reads?.names.add(name)
      // A read or a write is an object, not a signal: its members are what unwrap.
      if (binding.signal === 'resource' || binding.signal === 'action') {
        if (!write) scope.reads?.bare.add(name)
        return
      }
      if (write) {
        if (
          binding.kind === 'function' ||
          binding.kind === 'class' ||
          binding.kind === 'import' ||
          binding.kind === 'builtin'
        ) {
          fail(
            'T4011',
            node.start,
            `Cannot assign to "${name}", which is ${binding.kind === 'function' ? 'a function' : binding.kind === 'class' ? 'a class' : 'an import'}.`,
          )
        } else if (binding.signal === 'signal' || binding.signal === 'unknown') {
          edits.push({ start: node.start, end: node.end, text: `${name}.value` })
        }
        return
      }
      if (binding.signal === 'signal')
        edits.push({ start: node.start, end: node.end, text: `${name}.value` })
      else if (binding.signal === 'unknown')
        edits.push({ start: node.start, end: node.end, text: `$u(${name})` })
      return
    }
    if (GLOBALS.has(name) || (name === '$event' && mode === 'handler')) return
    const candidates = [...scope.bindings.keys(), ...scope.locals.keys()]
    const close = nearest(name, candidates)
    fail(
      'T4006',
      node.start,
      `Unknown name "${name}" in the template. It is not declared in <script> and is not a loop variable.`,
      close ? `Did you mean "${close}"?` : undefined,
    )
  }

  function visitPattern(pattern: Node | null): void {
    if (!pattern) return
    switch (pattern.type) {
      case 'ObjectPattern':
        for (const p of pattern.properties) {
          if (p.type === 'RestElement') visitPattern(p.argument)
          else {
            if (p.computed) visit(p.key)
            visitPattern(p.value)
          }
        }
        break
      case 'ArrayPattern':
        for (const el of pattern.elements) visitPattern(el)
        break
      case 'AssignmentPattern':
        visitPattern(pattern.left)
        visit(pattern.right)
        break
      case 'RestElement':
        visitPattern(pattern.argument)
        break
    }
  }

  function withScope(names: Set<string>, run: () => void): void {
    scopes.push(names)
    run()
    scopes.pop()
  }

  function memberKey(node: Node): string | undefined {
    if (!node.computed && node.property.type === 'Identifier') return node.property.name
    if (
      node.computed &&
      node.property.type === 'Literal' &&
      typeof node.property.value === 'string'
    )
      return node.property.value
    return undefined
  }

  function visit(node: Node | null): void {
    if (!node || failed) return
    switch (node.type) {
      case 'Identifier':
        reference(node, false)
        return
      case 'MemberExpression': {
        if (node.object.type === 'Identifier' && !isLocal(node.object.name)) {
          const binding = scope.bindings.get(node.object.name)
          const key = memberKey(node)
          if (
            binding &&
            !scope.locals.has(node.object.name) &&
            (binding.signal === 'resource' || binding.signal === 'action')
          ) {
            const reads = scope.reads
            if (key === undefined) {
              reads?.names.add(node.object.name)
              reads?.bare.add(node.object.name)
              visit(node.property)
              return
            }
            reads?.names.add(node.object.name)
            const seen = reads?.members.get(node.object.name) ?? new Set<string>()
            seen.add(key)
            reads?.members.set(node.object.name, seen)
            // `tasks.data` is a signal: read its value. `tasks.refresh` is a function: leave it.
            const signals = binding.signal === 'resource' ? READ_SIGNALS : WRITE_SIGNALS
            if (signals.has(key))
              edits.push({
                start: node.start,
                end: node.end,
                text: `${node.object.name}.${key}.value`,
              })
            return
          }
          if (binding && !scope.locals.has(node.object.name) && key !== undefined) {
            const holdsSignal = binding.signal === 'props' || binding.nestedSignals?.has(key)
            if (holdsSignal) {
              fail(
                'T4012',
                node.start,
                `Signal "${node.object.name}.${key}" is nested inside an object and will not unwrap in the template. Destructure it to a top-level binding or read .value.`,
              )
              return
            }
          }
        }
        visit(node.object)
        if (node.computed) visit(node.property)
        return
      }
      case 'Property':
        if (node.shorthand && node.value.type === 'Identifier') {
          const before = edits.length
          reference(node.value, false)
          if (edits.length > before) {
            const edit = edits[edits.length - 1]!
            edits[edits.length - 1] = {
              start: node.start,
              end: node.end,
              text: `${node.value.name}: ${edit.text}`,
            }
          }
          return
        }
        if (node.computed) visit(node.key)
        visit(node.value)
        return
      case 'AssignmentExpression':
        if (node.left.type === 'Identifier') reference(node.left, true)
        else if (node.left.type === 'MemberExpression') visit(node.left)
        else visitPattern(node.left)
        visit(node.right)
        return
      case 'UpdateExpression':
        if (node.argument.type === 'Identifier') reference(node.argument, true)
        else visit(node.argument)
        return
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
      case 'FunctionDeclaration': {
        const names = new Set<string>()
        if (node.id && node.type === 'FunctionExpression') names.add(node.id.name)
        for (const p of node.params) declared(p, names)
        if (node.body.type === 'BlockStatement') collectDeclarations(node.body.body, names)
        withScope(names, () => {
          for (const p of node.params) visitPattern(p)
          visit(node.body)
        })
        return
      }
      case 'BlockStatement': {
        const names = new Set<string>()
        collectDeclarations(node.body, names)
        withScope(names, () => node.body.forEach(visit))
        return
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const names = new Set<string>()
        const init = node.init ?? node.left
        if (init?.type === 'VariableDeclaration')
          for (const d of init.declarations) declared(d.id, names)
        withScope(names, () => {
          for (const key of ['init', 'left', 'right', 'test', 'update', 'body']) visit(node[key])
        })
        return
      }
      case 'CatchClause': {
        const names = new Set<string>()
        declared(node.param, names)
        withScope(names, () => visit(node.body))
        return
      }
      case 'VariableDeclaration':
        for (const d of node.declarations) {
          visitPattern(d.id)
          visit(d.init)
        }
        return
      case 'LabeledStatement':
        visit(node.body)
        return
      case 'BreakStatement':
      case 'ContinueStatement':
        return
      case 'Program': {
        const names = new Set<string>()
        collectDeclarations(node.body, names)
        withScope(names, () => node.body.forEach(visit))
        return
      }
      case 'ClassDeclaration':
      case 'ClassExpression':
        visit(node.superClass)
        for (const member of node.body.body) {
          if (member.computed) visit(member.key)
          visit(member.value)
        }
        return
      default:
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'start' || key === 'end') continue
          const value = node[key]
          if (Array.isArray(value))
            value.forEach((v) => v && typeof v.type === 'string' && visit(v))
          else if (value && typeof value.type === 'string') visit(value)
        }
    }
  }

  visit(ast)
  if (failed) return undefined

  let code = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end)
  }

  let simplePath = false
  if (mode === 'handler') {
    const body = ast.body as Node[]
    const only =
      body.length === 1 && body[0]!.type === 'ExpressionStatement' ? body[0]!.expression : undefined
    const isPath = (n: Node): boolean =>
      n.type === 'Identifier' || (n.type === 'MemberExpression' && !n.computed && isPath(n.object))
    simplePath = only !== undefined && isPath(only)
  }
  return { code: code.trim(), simplePath }
}
