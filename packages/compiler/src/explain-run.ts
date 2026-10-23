import {
  buildTokens,
  formatDiagnostic as formatTokenDiagnostic,
  importTokens,
} from '@tessera/tokens'
import { buildRouteManifest } from '@tessera/router/manifest'
import { formatDiagnostic } from '@tessera/contract'
import { compile, extractContract, kindFromPath } from './compile'
import { validateConfig, type TesseraConfig } from './config'
import { checkPlainScriptAutoImports } from './autoimport-ts'
import type { ComponentResolver } from './codegen'
import type { Example } from './explanations'
import { ComponentRegistry } from './registry'
import { routeDiagnostics } from './routes'
import { StyleTokens } from './style/tokens'

/** What running an example needs from the project: the tokens, and the sources of the components it may use. */
export interface ExampleEnv {
  tokens: StyleTokens
  button: string
  link: string
}

export interface ExampleOutput {
  /** Every code the example produced. */
  codes: string[]
  /** Each diagnostic as the CLI prints it. */
  messages: string[]
}

/** Run an example the way a project would, and return what it produced. */
export function runExample(example: Example, env: ExampleEnv): ExampleOutput {
  const out = (items: Array<{ code: string; text: string }>): ExampleOutput => ({
    codes: items.map((i) => i.code),
    messages: items.map((i) => i.text),
  })

  switch (example.kind) {
    case 'tess': {
      const components = new Map<
        string,
        { contract: NonNullable<ReturnType<typeof extractContract>>; importPath: string }
      >()
      for (const extra of example.components ?? []) {
        components.set(extra.name, {
          contract: extractContract(extra.source, `${extra.name}.tess`)!,
          importPath: `./${extra.name}.tess`,
        })
      }
      for (const name of example.uses ?? []) {
        const source = name === 'Button' ? env.button : env.link
        components.set(name, {
          contract: extractContract(source, `${name}.tess`)!,
          importPath: `./${name}.tess`,
        })
      }
      const resolver: ComponentResolver | undefined = components.size
        ? {
            resolve: (tag) => components.get(tag),
            names: () => [...components.keys()],
          }
        : undefined
      const result = compile(example.source, {
        file: example.file,
        path: `/${example.file}`,
        kind: kindFromPath(`/${example.file}`),
        components: resolver,
        tokens: example.deprecatedTokens
          ? new StyleTokens(
              env.tokens
                .all()
                .map((t) =>
                  example.deprecatedTokens!.includes(t.path)
                    ? { ...t, deprecated: 'Use a newer token.' }
                    : t,
                ),
              env.tokens.scopes,
            )
          : env.tokens,
        today: '2026-10-22',
        ...example.options,
      })
      return out(result.diagnostics.map((d) => ({ code: d.code, text: formatDiagnostic(d) })))
    }
    case 'tokens': {
      const result = buildTokens({
        base: example.base.map(([file, content]) => ({ file, content })),
        themes: (example.themes ?? []).map(([file, content]) => ({ file, content })),
      })
      return out(result.diagnostics.map((d) => ({ code: d.code, text: formatTokenDiagnostic(d) })))
    }
    case 'import': {
      const result = importTokens(
        example.files.map(([path, content]) => ({ path, content: JSON.stringify(content) })),
        'dtcg',
      )
      return out(result.diagnostics.map((d) => ({ code: d.code, text: formatTokenDiagnostic(d) })))
    }
    case 'routes': {
      const manifest = buildRouteManifest(example.files)
      return out(
        routeDiagnostics(manifest, 'app/pages').map((d) => ({
          code: d.code,
          text: formatDiagnostic(d),
        })),
      )
    }
    case 'ts':
      return out(
        checkPlainScriptAutoImports(example.source, example.file).map((d) => ({
          code: d.code,
          text: formatDiagnostic(d),
        })),
      )
    case 'config':
      return out(
        validateConfig(example.config as TesseraConfig).map((i) => ({
          code: i.code,
          text: `ERROR  ${i.code}  tessera.config.ts\n  ${i.message}\n  Run \`tessera explain ${i.code}\` for details.`,
        })),
      )
    case 'registry': {
      const registry = ComponentRegistry.build(example.files, (f) => f)
      return out(
        registry.diagnostics.map((d) => ({
          code: d.code,
          text: `ERROR  ${d.code}  ${d.file}\n  ${d.message}\n  Run \`tessera explain ${d.code}\` for details.`,
        })),
      )
    }
  }
}
