import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuildInput } from './build'

/**
 * Read a tokens folder: `*.tokens.json` files in `dir` are the base, and `*.tokens.json` files in
 * `dir/themes` are themes. Node only; the build itself takes file contents, so it also runs in a browser.
 */
export function loadTokenDir(dir: string, baseName?: string): BuildInput {
  const read = (folder: string) => {
    try {
      return readdirSync(folder, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.tokens.json'))
        .map((e) => join(folder, e.name))
        .sort()
        .map((file) => ({ file, content: readFileSync(file, 'utf8') }))
    } catch {
      return []
    }
  }
  return { baseName, base: read(dir), themes: read(join(dir, 'themes')) }
}
