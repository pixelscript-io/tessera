import { describe, expect, it } from 'vitest'
import { buildTokens, importTokens, type InterchangeFile } from '../src'

const file = (path: string, content: string): InterchangeFile => ({ path, content })
const tokensOf = (r: ReturnType<typeof importTokens>) =>
  Object.fromEntries(r.base.map((f) => [f.path, JSON.parse(f.content)]))
const notes = (r: ReturnType<typeof importTokens>) => r.diagnostics.map((d) => d.message)

const TAILWIND_V4 = `
@import "tailwindcss";
@theme {
  --color-brand-600: #1d4ed8;
  --color-gray-900: oklch(0.21 0.03 265);
  --spacing: 0.25rem;
  --radius-lg: 0.5rem;
  --font-sans: ui-sans-serif, system-ui, sans-serif;
  --text-sm: 0.875rem;
  --text-sm--line-height: 1.25rem;
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --animate-spin: spin 1s linear infinite;
}
`

const SHADCN = `
:root {
  --background: oklch(1 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --ring: var(--primary);
  --radius: 0.625rem;
  --radius-sm: calc(var(--radius) - 4px);
}
.dark {
  --background: oklch(0.145 0 0);
  --primary: oklch(0.922 0 0);
}
.card {
  --card-pad: 1rem;
}
`

