import {
  checkTemplateParts,
  nearest,
  lineTable,
  parseContract,
  variantDefaults,
  type BehaviorRequirements,
  type Contract,
} from '@tessera/contract'
import { DATA_APIS, DEFAULT_API, type ProjectApi } from './apis'
import { checkDataCalls } from './data-checks'
import { generateTemplate, type ComponentInfo, type ComponentResolver } from './codegen'
import { words, type TemplateReads } from './expr'
import { Reporter, type CompilerDiagnostic } from './diagnostics'
import { analyzeScript, type Binding, type StateMembers } from './script'
import { changeHint, stateFileLabel, type ProjectState } from './shared-state'
import { parseSfc } from './sfc'
import { BEHAVIOR_ATTACH, BEHAVIOR_REQUIREMENTS } from '@tessera/behavior'
import { isBaselineable } from './accountability'
import { resolveConfig, type TesseraConfig } from './config'
import { relativeImport, type ComponentRegistry } from './registry'
import { checkContrast } from './style/contrast'
import { processStyle, type StyleStats } from './style/enforce'
import { StyleTokens } from './style/tokens'
import { parseTemplate, type TemplateNode } from './template'
import { PUBLIC_PACKAGES } from './packages'
import { AUTO_IMPORTS } from './autoimport-ts'
import { pageSlug } from './routes'
import { parseJsonc, JsonSyntaxError } from '@tessera/contract'

export type FileKind = 'component' | 'page' | 'layout'

export interface CompileOptions {
  /** Path shown in diagnostics. Its base name must equal the contract name. */
  file: string
  /** `component` (default) needs a contract; pages and layouts must not have one. */
  kind?: FileKind
  /** `optional` lets a component skip its contract (config `contracts.app`). */
  contract?: 'required' | 'optional'
  /** Finds the contracts of components the file imports explicitly. */
  components?: ComponentResolver
  /** Every component in the project. With `autoImports`, a tag found here is imported for the file. */
  registry?: ComponentRegistry
  /** Absolute path of the file, to compute imports relative to it. Defaults to `file`. */
  path?: string
  /**
   * The apis of the project (`app/apis`). With `autoImports`, a script that names one needs no import, and one named
   * `default` is what `get`, `post`, `put`, `patch` and `del` use.
   */
  apis?: readonly ProjectApi[]
  /**
   * The shared state of the project (`app/state`). With `autoImports`, a script or a template that names one needs
   * no import, its signal members are read as values in a template, and a change to one from outside its file is
   * an error.
   */
  state?: readonly ProjectState[]
  /**
   * `true` (default): components and the script APIs (`state`, `derived`, `effect`, `onCleanup`, `onMount`) need
   * no import in a `.tess` file. `false`: every name must be imported, and a missing one is an error.
   */
  autoImports?: boolean
  /** Behavior requirements for contract validation. */
  behaviors?: Readonly<Record<string, BehaviorRequirements>>
  /**
   * The design tokens, for checking `<style>`. A `StyleTokens` (from a token build) enables every check;
   * a list of dotted paths only checks that each `$token` exists. Omit to skip token checks.
   */
  tokens?: StyleTokens | Iterable<string>
  /** Style rules: governed properties, contrast level, primitives. */
  config?: TesseraConfig
  /** Today's date as `YYYY-MM-DD`, for `raw()` expiry. Defaults to the current date. */
  today?: string
  /**
   * The app's route patterns (`/blog/:slug`). When given, a literal `to` on `<Link>` that matches none of
   * them is an error.
   */
  routes?: readonly string[]
  /** The names of the layouts in `app/layouts`. When given, a page's `layout` must be one of them. */
  layouts?: readonly string[]
  /** Emit hot-update support under this id (the dev server). */
  hmrId?: string
}

