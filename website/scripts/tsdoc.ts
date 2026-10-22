import ts from 'typescript'

export interface ExportDoc {
  name: string
  kind: 'function' | 'interface' | 'type' | 'class' | 'constant' | 'enum' | 'other'
  /** TypeScript signature or declaration, with doc comments removed. */
  signature: string
  /** The TSDoc description, empty when the export has none. */
  doc: string
}

export interface MemberDoc {
  name: string
  type: string
  optional: boolean
  doc: string
}

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
}

function program(entry: string) {
  const p = ts.createProgram([entry], OPTIONS)
  return { p, checker: p.getTypeChecker(), source: p.getSourceFile(entry)! }
}

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()

const docOf = (symbol: ts.Symbol, checker: ts.TypeChecker) =>
  ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()

function kindOf(symbol: ts.Symbol): ExportDoc['kind'] {
  const f = symbol.flags
  if (f & ts.SymbolFlags.Function) return 'function'
  if (f & ts.SymbolFlags.Class) return 'class'
  if (f & ts.SymbolFlags.Interface) return 'interface'
  if (f & ts.SymbolFlags.TypeAlias) return 'type'
  if (f & ts.SymbolFlags.Enum) return 'enum'
  if (f & (ts.SymbolFlags.Variable | ts.SymbolFlags.Property)) return 'constant'
  return 'other'
}

/** Every export of an entry file, with its TSDoc description and a signature. */
export function documentExports(entry: string): ExportDoc[] {
  const { checker, source } = program(entry)
  const moduleSymbol = checker.getSymbolAtLocation(source)
  if (!moduleSymbol) return []
  const out: ExportDoc[] = []
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const declaration = symbol.declarations?.[0]
    if (!declaration) continue
    const kind = kindOf(symbol)
    let signature: string
    if (kind === 'function') {
      const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
      signature = type
        .getCallSignatures()
        .map((s) => `function ${exported.name}${checker.signatureToString(s)}`)
        .join('\n')
    } else if (kind === 'interface' || kind === 'type' || kind === 'enum') {
      signature = stripComments(declaration.getText())
    } else if (kind === 'class') {
      signature = `class ${exported.name}`
    } else {
      const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
      signature = `const ${exported.name}: ${checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)}`
    }
    out.push({ name: exported.name, kind, signature, doc: docOf(symbol, checker) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The documented members of one interface exported by an entry file. */
export function documentInterface(
  entry: string,
  name: string,
): { doc: string; members: MemberDoc[] } {
  const { checker, source } = program(entry)
  const moduleSymbol = checker.getSymbolAtLocation(source)!
  const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === name)
  if (!symbol) throw new Error(`${name} is not exported by ${entry}`)
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const type = checker.getDeclaredTypeOfSymbol(resolved)
  const members = checker.getPropertiesOfType(type).map((prop) => {
    const declaration = prop.declarations![0]!
    const propType = checker.getTypeOfSymbolAtLocation(prop, declaration)
    return {
      name: prop.name,
      type: checker.typeToString(propType, undefined, ts.TypeFormatFlags.NoTruncation),
      optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
      doc: docOf(prop, checker),
    }
  })
  return { doc: docOf(resolved, checker), members }
}