describe('CSS custom properties', () => {
  it('reads a Tailwind v4 @theme block under the names it has, typed by value', () => {
    const r = importTokens([file('theme.css', TAILWIND_V4)])
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const doc = tokensOf(r)['theme.tokens.json']
    expect(doc.color.brand['600'].$type).toBe('color')
    expect(doc.color.gray['900'].$type).toBe('color')
    expect(doc.spacing.$type).toBe('dimension')
    expect(doc.radius.lg.$value).toEqual({ value: 0.5, unit: 'rem' })
    expect(doc.font.sans.$type).toBe('fontFamily')
    expect(doc.shadow.md.$type).toBe('shadow')
    expect(doc.shadow.md.$value).toHaveLength(2)
    expect(doc.ease.out.$type).toBe('cubicBezier')
    // `--text-sm` and `--text-sm--line-height` share a start: the first becomes the group's root.
    expect(doc.text.sm.$root.$type).toBe('dimension')
    expect(doc.text.sm.line.height.$type).toBe('dimension')
  })

  it('says what it left out, with a count and an example', () => {
    const m = notes(importTokens([file('theme.css', TAILWIND_V4)])).join('\n')
    expect(m).toContain('--animate-spin: spin 1s linear infinite')
  })

  it('turns var() into an alias, and a name that starts another into its $root', () => {
    const r = importTokens([file('globals.css', SHADCN)])
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const doc = tokensOf(r)['globals.tokens.json']
    expect(doc.primary.$root.$type).toBe('color')
    expect(doc.primary.foreground.$type).toBe('color')
    expect(doc.ring.$value).toBe('{primary.$root}')
    expect(doc.ring.$type).toBe('color')
  })

  it('does not import calc(), and says custom properties in a component were not imported', () => {
    const m = notes(importTokens([file('globals.css', SHADCN)])).join('\n')
    expect(m).toContain('calc()')
    expect(m).toMatch(/outside the root and its themes[^]*"\.card"/)
  })

  it('builds as a Tessera token set', () => {
    const r = importTokens([file('theme.css', TAILWIND_V4)])
    const built = buildTokens({
      baseName: 'base',
      base: r.base.map((f) => ({ file: f.path, content: f.content })),
      themes: [],
    })
    expect(built.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('tells a bare number by the words in its name', () => {
    const css = `:root{--font-weight-bold:700;--opacity-50:0.5;--space-4:16;--z-modal:50;--duration-fast:150}`
    const doc = tokensOf(importTokens([file('n.css', css)]))['n.tokens.json']
    expect(doc.font.weight.bold.$type).toBe('fontWeight')
    expect(doc.opacity['50'].$type).toBe('number')
    expect(doc.space['4'].$value).toEqual({ value: 16, unit: 'px' })
    expect(doc.z.modal.$type).toBe('number')
    expect(doc.duration.fast.$value).toEqual({ value: 150, unit: 'ms' })
  })

  it('does not take a padding shorthand for a shadow', () => {
    const doc = tokensOf(importTokens([file('p.css', `:root{--pad:1rem 2rem}`)]))['p.tokens.json']
    expect(doc).toBeUndefined()
  })

  it('reports a file with no custom properties', () => {
    const r = importTokens([file('x.css', 'a { color: red }')])
    expect(r.base).toEqual([])
    expect(notes(r).join('\n')).toContain('No custom properties')
  })
})

describe('Style Dictionary JSON without types', () => {
  const sd = JSON.stringify({
    color: {
      base: { gray: { 900: { value: '#111111', comment: 'text' } } },
      text: { value: '{color.base.gray.900.value}' },
    },
    size: { padding: { md: { value: '16px' } }, font: { base: { value: '1rem', type: 'size' } } },
    time: { fast: { value: '150ms' } },
    weird: { thing: { value: 'banana' } },
  })

  it('types the tokens from their values and strips .value from references', () => {
    const r = importTokens([file('tokens.json', sd)])
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const doc = tokensOf(r)['tokens.tokens.json'] ?? tokensOf(r)[r.base[0]!.path]
    expect(doc.color.base.gray['900'].$type).toBe('color')
    expect(doc.color.text.$value).toBe('{color.base.gray.900}')
    expect(doc.color.text.$type).toBe('color')
    expect(doc.size.padding.md.$value).toEqual({ value: 16, unit: 'px' })
    expect(doc.size.font.base.$type).toBe('dimension')
    expect(doc.time.fast.$type).toBe('duration')
  })

  it('removes a token it cannot type and counts it', () => {
    const r = importTokens([file('tokens.json', sd)])
    const doc = tokensOf(r)[r.base[0]!.path]
    expect(doc.weird).toBeUndefined()
    expect(notes(r).join('\n')).toContain('weird.thing: "banana"')
  })

  it('leaves typed DTCG alone', () => {
    const dtcg = JSON.stringify({ a: { $type: 'color', $value: '#fff' } })
    const r = importTokens([file('a.tokens.json', dtcg)])
    expect(notes(r)).toEqual([])
    expect(JSON.parse(r.base[0]!.content).a.$type).toBe('color')
  })
})

describe('notes', () => {
  it('keep an example to one short line', () => {
    const long = `0 1px 2px ${'rgb(0 0 0 / 5%), 0 1px 2px '.repeat(20)}red`
    const css = `:root {\n  --big: calc(1px + ${long});\n}\n@media (min-width: 1px)\n  and (max-width: 9px) {\n  :root { --x: 1 }\n}`
    const m = notes(importTokens([file('a.css', css)])).join('\n')
    expect(m).toContain('...')
    expect(m).not.toMatch(/for example "[^"]*\n/)
    expect(m).toContain('@media (min-width: 1px) and (max-width: 9px) :root')
  })
})

const themeOf = (r: ReturnType<typeof importTokens>, name: string) => {
  const f = r.themes.find((x) => x.path === `themes/${name}.tokens.json`)
  return f ? JSON.parse(f.content) : undefined
}

describe('themes in CSS', () => {
  it('reads a .dark block as a theme that overrides the root, and nothing it does not change', () => {
    const r = importTokens([file('globals.css', SHADCN)])
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const dark = themeOf(r, 'dark')
    expect(dark.$extends).toBe('base')
    expect(dark.background.$value.components[0]).toBeCloseTo(0.145)
    expect(dark.primary.$root.$value.components[0]).toBeCloseTo(0.922)
    // Not in the dark block, so not in the theme.
    expect(dark.radius).toBeUndefined()
    expect(dark.ring).toBeUndefined()
  })

  it.each([
    '.dark',
    'html.dark',
    ':root.dark',
    '.theme-dark',
    '[data-theme=dark]',
    ':root[data-theme="dark"]',
    '[data-bs-theme=dark]',
    '[data-color-mode="dark"]',
  ])('knows %s as the dark theme', (selector) => {
    const css = `:root { --bg: #ffffff }\n${selector} { --bg: #000000 }`
    const dark = themeOf(importTokens([file('a.css', css)]), 'dark')
    expect(dark.bg.$value.components).toEqual([0, 0, 0])
  })

  it('takes prefers-color-scheme: dark as a theme that the system turns on', () => {
    const css = `:root { --bg: #ffffff }\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme=light]) { --bg: #101010 }\n}`
    const dark = themeOf(importTokens([file('a.css', css)]), 'dark')
    expect(dark.$auto).toBe('prefers-color-scheme: dark')
    expect(dark.bg.$value.components[0]).toBeCloseTo(0.0627, 3)
  })

  it('joins the class and the media query into one dark theme, the later rule winning', () => {
    const css = `:root { --bg: #ffffff }
@media (prefers-color-scheme: dark) { :root { --bg: #111111 } }
[data-theme=dark] { --bg: #000000 }`
    const r = importTokens([file('a.css', css)])
    expect(r.themes).toHaveLength(1)
    const dark = themeOf(r, 'dark')
    expect(dark.$auto).toBe('prefers-color-scheme: dark')
    expect(dark.bg.$value.components).toEqual([0, 0, 0])
  })

  it('names another theme by its attribute value', () => {
    const css = ':root { --bg: #ffffff }\n[data-theme=ocean] { --bg: #003355 }'
    expect(themeOf(importTokens([file('a.css', css)]), 'ocean')).toBeDefined()
  })

  it('leaves a descendant rule, light, and a value the root already has out of the theme', () => {
    const css = `:root { --bg: #ffffff; --fg: #111111 }
.dark .card { --bg: #000000 }
.dark { --fg: #111111 }
[data-theme=light] { --bg: #fefefe }`
    const r = importTokens([file('a.css', css)])
    expect(r.themes).toEqual([])
    expect(notes(r).join('\n')).toContain('".dark .card"')
  })

  it('aliases a root token, and leaves out a name the root lacks and a value of another type', () => {
    const css = `:root { --brand: #1d4ed8; --bg: #ffffff; --gap: 4px }
.dark { --bg: var(--brand); --only-dark: #000000; --gap: #000000 }`
    const r = importTokens([file('a.css', css)])
    const dark = themeOf(r, 'dark')
    expect(dark.bg.$value).toBe('{brand}')
    expect(dark.only).toBeUndefined()
    expect(dark.gap).toBeUndefined()
    const m = notes(r).join('\n')
    expect(m).toContain('only in the dark theme')
    expect(m).toContain("change a token's type (in the dark theme)")
  })

  it('merges the dark themes of several files into one', () => {
    const r = importTokens([
      file('a.css', ':root { --a: #ffffff }\n.dark { --a: #000000 }'),
      file('b.css', ':root { --b: #ffffff }\n.dark { --b: #000000 }'),
    ])
    expect(r.themes).toHaveLength(1)
    const dark = themeOf(r, 'dark')
    expect(
      Object.keys(dark)
        .filter((k) => !k.startsWith('$'))
        .sort(),
    ).toEqual(['a', 'b'])
  })

  it('builds with the theme applied', () => {
    const r = importTokens([file('globals.css', SHADCN)])
    const built = buildTokens({
      baseName: 'base',
      base: r.base.map((f) => ({ file: f.path, content: f.content })),
      themes: r.themes.map((f) => ({ file: f.path, content: f.content })),
    })
    expect(built.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(built.manifest!.themes.map((x) => x.name)).toEqual(['dark'])
  })

  it('reads a theme file of a Tessera project as a theme, not a base file', () => {
    const base = JSON.stringify({ bg: { $type: 'color', $value: '#ffffff' } })
    const dark = JSON.stringify({
      $extends: 'base',
      $auto: 'prefers-color-scheme: dark',
      bg: { $value: '#000000' },
    })
    const r = importTokens([file('base.tokens.json', base), file('themes/dark.tokens.json', dark)])
    expect(r.base).toHaveLength(1)
    expect(themeOf(r, 'dark').$auto).toBe('prefers-color-scheme: dark')
  })
})

describe('light and dark together', () => {
  it('takes [data-bs-theme=light] with the root, and finds only what dark changes', () => {
    const css = `:root, [data-bs-theme=light] { --shadow-strength: 1; --gap: 4px }
@media (prefers-color-scheme: dark) { :root, :host { --shadow-strength: 2.4 } }
[data-bs-theme=dark] { --shadow-strength: 2.4; color-scheme: dark }`
    const r = importTokens([file('a.css', css)])
    expect(notes(r)).toEqual([])
    const dark = themeOf(r, 'dark')
    expect(Object.keys(dark).filter((k) => !k.startsWith('$'))).toEqual(['shadow'])
    expect(JSON.parse(r.base[0]!.content).gap).toBeDefined()
  })
})