export interface CompileResult {
  ok: boolean
  /** TypeScript source of an ES module. Empty when errors stop code generation; style rule violations (T21xx) do not. */
  code: string
  /** The component's CSS: scoped, with token references as `var()`, in `@layer tessera.components`. Empty when there is no `<style>` or there are errors. */
  css: string
  diagnostics: CompilerDiagnostic[]
  contract?: Contract
  /** What the `<style>` block contains, for `tessera report`. */
  style?: StyleStats
}

/** Pages and layouts are recognised by their folder; everything else is a component. */
export function kindFromPath(path: string): FileKind {
  const normalized = path.replaceAll('\\', '/')
  if (/\/pages\//.test(normalized)) return 'page'
  if (/\/layouts\//.test(normalized)) return 'layout'
  return 'component'
}

const CORE_APIS = ['state', 'derived', 'effect', 'onCleanup', 'onMount'] as const
const ROUTER_APIS = ['navigate', 'useRoute'] as const
const FRAMEWORK_APIS = [...CORE_APIS, ...ROUTER_APIS] as const

/** The `<page>` block of a page: its title, and its layout (a name in `app/layouts`, or `false` for none). */
interface PageMeta {
  title?: string
  layout?: string | false
}

/**
 * Compile one `.tess` file to a TypeScript module. This function is pure and uses no Node APIs, so it
 * also runs in a browser: file access happens in the caller, which passes in everything needed.
 */
export function compile(source: string, options: CompileOptions): CompileResult {
  const report = new Reporter(options.file, source)
  const kind = options.kind ?? 'component'
  // Style rule violations do not stop code generation, so a host can ship a file that a baseline or an
  // exemption covers. Anything else that is wrong leaves nothing to run.
  const blocked = () =>
    report.diagnostics.some((d) => d.severity === 'error' && !isBaselineable(d.code))
  let css = ''
  let style: StyleStats | undefined
  const finish = (code = '', contract?: Contract): CompileResult => ({
    ok: !report.hasErrors,
    code: blocked() ? '' : code,
    css: blocked() ? '' : css,
    ...(style ? { style } : {}),
    // In file order, whichever stage found them.
    diagnostics: report.diagnostics.sort((a, b) => a.line - b.line || a.column - b.column),
    contract,
  })

  const blocks = parseSfc(source, report)
  const templateBlock = blocks.get('template')
  if (!templateBlock) {
    if (!report.hasErrors)
      report.error(
        'T4002',
        0,
        'This file has no <template> block. A component needs a template with one root element.',
      )
    return finish()
  }

  // Names that clash with another component's.
  if (options.registry)
    report.diagnostics.push(...options.registry.diagnosticsFor(options.path ?? options.file))

  // Contract.
  const position = lineTable(source)
  const contractBlock = blocks.get('contract')
  let contract: Contract | undefined
  let parsedContract: ReturnType<typeof parseContract> | undefined
  if (kind !== 'component') {
    if (contractBlock)
      report.error(
        'T4013',
        contractBlock.start,
        `A ${kind} cannot have a <contract>. Only components are part of the design system.`,
      )
  } else if (blocks.get('page')) {
    report.error(
      'T4013',
      blocks.get('page')!.start,
      'A component cannot have a <page> block. That block is for files in the pages folder.',
    )
  }
  if (kind === 'component') {
    if (!contractBlock) {
      if (options.contract !== 'optional') {
        report.error(
          'T4013',
          templateBlock.start,
          'This component has no <contract>. Every component needs one, for example <contract>{ "name": "Card", "role": "group", "parts": ["root"] }</contract>.',
        )
      }
    } else {
      parsedContract = parseContract(contractBlock.content, {
        file: options.file,
        origin: position(contractBlock.contentStart),
        behaviors: options.behaviors ?? BEHAVIOR_REQUIREMENTS,
      })
      report.diagnostics.push(...parsedContract.diagnostics)
      contract = parsedContract.contract
    }
  }

  // Page block.
  const pageMeta: PageMeta = {}
  const pageBlock = kind === 'page' ? blocks.get('page') : undefined
  if (pageBlock) Object.assign(pageMeta, parsePageBlock(pageBlock, report, options.layouts))
  if (kind === 'layout' && blocks.get('page')) {
    report.error(
      'T4013',
      blocks.get('page')!.start,
      'A layout cannot have a <page> block. That block is for files in the pages folder.',
    )
  }

  // Style.
  const baseName = options.file
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, '')
  const prefix =
    kind === 'page'
      ? `t-page-${pageSlug(options.path ?? options.file)}__`
      : kind === 'layout'
        ? `t-layout-${baseName.replace(/[^A-Za-z0-9]/g, '')}__`
        : `t-${(contract?.name ?? baseName).replace(/[^A-Za-z0-9]/g, '')}__`
  const styleBlock = blocks.get('style')
  if (styleBlock) {
    const tokens =
      options.tokens === undefined
        ? undefined
        : options.tokens instanceof StyleTokens
          ? options.tokens
          : StyleTokens.fromPaths(options.tokens)
    const config = resolveConfig(options.config)
    const processed = processStyle({
      css: styleBlock.content,
      base: styleBlock.contentStart,
      tokens,
      config,
      contract,
      prefix,
      today: options.today ?? new Date().toISOString().slice(0, 10),
    })
    const issues = tokens
      ? [
          ...processed.issues,
          ...checkContrast({
            nodes: processed.nodes,
            tokens,
            contract,
            minimum: config.contrast.minimum,
            styleStart: styleBlock.contentStart,
          }),
        ]
      : processed.issues
    for (const i of issues) report.add(i.code, i.severity, i.offset, i.message, i.hint, i.fix)
    css = processed.css
    style = processed.stats
  }

  // Script.
  const scriptBlock = blocks.get('script')
  const apiFiles = new Map((options.apis ?? []).map((api) => [api.name, api.file]))
  const apiNames = new Set([...apiFiles.keys()].filter((name) => name !== DEFAULT_API))
  const stateMembers = new Map<string, StateMembers>(
    options.autoImports === false ? [] : (options.state ?? []).map((s) => [s.name, s.members]),
  )
  const script = scriptBlock
    ? analyzeScript(scriptBlock.content, { apis: apiNames, state: stateMembers })
    : analyzeScript('')
  const base = scriptBlock?.contentStart ?? 0
  for (const issue of script.impure) {
    report.warn(
      'W4101',
      base + issue.offset,
      `derived() should be pure, but ${issue.message}. Move side effects into effect().`,
    )
  }
  if (contract) {
    for (const emit of script.emits) {
      if (!(emit.name in contract.events)) {
        const close = nearest(emit.name, Object.keys(contract.events))
        report.error(
          'T4010',
          base + emit.offset,
          `${contract.name} does not declare an event "${emit.name}".`,
          close ? `Did you mean "${close}"?` : `Add "${emit.name}" to "events" in <contract>.`,
        )
      }
    }
  }

  // Shared state: a member that is not there, and a change from outside the file.
  const stateOf = new Map((options.state ?? []).map((s) => [s.name, s]))
  for (const use of script.stateUses) {
    const found = stateOf.get(use.name)
    if (!found || script.bindings.has(use.name) || use.member === undefined) continue
    if (!(use.member in found.members)) {
      const have = Object.keys(found.members)
      const close = nearest(use.member, have)
      report.error(
        'T5012',
        base + use.memberOffset!,
        `"${use.name}" has no "${use.member}".`,
        close
          ? `Did you mean "${close}"?`
          : have.length
            ? `It has ${words(have.slice(0, 8))}.`
            : undefined,
      )
    } else if (use.write) {
      report.error(
        'T5011',
        base + use.offset,
        `"${use.name}.${use.member}" can only be changed inside ${stateFileLabel(found.file)}.`,
        changeHint(use.name, found.members),
      )
    }
  }

  // `gihub.get(...)`: a name that is not an api, and is close to one that is.
  for (const call of script.apiCalls) {
    if (script.bindings.has(call.name) || apiNames.has(call.name)) continue
    const close = nearest(call.name, [...apiNames])
    if (close)
      report.error(
        'T5004',
        base + call.offset,
        `"${call.name}" is not an API.`,
        `Did you mean "${close}"?`,
      )
  }
  if (options.autoImports === false) {
    for (const name of DATA_APIS) {
      if (script.bindings.has(name) || !script.calls.has(name)) continue
      report.error(
        'T5003',
        base + script.calls.get(name)!,
        `"${name}" is not defined. Auto-imports are off, so it must be imported.`,
        `Add: import { ${name} } from "${PUBLIC_PACKAGES.core}"`,
      )
    }
  }

  const bindings = new Map<string, Binding>(script.bindings)
  for (const name of ['props', 'emit']) {
    if (!bindings.has(name))
      bindings.set(name, { name, kind: 'builtin', signal: 'callable', start: 0 })
  }
  // A piece of shared state is a name too, unless the script has one of its own.
  for (const [name, members] of stateMembers) {
    const found = stateOf.get(name)!
    if (!bindings.has(name))
      bindings.set(name, {
        name,
        kind: 'import',
        signal: 'state',
        state: { members, file: stateFileLabel(found.file) },
        start: 0,
      })
  }
  const autoImports = options.autoImports !== false
  for (const name of FRAMEWORK_APIS) {
    if (bindings.has(name)) continue
    if (autoImports) {
      bindings.set(name, { name, kind: 'builtin', signal: 'callable', start: 0 })
    } else if (script.firstUse.has(name)) {
      report.error(
        'T5003',
        base + script.firstUse.get(name)!,
        `"${name}" is not defined. Auto-imports are off, so it must be imported.`,
        `Add: import { ${name} } from "${AUTO_IMPORTS[name]}"`,
      )
    }
  }

  // Template.
  const nodes = parseTemplate(
    source,
    templateBlock.contentStart,
    templateBlock.contentStart + templateBlock.content.length,
    report,
  )
  if (kind === 'layout' && !hasDefaultSlot(nodes)) {
    report.error(
      'T6006',
      templateBlock.start,
      'This layout has no <slot />, so pages would have nowhere to render.',
      'Add <slot /> where the page should appear.',
    )
  }
  const reads: TemplateReads = { names: new Set(), bare: new Set(), members: new Map() }
  // The calls against the descriptions of the APIs, and what the answers of the reads are.
  const types = checkDataCalls(script, options.apis ?? [], report, base)
  const generated = generateTemplate(nodes, source, {
    report,
    reads,
    types,
    bindings,
    contract,
    templateStart: templateBlock.contentStart,
    classPrefix: prefix,
    routes: options.routes,
    resolver: withImports(
      options.components,
      options.registry,
      options.path ?? options.file,
      autoImports,
      script.imports.flatMap((i) => i.entries.map((e) => e.local)),
    ),
  })

  if (generated) warnUnhandledData(report, script, reads, base)

  // The state this file uses: the script names it, or the template reads it.
  const stateImports = [...stateMembers.keys()]
    .filter(
      (name) =>
        !script.bindings.has(name) && (script.identifiers.has(name) || reads.names.has(name)),
    )
    .map((name) => ({ name, file: stateOf.get(name)!.file }))

  if (generated && parsedContract?.contract) {
    report.diagnostics.push(
      ...checkTemplateParts(parsedContract, {
        classes: generated.classes,
        rootClasses: generated.rootClasses,
      }),
    )
  }
  if (!generated || blocked()) return finish('', contract)

  return finish(
    assemble(
      options,
      contract,
      scriptBlock?.content ?? '',
      script,
      generated,
      kind === 'page' ? pageMeta : undefined,
      stateImports,
    ),
    contract,
  )
}

/**
 * A read whose data the template shows, in a template that does not show `loading`, `error` or both. It is a warning:
 * the page works, but it is empty while the data comes and silent when it does not. A read that is handed on as a whole
 * is not judged, since what the receiver does with it is not known here.
 */
function warnUnhandledData(
  report: Reporter,
  script: ReturnType<typeof analyzeScript>,
  reads: TemplateReads,
  base: number,
): void {
  for (const call of script.dataCalls) {
    if (call.kind !== 'resource') continue
    let shown: boolean
    let loading: boolean
    let error: boolean
    let name: string
    let loadingName: string
    let errorName: string
    if (call.binding) {
      if (reads.bare.has(call.binding)) continue
      const members = reads.members.get(call.binding) ?? new Set<string>()
      shown = members.has('data')
      loading = members.has('loading')
      error = members.has('error')
      name = call.binding
      loadingName = `${name}.loading`
      errorName = `${name}.error`
    } else {
      const local = (key: string) => call.members?.find((m) => m.key === key)?.local
      const taken = (key: string) => {
        const l = local(key)
        return l !== undefined && reads.names.has(l)
      }
      shown = taken('data')
      loading = taken('loading')
      error = taken('error')
      name = local('data') ?? 'data'
      loadingName = local('loading') ?? 'loading'
      errorName = local('error') ?? 'error'
    }
    if (!shown) continue
    const missing = [!loading && 'loading', !error && 'error'].filter(Boolean) as string[]
    if (!missing.length) continue
    report.warn(
      'W4105',
      base + call.offset,
      `${call.call} can be slow and can fail, but this template never shows ${missing.join(' or ')}.`,
      call.binding
        ? `Add <p if="${loadingName}">Loading...</p> and <p else-if="${errorName}">Could not load.</p> before the data. ` +
            'It is a warning, and can be turned off for a path with a severity rule in tessera.config.ts.'
        : `Take ${missing.join(' and ')} too (const { data: ${name}, loading, error } = ...) and show them before the data. ` +
            'It is a warning, and can be turned off for a path with a severity rule in tessera.config.ts.',
    )
  }
}

/** Imported names are valid tags even when the resolver does not know them; the resolver supplies their contracts. */
function withImports(
  explicit: ComponentResolver | undefined,
  registry: ComponentRegistry | undefined,
  path: string,
  autoImports: boolean,
  imported: string[],
): ComponentResolver | undefined {
  if (!explicit && !registry) return undefined
  const auto = registry?.resolverFor(path)
  return {
    // An explicit import wins; the registry only fills in what the file did not import.
    resolve: (tag) => explicit?.resolve(tag) ?? (autoImports ? auto?.resolve(tag) : undefined),
    names: () => [
      ...new Set([
        ...(explicit?.names() ?? []),
        ...(autoImports ? (auto?.names() ?? []) : []),
        ...imported.filter((n) => /^[A-Z]/.test(n)),
      ]),
    ],
    renamedTo: (tag) => auto?.renamedTo(tag),
    importHint: (tag) => {
      const line = auto?.importHint(tag)
      if (!line) return undefined
      return autoImports ? line : `Auto-imports are off, so import it: ${line}`
    },
  }
}

const autoOn = (options: CompileOptions) => options.autoImports !== false

function assemble(
  options: CompileOptions,
  contract: Contract | undefined,
  scriptCode: string,
  script: ReturnType<typeof analyzeScript>,
  generated: NonNullable<ReturnType<typeof generateTemplate>>,
  page?: PageMeta,
  stateImports: Array<{ name: string; file: string }> = [],
): string {
  const baseName = options.file
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, '')
  const name = contract?.name ?? baseName
  const variants = contract ? variantDefaults(contract) : {}

  // `get`, `post` and the rest come from the shared api in `core`, unless the project has an api named `default`.
  const apiFiles = new Map((options.apis ?? []).map((api) => [api.name, api.file]))
  const importer = options.path ?? options.file
  const named = autoOn(options)
    ? [...apiFiles.keys()].filter(
        (name) => name !== DEFAULT_API && script.firstUse.has(name) && !script.bindings.has(name),
      )
    : []
  const dataVerbs = autoOn(options)
    ? DATA_APIS.filter((verb) => script.calls.has(verb) && !script.bindings.has(verb))
    : []
  const defaultApi = apiFiles.get(DEFAULT_API)
  const useDefault = defaultApi !== undefined && dataVerbs.length > 0
  const coreData = useDefault ? [] : dataVerbs

  const coreImports = [
    'defineComponent as $defineComponent',
    'getRenderer as $getRenderer',
    'constant as $constant',
    'derived as $derived',
    'unwrap as $u',
    ...used(CORE_APIS),
    ...coreData,
  ]
  const routerImports = used(ROUTER_APIS)

  function used(apis: readonly string[]): string[] {
    return options.autoImports === false
      ? []
      : apis.filter((api) => script.identifiers.has(api) && !script.bindings.has(api))
  }

  // Imports move to the top of the module; blank them out in place so line numbers stay put.
  let body = scriptCode
  const hoisted: string[] = []
  for (const stmt of [...script.imports].sort((a, b) => b.start - a.start)) {
    hoisted.unshift(scriptCode.slice(stmt.start, stmt.end))
    body =
      body.slice(0, stmt.start) +
      scriptCode.slice(stmt.start, stmt.end).replace(/[^\n]/g, ' ') +
      body.slice(stmt.end)
  }

  const componentImports = [...generated.components]
    .filter(([tag]) => !script.bindings.has(tag))
    .map(
      ([tag, info]: [string, ComponentInfo]) =>
        `import ${tag} from ${JSON.stringify(info.importPath)}`,
    )

  const behaviorImports = [...generated.behaviors].map(
    (b) => `${BEHAVIOR_ATTACH[b]} as $${BEHAVIOR_ATTACH[b]}`,
  )
  const hmr = options.hmrId !== undefined
  const lines = [
    `import { ${coreImports.join(', ')} } from "${PUBLIC_PACKAGES.core}"`,
    ...(behaviorImports.length
      ? [`import { ${behaviorImports.join(', ')} } from "${PUBLIC_PACKAGES.behavior}"`]
      : []),
    ...(routerImports.length
      ? [`import { ${routerImports.join(', ')} } from "${PUBLIC_PACKAGES.router}"`]
      : []),
    ...hoisted,
    ...componentImports,
    ...named.map(
      (name) =>
        `import ${name} from ${JSON.stringify(relativeImport(importer, apiFiles.get(name)!))}`,
    ),
    ...stateImports.map(
      ({ name, file }) =>
        `import * as ${name} from ${JSON.stringify(relativeImport(importer, file))}`,
    ),
    ...(useDefault
      ? [`import $defaultApi from ${JSON.stringify(relativeImport(importer, defaultApi!))}`]
      : []),
    '',
    `export default $defineComponent(${JSON.stringify(name)}, ${JSON.stringify(variants)}, ($ctx: import("${PUBLIC_PACKAGES.core}").ComponentContext) => {`,
    '  const $r = $getRenderer()',
    '  const props = $ctx.props',
    '  const emit = $ctx.emit',
    ...(useDefault ? [`  const { ${dataVerbs.join(', ')} } = $defaultApi`] : []),
    body,
    `  return $ctx.root(${generated.root}${generated.rootClass ? `, ${JSON.stringify(generated.rootClass)}` : ''})`,
    `}${hmr ? `, ${JSON.stringify(options.hmrId)}` : ''})`,
  ]
  if (page) lines.push('', `export const page = ${JSON.stringify(page)}`)
  if (hmr) lines.push('', 'if (import.meta.hot) import.meta.hot.accept()')
  return lines.join('\n') + '\n'
}

