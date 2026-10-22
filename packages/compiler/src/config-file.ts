import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { transformWithEsbuild } from 'vite'
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
 * Load `tessera.config.ts` (or `.mjs`/`.js`) from a project root. A TypeScript file is compiled with
 * esbuild to a temporary module beside it (so its own imports resolve) and imported. The default export is
 * the style config (`TesseraConfig`); the project-level options `contracts`, `tokens` and `baseline` may sit
 * beside the style fields and are separated out.
 */
export async function loadConfigFile(root: string): Promise<LoadedConfig | undefined> {
  const path = findConfigFile(root)
  if (!path) return undefined
  let url = pathToFileURL(path).href
  let temp: string | undefined
  if (path.endsWith('.ts')) {
    const out = await transformWithEsbuild(readFileSync(path, 'utf8'), path, {
      target: 'node20',
      format: 'esm',
    })
    const dir = join(root, '.tessera')
    mkdirSync(dir, { recursive: true })
    temp = join(dir, `config.${process.pid}.${Date.now()}.mjs`)
    writeFileSync(temp, out.code)
    url = pathToFileURL(temp).href
  }
  try {
    const loaded = (await import(/* @vite-ignore */ url)) as { default?: Record<string, unknown> }
    const raw = loaded.default ?? {}
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
