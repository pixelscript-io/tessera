export {
  compile,
  extractContract,
  kindFromPath,
  listImports,
  type CompileOptions,
  type CompileResult,
  type FileKind,
} from './compile'
export type { ComponentInfo, ComponentResolver } from './codegen'
export { COMPILER_CODES, type CompilerCode, type CompilerDiagnostic } from './diagnostics'
export { formatDiagnostic } from '@tessera/contract'
export { analyzeScript } from './script'
export { parseSfc } from './sfc'
export { parseTemplate, type ElementNode, type TemplateNode, type TextNode } from './template'
export { Reporter } from './diagnostics'
export { StyleTokens } from './style/tokens'
export type { StyleStats, RawEscape } from './style/enforce'
export {
  defineConfig,
  resolveConfig,
  validateConfig,
  DEFAULT_GOVERNED,
  type TesseraConfig,
  type SeverityRule,
  type GovernedMap,
  type Accept,
} from './config'
export {
  applyBaseline,
  applyFixes,
  applySeverity,
  createBaseline,
  emptyBaseline,
  pruneBaseline,
  resolveSeverity,
  countViolations,
  globToRegExp,
  isBaselineable,
  VIOLATION_CODES,
  type Baseline,
  type BaselineResult,
  type FixResult,
  type Level,
} from './accountability'
export type { Contract } from '@tessera/contract'
export {
  ComponentRegistry,
  relativeImport,
  type RegistryEntry,
  type RegistryDiagnostic,
  type RegistryFile,
} from './registry'
export { checkPlainScriptAutoImports, AUTO_IMPORTS } from './autoimport-ts'
export { generateComponentsDts } from './dts'
export { generateRoutesDts, generateRoutesModule, routeDiagnostics, unknownRoute } from './routes'
export {
  ALL_CODES,
  CODE_GROUPS,
  CODE_ORDER,
  EXPLANATIONS,
  exampleSource,
  explainText,
  type Example,
  type Explanation,
} from './explanations'
export { runExample, type ExampleEnv, type ExampleOutput } from './explain-run'
export {
  buildAgentManifest,
  type AgentManifest,
  type ManifestComponent,
  type ManifestRoutes,
  type ManifestRules,
  type ManifestTokens,
} from './agent-manifest'