/** Default and named imports of a `.tess` file's script, so a host can find the components it uses. */
export function listImports(
  source: string,
): Array<{ local: string; imported: string; source: string }> {
  const blocks = parseSfc(source, new Reporter('', source))
  const script = blocks.get('script')
  return script ? analyzeScript(script.content).imports.flatMap((i) => i.entries) : []
}

/** Parse just the contract of a `.tess` file, for resolving components that another file uses. */
export function extractContract(source: string, file: string): Contract | undefined {
  return extractContractInfo(source, file)?.contract
}

/** The contract of a `.tess` file and where its `name` is, or undefined if it has none or it is invalid. */
export function extractContractInfo(
  source: string,
  file: string,
): { contract: Contract; nameAt: { line: number; column: number } } | undefined {
  const report = new Reporter(file, source)
  const block = parseSfc(source, report).get('contract')
  if (!block) return undefined
  const parsed = parseContract(block.content, {
    file,
    origin: lineTable(source)(block.contentStart),
  })
  return parsed.contract
    ? { contract: parsed.contract, nameAt: parsed.locate(['name']) }
    : undefined
}

const PAGE_FIELDS = ['title', 'layout']

/** Read the `<page>` block: JSON with comments, an object with a `title`. */
function parsePageBlock(
  block: { content: string; contentStart: number },
  report: Reporter,
  layouts?: readonly string[],
): PageMeta {
  const meta: PageMeta = {}
  let root
  try {
    root = parseJsonc(block.content)
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      report.error(
        'T6005',
        block.contentStart + error.offset,
        `The <page> block is not valid JSON: ${error.message}.`,
      )
      return meta
    }
    throw error
  }
  if (root.type !== 'object') {
    report.error(
      'T6005',
      block.contentStart + root.start,
      'The <page> block must be an object, such as { "title": "About" }.',
    )
    return meta
  }
  for (const prop of root.props) {
    const at = block.contentStart + prop.keyStart
    if (prop.key === 'layout') {
      const value = prop.value
      if (value.type === 'boolean' && value.value === false) meta.layout = false
      else if (value.type !== 'string') {
        report.error(
          'T6005',
          block.contentStart + value.start,
          '"layout" must be the name of a layout, or false for none.',
        )
      } else {
        meta.layout = value.value
        if (layouts && !layouts.includes(value.value)) {
          const close = nearest(value.value, [...layouts])
          report.error(
            'T6003',
            block.contentStart + value.start,
            `Unknown layout "${value.value}".`,
            close
              ? `Did you mean "${close}"?`
              : layouts.length
                ? `Layouts: ${layouts.map((l) => `"${l}"`).join(', ')}.`
                : `There are no layouts yet. Add app/layouts/${value.value}.tess.`,
          )
        }
      }
    } else if (prop.key === 'title') {
      if (prop.value.type !== 'string') {
        report.error('T6005', block.contentStart + prop.value.start, '"title" must be a string.')
      } else meta.title = prop.value.value
    } else {
      const close = nearest(prop.key, PAGE_FIELDS)
      report.error(
        'T6005',
        at,
        `The <page> block has no field "${prop.key}".`,
        close
          ? `Did you mean "${close}"?`
          : `Fields: ${PAGE_FIELDS.map((f) => `"${f}"`).join(', ')}.`,
      )
    }
  }
  return meta
}

/** Is there a `<slot />` (the default one) anywhere in the template? */
function hasDefaultSlot(nodes: readonly TemplateNode[]): boolean {
  return nodes.some(
    (n) =>
      n.type === 'element' &&
      ((n.tag === 'slot' && !n.attrs.some((a) => a.name === 'name' && a.value !== 'default')) ||
        hasDefaultSlot(n.children)),
  )
}
