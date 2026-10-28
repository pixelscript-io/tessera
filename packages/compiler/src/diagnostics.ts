import { lineTable } from '@tessera/contract'

export const COMPILER_CODES = {
  T2101: 'Raw color in a style',
  T2102: 'Raw value off the token scale',
  T2103: 'Token of the wrong type for the property',
  T2104: 'Unknown token',
  T2105: 'Primitive token used in a component',
  T2106: 'Invalid style syntax',
  T2107: 'Text contrast too low',
  T2108: 'Invalid raw() escape',
  T2109: 'Contrast pairing cannot be checked',
  T2110: 'raw() escape expired',
  T2111: 'raw() escape used',
  T2112: 'Invalid severity exemption',
  T2113: 'Deprecated token used',
  T2114: 'Unknown variant value in a selector',
  T2115: 'Invalid design systems in the config',
  T4001: 'Invalid block',
  T4002: 'Missing template',
  T4003: 'Template syntax error',
  T4004: 'Template root error',
  T4005: 'Invalid expression',
  T4006: 'Unknown identifier in template',
  T4007: 'Unknown component',
  T4008: 'Unknown variant value',
  T4009: 'Unknown slot',
  T4010: 'Unknown event',
  T4011: 'Directive misuse',
  T4012: 'Signal will not unwrap',
  T4013: 'Contract not allowed or required here',
  T4015: 'Behavior event used without its behavior',
  T5001: 'Duplicate component name',
  T5002: 'Auto-import used outside a .tess file',
  T5003: 'Script API not imported with auto-imports off',
  T5004: 'Unknown API',
  T5005: 'Invalid API file name',
  T5006: 'Call to an endpoint the API description does not have',
  T5007: 'Parameter the endpoint does not take',
  T5008: 'Field the answer does not have',
  T5009: 'Invalid API description',
  T5010: 'Invalid name for shared state',
  T5011: 'Shared state changed from outside its file',
  T5012: 'Member that shared state does not have',
  T6001: 'Route conflict',
  T6002: 'Invalid page file name',
  T6003: 'Unknown layout',
  T6004: 'Unknown route in a link',
  T6005: 'Invalid <page> block',
  T6006: 'Layout has no slot',
  W4101: 'derived() is not pure',
  W4102: 'Dynamic class names are not scoped',
  W4103: 'Deprecated component used',
  W4104: 'Deprecated variant value used',
  W4105: 'Data that can fail is shown without loading or error',
} as const

export type CompilerCode = keyof typeof COMPILER_CODES

export interface CompilerDiagnostic {
  code: string
  severity: 'error' | 'warning'
  message: string
  hint?: string
  file: string
  line: number
  column: number
  /** A change that resolves it without altering what renders by default. Offsets are in the file. */
  fix?: { start: number; end: number; text: string }
}

/** Collects diagnostics for one file, converting source offsets to line and column. */
export class Reporter {
  readonly diagnostics: CompilerDiagnostic[] = []
  private readonly position: (offset: number) => { line: number; column: number }

  constructor(
    readonly file: string,
    source: string,
  ) {
    this.position = lineTable(source)
  }

  error(code: CompilerCode, offset: number, message: string, hint?: string): void {
    this.diagnostics.push({
      code,
      severity: 'error',
      message,
      hint,
      file: this.file,
      ...this.position(offset),
    })
  }

  warn(code: CompilerCode, offset: number, message: string, hint?: string): void {
    this.diagnostics.push({
      code,
      severity: 'warning',
      message,
      hint,
      file: this.file,
      ...this.position(offset),
    })
  }

  /** Add a diagnostic by code name, for rules that decide their own severity. */
  add(
    code: string,
    severity: 'error' | 'warning',
    offset: number,
    message: string,
    hint?: string,
    fix?: CompilerDiagnostic['fix'],
  ): void {
    this.diagnostics.push({
      code,
      severity,
      message,
      hint,
      file: this.file,
      ...this.position(offset),
      ...(fix ? { fix } : {}),
    })
  }

  get hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === 'error')
  }
}
