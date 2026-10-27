import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TesseraConfig } from './config'
import type { ProjectOptions } from './project'

const NAMES = ['tessera.config.ts', 'tessera.config.mjs', 'tessera.config.js']

export interface LoadedConfig {
  path: string
  /** The default export: a config object, or `{ config, contracts, tokens, baseline }` for the whole project. */
  config: TesseraConfig
  options: ProjectOptions
}

/** The config file of a project, if it has one. */
export function findConfigFile(root: string): string | undefined {
  return NAMES.map((n) => join(root, n)).find((p) => existsSync(p))
}

/**
 * Can this Node import a `.ts` file itself, without a warning? Type stripping is on by default, and no longer
 * experimental, from Node 22.18 and 24.3. Where it is, a config file is imported as it is, which needs no esbuild (and
 * so no Vite) and lets the file import its neighbours.
 */
export function canStripTypes(
  versions: { node: string } = process.versions,
  features: { typescript?: unknown } = process.features,
): boolean {
  if (!features.typescript) return false
  const [major = 0, minor = 0] = versions.node.split('.').map(Number)
  return major > 24 || (major === 24 && minor >= 3) || (major === 22 && minor >= 18)
}

/** An import that failed because Node could not read the TypeScript, as opposed to the file's own errors. */
const unreadable = (error: unknown): boolean =>
  error instanceof SyntaxError ||
  (typeof (error as { code?: unknown })?.code === 'string' &&
    /TYPESCRIPT/.test((error as { code: string }).code))

/**
 * Load `tessera.config.ts` (or `.mjs`/`.js`) from a project root. A TypeScript file is imported by Node itself when
 * it can read TypeScript; when it cannot (an older Node, or syntax that is more than types, such as an enum), it is
 * compiled with esbuild to a temporary module beside it (so its own imports resolve) and imported. The default export is
 * the style config (`TesseraConfig`); the project-level options `contracts`, `tokens` and `baseline` may sit
 * beside the style fields and are separated out.
 */
export async function loadConfigFile(root: string): Promise<LoadedConfig | undefined> {
  const path = findConfigFile(root)
  if (!path) return undefined
  const shape = (loaded: { default?: Record<string, unknown> }) => loaded.default ?? {}
  let raw: Record<string, unknown> | undefined
  let temp: string | undefined
  try {
    if (path.endsWith('.ts') && canStripTypes()) {
      try {
        // A new address each time, so a long-running process sees a changed file.
        raw = shape(
          (await import(/* @vite-ignore */ `${pathToFileURL(path).href}?t=${Date.now()}`)) as {
            default?: Record<string, unknown>
          },
        )
      } catch (error) {
        if (!unreadable(error)) throw error
      }
    }
    if (!raw) {
      let url = pathToFileURL(path).href
      if (path.endsWith('.ts')) {
        // Vite is loaded only here: it is the slow part, and most configs never need it.
        const { transformWithEsbuild } = await import('vite')
        const out = await transformWithEsbuild(readFileSync(path, 'utf8'), path, {
          target: 'node20',
          format: 'esm',
        })
        // Beside the config, so that the files it imports resolve.
        temp = join(root, `.tessera-config.${process.pid}.${Date.now()}.mjs`)
        writeFileSync(temp, out.code)
        url = pathToFileURL(temp).href
      }
      raw = shape((await import(/* @vite-ignore */ url)) as { default?: Record<string, unknown> })
    }
    const { contracts, tokens, baseline, today, ...config } = raw as Record<string, unknown>
    return {
      path,
      config: config as TesseraConfig,
      options: {
        config: config as TesseraConfig,
        ...(contracts ? { contracts: contracts as 'required' | 'optional' } : {}),
        ...(tokens ? { tokens: resolve(root, tokens as string) } : {}),
        ...(baseline ? { baseline: resolve(root, baseline as string) } : {}),
        ...(today ? { today: today as string } : {}),
      },
    }
  } finally {
    if (temp) rmSync(temp, { force: true })
  }
}
