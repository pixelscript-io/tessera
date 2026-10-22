import { lineTable } from '@tessera/contract'
import type { CompilerDiagnostic } from './diagnostics'
import { analyzeScript } from './script'

/** Names that need no import inside a `.tess` file, and the package each one comes from. */
export const AUTO_IMPORTS: Readonly<Record<string, string>> = {
  state: '@tessera/core',
  derived: '@tessera/core',
  effect: '@tessera/core',
  onCleanup: '@tessera/core',
  onMount: '@tessera/core',
  navigate: '@tessera/router',
  useRoute: '@tessera/router',
}

const escape = (name: string) => name.replace(/[$]/g, '\\$&')

/** Does the file bind `name` somewhere (a declaration, a parameter, a destructured name, an import)? */
function declaredSomewhere(source: string, name: string): boolean {
  const n = escape(name)
  const patterns = [
    new RegExp(
      String.raw`\b(?:const|let|var)\s+(?:${n}\b|\{[^}]*\b${n}\b[^}]*\}|\[[^\]]*\b${n}\b[^\]]*\])`,
    ),
    new RegExp(String.raw`\b(?:function|class|enum|type|interface)\s+\*?\s*${n}\b`),
    new RegExp(String.raw`\bimport\b[^;]*?\b${n}\b[^;]*?\bfrom\b`),
    new RegExp(String.raw`[(,]\s*${n}\s*[:,)=?]`),
  ]
  return patterns.some((p) => p.test(source))
}

/**
 * Auto-imports only work inside `.tess` files, where the compiler can add the import. In a plain `.ts` file
 * a call to one of those names has nothing to resolve to, and it fails at runtime with a bare
 * ReferenceError. This finds such calls and names the import to add.
 *
 * It is a heuristic, not a type checker: it looks for a call to the name (`state(0)`) in a file that never
 * declares, imports or takes the name as a parameter. A shadowed name it cannot see is not reported.
 */
export function checkPlainScriptAutoImports(source: string, file: string): CompilerDiagnostic[] {
  const analysis = analyzeScript(source)
  const position = lineTable(source)
  const out: CompilerDiagnostic[] = []
  for (const [name, from] of Object.entries(AUTO_IMPORTS)) {
    const offset = analysis.calls.get(name)
    if (offset === undefined) continue
    if (analysis.bindings.has(name) || declaredSomewhere(source, name)) continue
    out.push({
      code: 'T5002',
      severity: 'error',
      message: `Unresolved identifier "${name}" in ${file}. Auto-imports only apply inside .tess files; import it from "${from}".`,
      file,
      ...position(offset),
    })
  }
  return out.sort((a, b) => a.line - b.line || a.column - b.column)
}
