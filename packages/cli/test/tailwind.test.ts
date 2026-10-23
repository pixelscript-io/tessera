import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildTokens } from '@tessera/tokens'
import { describe, expect, it } from 'vitest'
import { buildTailwindTokens, parseTheme } from '../scripts/tailwind'

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))
const css = readFileSync(root('tailwind/theme.css'), 'utf8')
const generated = buildTailwindTokens(css)

describe('the Tailwind preset tokens', () => {
  it('are what the generator produces from the committed theme, so they cannot drift from their source', () => {
    for (const [file, content] of Object.entries(generated)) {
      const committed = readFileSync(root(`templates/tailwind/system/tokens/${file}`), 'utf8')
      expect(committed, file).toBe(JSON.stringify(content, null, 2) + '\n')
    }
  })

  it('build with no errors, with the dark theme, and every token has a CSS variable', () => {
    const result = buildTokens({
      base: Object.entries(generated)
        .filter(([file]) => !file.startsWith('themes/'))
        .map(([file, content]) => ({ file, content })),
      themes: [{ file: 'dark.tokens.json', content: generated['themes/dark.tokens.json'] }],
    })
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.manifest!.tokens.length).toBeGreaterThan(450)
    expect(result.css).toContain('--t-color-red-500')
    expect(result.manifest!.themes.map((t) => t.name)).toEqual(['dark'])
  })

  it('include every color Tailwind defines, with the same count', () => {
    const theme = parseTheme(css)
    const colors = [...theme.keys()].filter((k) => k.startsWith('--color-'))
    const result = buildTokens({
      base: Object.entries(generated)
        .filter(([file]) => !file.startsWith('themes/'))
        .map(([file, content]) => ({ file, content })),
    })
    const built = result.manifest!.tokens.filter(
      (t) => t.path.startsWith('color.') && t.tier === 'primitive',
    )
    expect(built.length).toBe(colors.length)
    expect(colors.length).toBeGreaterThan(280)
    // A few by value: Tailwind's red-500 is oklch(63.7% 0.237 25.331).
    expect(built.find((t) => t.path === 'color.red.500')!.values.base.css).toBe(
      'oklch(0.637 0.237 25.331)',
    )
  })

  it('cover the scales Tailwind defines', () => {
    const theme = parseTheme(css)
    const names = (prefix: string) => [...theme.keys()].filter((k) => k.startsWith(`--${prefix}-`))
    const scale = generated['scale.tokens.json'] as any
    const effects = generated['effects.tokens.json'] as any
    const layout = generated['layout.tokens.json'] as any
    // Tailwind's radius, shadow, blur, breakpoint and container names are all there.
    for (const key of names('radius'))
      expect(scale.radius[key.slice('--radius-'.length)], key).toBeDefined()
    for (const key of names('blur'))
      expect(effects.blur[key.slice('--blur-'.length)], key).toBeDefined()
    for (const key of names('breakpoint'))
      expect(layout.breakpoint[key.slice('--breakpoint-'.length)], key).toBeDefined()
    for (const key of names('container'))
      expect(layout.container[key.slice('--container-'.length)], key).toBeDefined()
    for (const key of names('font-weight'))
      expect(scale.font.weight[key.slice('--font-weight-'.length)], key).toBeDefined()
    for (const key of names('ease'))
      expect(effects.motion.easing[key.slice('--ease-'.length)], key).toBeDefined()
    // Every text size has its line height.
    for (const size of Object.keys(scale.font.size).filter((k) => !k.startsWith('$'))) {
      expect(scale.font['size-leading'][size], size).toBeDefined()
    }
    expect(Object.keys(scale.space).length).toBeGreaterThan(30)
  })

  it('give the semantic layer a light and a dark value for every token that the dark theme overrides', () => {
    const light = (generated['semantic.tokens.json'] as any).color
    const dark = (generated['themes/dark.tokens.json'] as any).color
    const leaves = (o: any, path: string[] = []): string[] =>
      Object.entries(o).flatMap(([k, v]: [string, any]) =>
        k.startsWith('$') ? [] : '$value' in v ? [[...path, k].join('.')] : leaves(v, [...path, k]),
      )
    const lightLeaves = new Set(leaves(light))
    for (const leaf of leaves(dark)) expect(lightLeaves.has(leaf), leaf).toBe(true)
  })

  it('credit Tailwind and say they are data, not a dependency', () => {
    const license = readFileSync(root('tailwind/LICENSE'), 'utf8')
    expect(license).toContain('MIT License')
    const readme = readFileSync(root('templates/tailwind/system/tokens/README.md'), 'utf8')
    expect(readme).toContain('derived from the default theme of Tailwind CSS')
    expect(readme).toContain('your project does not depend on Tailwind')
    expect(generated['colors.tokens.json']!['$description']).toBe(
      'Derived from the default theme of Tailwind CSS (MIT).',
    )
  })
})
