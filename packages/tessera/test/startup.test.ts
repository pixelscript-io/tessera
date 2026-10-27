import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

/** The module specifiers a built file imports before it runs anything: its static imports. */
const staticImports = (file: string): string[] =>
  [
    ...readFileSync(join(dist, file), 'utf8').matchAll(
      /^import\s[^;]*?from\s+["']([^"']+)["'];?$/gm,
    ),
  ].map((m) => m[1]!)

/** Everything loaded when the command line starts: `cli.js` and the chunks it imports, and what they import. */
function loadedAtStart(): { files: string[]; packages: Set<string> } {
  const files: string[] = []
  const packages = new Set<string>()
  const visit = (file: string) => {
    if (files.includes(file)) return
    files.push(file)
    for (const spec of staticImports(file)) {
      if (spec.startsWith('./') && existsSync(join(dist, spec))) visit(spec.slice(2))
      else packages.add(spec)
    }
  }
  visit('cli.js')
  return { files, packages }
}

describe('starting the command line', () => {
  it('does not load Vite until a command needs it, which costs about 200 ms on every command', () => {
    // `check`, `explain`, `init` and `help` need no server. Only dev, build, preview, docs and elements do.
    const { packages } = loadedAtStart()
    expect(packages.has('vite')).toBe(false)
  })

  it('does not load the test tools, Prettier or the docs app for any command that is not about them', () => {
    const { packages, files } = loadedAtStart()
    for (const name of [
      'vitest',
      '@vitest/browser-playwright',
      'prettier',
      'axe-core',
      'playwright',
    ])
      expect(packages.has(name), name).toBe(false)
    // The docs app and the Prettier plugin are chunks of their own, reached only by a dynamic import.
    expect(files.some((f) => f.startsWith('prettier-plugin'))).toBe(false)
  })

  it('loads Vite when a command needs it', () => {
    const text = readFileSync(join(dist, 'cli.js'), 'utf8')
    const all = [
      text,
      ...loadedAtStart().files.map((f) => readFileSync(join(dist, f), 'utf8')),
    ].join('\n')
    expect(all).toMatch(/await import\(["']vite["']\)/)
  })
})
