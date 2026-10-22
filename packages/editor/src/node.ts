import { dirname, join } from 'node:path'
import {
  findUp,
  loadComponentRegistry,
  loadDesignTokens,
  resolveImportedComponents,
} from '@tessera/compiler/node'
import type { ComponentRegistry, StyleTokens } from '@tessera/compiler'
import { getDiagnostics, type EditorDiagnostic } from './service'

/**
 * What an editor session knows about a workspace: where the design tokens are, which components exist, and
 * which a file imports. Node only. The VS Code extension keeps one and calls `invalidate()` when a token or
 * component file changes. Tokens are found by walking up from each file to `system/tokens`, and the project a
 * file belongs to is the folder above the nearest `app/components`; the `tessera.config.ts` settings arrive with
 * the CLI in Milestone 11.
 */
export class EditorProject {
  private readonly tokenCache = new Map<string, StyleTokens | null>()
  private readonly registryCache = new Map<string, ComponentRegistry>()

  constructor(readonly root: string) {}

  /** The design tokens a file belongs to, or undefined if there are none or they do not build. */
  tokens(file: string): StyleTokens | undefined {
    const dir = findUp(dirname(file), join('system', 'tokens'))
    if (!dir) return undefined
    if (!this.tokenCache.has(dir)) {
      const loaded = loadDesignTokens(dir)
      this.tokenCache.set(dir, loaded.ok ? loaded.tokens : null)
    }
    return this.tokenCache.get(dir) ?? undefined
  }

  /** Dotted token paths, for callers that only need the names. */
  tokenPaths(file: string): string[] | undefined {
    return this.tokens(file)?.paths()
  }

  /** Every component available to a file: `system/components` plus the `app/components` of its project. */
  registry(file: string): ComponentRegistry {
    const app = findUp(dirname(file), join('app', 'components'))
    const projectRoot = app ? dirname(dirname(app)) : this.root
    let registry = this.registryCache.get(projectRoot)
    if (!registry) {
      registry = loadComponentRegistry(projectRoot).registry
      this.registryCache.set(projectRoot, registry)
    }
    return registry
  }

  invalidate(): void {
    this.tokenCache.clear()
    this.registryCache.clear()
  }

  diagnose(path: string, text: string): EditorDiagnostic[] {
    const { resolver } = resolveImportedComponents(path, text, this.root)
    return getDiagnostics(text, {
      file: path,
      path: path.replaceAll('\\', '/'),
      components: resolver,
      registry: this.registry(path),
      tokens: this.tokens(path),
    })
  }
}
