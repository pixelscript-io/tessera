import {
  compile,
  formatDiagnostic,
  kindFromPath,
  parseSfc,
  type CompileOptions,
  type ComponentResolver,
} from '@tessera/compiler'
import type { CompilerDiagnostic } from '@tessera/compiler'

export interface ServiceOptions {
  /** Path of the document. Pages and layouts are recognised by their folder. */
  file: string
  /** Components the document imports explicitly, with their contracts. */
  components?: ComponentResolver
  /** Every component in the project, so tags resolve without imports. */
  registry?: CompileOptions['registry']
  /** The apis of the project (`app/apis`), so a script can name one without importing it. */
  apis?: CompileOptions['apis']
  /** Absolute path of the document, to compute imports relative to it. */
  path?: string
  autoImports?: boolean
  /** Design tokens, to check `<style>`. A list of dotted paths only checks that each `$token` exists. */
  tokens?: CompileOptions['tokens']
  contract?: CompileOptions['contract']
  behaviors?: CompileOptions['behaviors']
}

export interface EditorDiagnostic {
  severity: 'error' | 'warning'
  code: string
  /** The message and its suggestion: the same lines the CLI prints between its header and its `tessera explain` line. */
  message: string
  /** The full CLI rendering of this diagnostic. */
  formatted: string
  /** 0-based positions, as editors expect. */
  line: number
  column: number
  endLine: number
  endColumn: number
}

/**
 * The compiler's diagnostics for one document, shaped for an editor. This is a thin layer on `compile()`:
 * every message is the one the CLI and the Vite plugin print.
 */
export function getDiagnostics(source: string, options: ServiceOptions): EditorDiagnostic[] {
  const result = compile(source, {
    file: options.file,
    kind: kindFromPath(options.file),
    components: options.components,
    registry: options.registry,
    apis: options.apis,
    path: options.path,
    autoImports: options.autoImports,
    tokens: options.tokens,
    contract: options.contract,
    behaviors: options.behaviors,
  })
  const lines = source.split('\n')
  return result.diagnostics.map((d) => toEditorDiagnostic(d, lines))
}

function toEditorDiagnostic(d: CompilerDiagnostic, lines: string[]): EditorDiagnostic {
  const line = d.line - 1
  const column = d.column - 1
  const text = lines[line] ?? ''
  return {
    severity: d.severity,
    code: d.code,
    message: d.hint ? `${d.message}\n${d.hint}` : d.message,
    formatted: formatDiagnostic(d),
    line,
    column,
    endLine: line,
    endColumn: column + highlightLength(text.slice(column)),
  }
}

/** How much of the line to underline: the word, quoted string or tag at the position. */
function highlightLength(rest: string): number {
  const match =
    /^"[^"]*"/.exec(rest) ??
    /^'[^']*'/.exec(rest) ??
    /^[$@:]?[\w$][\w$.:@-]*/.exec(rest) ??
    /^<\/?[\w.-]*/.exec(rest)
  return Math.max(1, match?.[0].length ?? 1)
}

/** Offsets of a block's content in the file, or undefined if the file has no such block. */
export function blockRange(
  source: string,
  name: 'contract' | 'script' | 'template' | 'style' | 'page',
): { start: number; end: number } | undefined {
  // Parse quietly: editors call this on half-typed files.
  const noop = { error() {}, warn() {}, diagnostics: [], hasErrors: false } as never
  const block = parseSfc(source, noop).get(name)
  return block
    ? { start: block.contentStart, end: block.contentStart + block.content.length }
    : undefined
}
