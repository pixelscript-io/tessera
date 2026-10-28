import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { buildRegistry, writeRegistry } from '../src/registry/build'
import { openSource } from '../src/registry/source'
import { buildSite, writeSite } from '../src/site/build'

const ui = fileURLToPath(new URL('../../ui', import.meta.url))
const cli = fileURLToPath(new URL('..', import.meta.url))

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-site-'))
  roots.push(dir)
  return dir
}

const tokenSets = [
  {
    name: 'tailwind',
    description: 'The default theme of Tailwind CSS as Tessera tokens.',
    dir: join(cli, 'templates', 'tailwind', 'system', 'tailwind', 'tokens'),
  },
  {
    name: 'unstyled',
    description: 'The token names the components use, with plain values.',
    dir: join(cli, 'templates', 'unstyled', 'system', 'unstyled', 'tokens'),
  },
]
const registry = () =>
  buildRegistry({ uiDir: ui, minTessera: '0.8.0', npmVersions: { lucide: '1.62.0' }, tokenSets })

const site = buildSite(registry())
const byPath = new Map(site.map((f) => [f.path, f.content]))
const page = (path: string): string => {
  const content = byPath.get(path)
  if (content === undefined) throw new Error(`no ${path} in the site`)
  return content
}
const pages = site.filter((f) => f.path.endsWith('.html'))

describe('the Tessera UI site: what it holds', () => {
  it('has a home page, a page for every component, a tokens page and a 404', () => {
    const { items } = registry()
    expect(byPath.has('index.html')).toBe(true)
    expect(byPath.has('tokens/index.html')).toBe(true)
    expect(byPath.has('404.html')).toBe(true)
    for (const item of items.filter((i) => i.type === 'component'))
      expect(byPath.has(`components/${item.name}/index.html`), item.name).toBe(true)
  })

  it('serves the registry itself, so one deploy is the site and the thing `tessera add` reads', () => {
    const dir = scratch()
    writeRegistry(registry(), dir)
    const written = [
      'index.json',
      ...registry().items.map((i) => `r/${i.name.replace(':', '-')}.json`),
    ]
    for (const path of written)
      expect(byPath.get(path), path).toBe(readFileSync(join(dir, path), 'utf8'))
  })

  it('is a folder `tessera add --from` can read', async () => {
    const out = scratch()
    writeSite(site, out)
    const source = openSource(out, process.cwd())
    const index = await source.index()
    expect(index.items.map((i) => i.name)).toContain('Button')
    expect((await source.item('Button')).files.map((f) => f.path)).toContain('Button.tess')
  })

  it('is the same every time it is built', () => {
    expect(buildSite(registry())).toEqual(site)
  })

  it('writes the files where the host serves them, replacing what was there', () => {
    const out = scratch()
    mkdirSync(join(out, 'old'), { recursive: true })
    writeFileSync(join(out, 'old', 'stale.html'), 'stale')
    writeSite(site, out)
    expect(readFileSync(join(out, 'components', 'Button', 'index.html'), 'utf8')).toBe(
      page('components/Button/index.html'),
    )
    expect(() => readFileSync(join(out, 'old', 'stale.html'))).toThrow()
  })
})

describe('the Tessera UI site: pages', () => {
  it('every page is a whole document with a title, a language, a viewport, one h1 and a skip link', () => {
    for (const { path, content } of pages) {
      expect(content.startsWith('<!doctype html>'), path).toBe(true)
      expect(content, path).toMatch(/<html lang="en"/)
      expect(content, path).toMatch(
        /<meta name="viewport" content="width=device-width, initial-scale=1"/,
      )
      expect(content, path).toMatch(/<title>[^<]+<\/title>/)
      expect(content.match(/<h1[ >]/g)?.length, path).toBe(1)
      expect(content, path).toMatch(/<a class="skip" href="#main">/)
      expect(content, path).toMatch(/<main id="main"/)
    }
  })

  it('loads nothing (no image, font, style sheet or script) and runs no script', () => {
    for (const { path, content } of pages) {
      expect(content, path).not.toMatch(/<script/i)
      expect(content, path).not.toMatch(/<link[^>]+rel="stylesheet"/i)
      expect(content, path).not.toMatch(/\b(src|srcset|poster|data)="/)
      expect(content, path).not.toMatch(/url\(\s*['"]?(https?:)?\/\//)
    }
  })

  it('has no link that goes nowhere', () => {
    const known = new Set(site.map((f) => f.path))
    for (const { path, content } of pages) {
      for (const m of content.matchAll(/\bhref="([^"]+)"/g)) {
        const href = m[1]!
        if (/^(https?:|mailto:)/.test(href)) continue
        const [file, hash] = href.split('#') as [string, string | undefined]
        const target = file
          ? posix
              .normalize(posix.join('/', file.startsWith('/') ? '' : posix.dirname(path), file))
              .slice(1)
          : path
        const resolved =
          target === '' ? 'index.html' : target.endsWith('/') ? `${target}index.html` : target
        expect(known.has(resolved), `${path} links to ${href}`).toBe(true)
        if (hash)
          expect(byPath.get(resolved)!, `${path} links to ${href}`).toContain(`id="${hash}"`)
      }
    }
  })

  it('the home page names the command and lists every component with its description', () => {
    const home = page('index.html')
    expect(home).toContain('npx tessera add Button')
    for (const item of registry().items.filter((i) => i.type === 'component')) {
      expect(home, item.name).toContain(`href="components/${item.name}/"`)
      expect(home, item.name).toContain(escapeHtml(item.description))
    }
  })

  it('a component page says how to add it, what it needs and what it changes in a project', () => {
    const accordion = page('components/Accordion/index.html')
    expect(accordion).toContain('npx tessera add Accordion')
    // It brings AccordionItem along, and the page says so, with a link.
    expect(accordion).toContain('href="../AccordionItem/"')
    expect(accordion).toContain('color.border.default')
    expect(accordion).toContain('Accordion.tess')
    expect(accordion).toContain('0.8.0')
    // A component that imports an npm package names it and its version.
    const withIcon = registry().items.find((i) => i.npm)!
    expect(page(`components/${withIcon.name}/index.html`)).toContain('lucide')
    expect(page(`components/${withIcon.name}/index.html`)).toContain('1.62.0')
  })

  it('a component page shows the contract: variants with their first value as the default, states, slots, events', () => {
    const button = page('components/Button/index.html')
    expect(button).toMatch(/tone[\s\S]*primary[\s\S]*neutral[\s\S]*danger/)
    expect(button).toContain('default')
    expect(button).toContain('focus-visible')
    expect(button).toContain('label content')
    expect(button).toContain('fired on click, Enter, or Space')
  })

  it("shows the component's docs page, with its examples as source", () => {
    const button = page('components/Button/index.html')
    expect(button).toContain('Using Button')
    expect(button).toContain('Say what happens')
    expect(button).toContain('&lt;Button tone=&quot;neutral&quot;')
    expect(button).not.toContain('data-live')
  })

  it('the tokens page lists each set with the command that adds it', () => {
    const tokens = page('tokens/index.html')
    expect(tokens).toContain('npx tessera add tokens:tailwind')
    expect(tokens).toContain('npx tessera add tokens:unstyled')
    expect(tokens).toContain('The default theme of Tailwind CSS as Tessera tokens.')
  })

  it('escapes what a component says about itself, so a registry cannot put markup on the page', () => {
    const dir = scratch()
    const components = join(dir, 'components')
    mkdirSync(components)
    writeFileSync(
      join(components, 'Evil.tess'),
      `<contract>\n{\n  "name": "Evil",\n  "role": "generic",\n  "description": "A <script>alert(1)</script> & \\"thing\\".",\n  "parts": ["root"],\n  "variants": {},\n  "states": [],\n  "slots": {},\n  "events": {}\n}\n</contract>\n<template><div class="root"></div></template>\n`,
    )
    writeFileSync(
      join(components, 'Evil.docs.md'),
      '# Using <b>Evil</b>\n\n<script>alert(2)</script>\n',
    )
    const evil = buildSite(buildRegistry({ uiDir: dir, minTessera: '0.8.0' }))
    for (const { path, content } of evil.filter((f) => f.path.endsWith('.html'))) {
      expect(content, path).not.toContain('<script')
      expect(content, path).not.toContain('<b>Evil')
    }
    expect(evil.find((f) => f.path === 'components/Evil/index.html')!.content).toContain(
      'A &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;thing&quot;.',
    )
  })

  it('works with no components or no token sets', () => {
    const dir = scratch()
    mkdirSync(join(dir, 'components'))
    const empty = buildSite(buildRegistry({ uiDir: dir, minTessera: '0.8.0' }))
    expect(empty.some((f) => f.path === 'index.html')).toBe(true)
    expect(empty.some((f) => f.path === 'tokens/index.html')).toBe(true)
  })

  it('is readable in both color schemes and has a phone layout', () => {
    const home = page('index.html')
    expect(home).toContain('prefers-color-scheme: dark')
    expect(home).toMatch(/@media \(max-width: \d+px\)/)
    expect(home).toContain('color-scheme: light dark')
  })
})

describe('the Tessera UI site: how it is served', () => {
  const headers = page('_headers')

  it('lets any site read the registry, so a browser tool or another site can fetch it', () => {
    for (const path of ['/index.json', '/r/*'])
      expect(headerBlock(headers, path), path).toMatch(/Access-Control-Allow-Origin: \*/)
  })

  it('caches the registry for a short time and the pages for none, so a release shows at once', () => {
    expect(headerBlock(headers, '/r/*')).toMatch(/Cache-Control: public, max-age=\d+/)
    expect(headerBlock(headers, '/index.json')).toMatch(/Cache-Control: public, max-age=\d+/)
    expect(headerBlock(headers, '/*')).toMatch(/Cache-Control: public, max-age=0, must-revalidate/)
  })

  it('tells the browser not to guess types or frame the pages, and sets a policy that blocks scripts', () => {
    const all = headerBlock(headers, '/*')
    expect(all).toMatch(/X-Content-Type-Options: nosniff/)
    expect(all).toMatch(/Content-Security-Policy: [^\n]*default-src 'none'/)
    expect(all).toMatch(/Content-Security-Policy: [^\n]*style-src 'unsafe-inline'/)
    expect(all).toMatch(/Content-Security-Policy: [^\n]*frame-ancestors 'none'/)
  })

  it('replaces the page cache rule for the registry instead of adding to it', () => {
    expect(headerBlock(headers, '/r/*')).toMatch(/^! Cache-Control$/m)
    expect(headerBlock(headers, '/index.json')).toMatch(/^! Cache-Control$/m)
  })

  it('has a Worker config for the assets, no code', () => {
    const config = JSON.parse(
      readFileSync(join(ui, 'wrangler.jsonc'), 'utf8')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/,(\s*[}\]])/g, '$1'),
    ) as Record<string, any>
    expect(config.name).toBe('tessera-ui')
    expect(config.assets.directory).toBe('./dist')
    expect(config.assets.not_found_handling).toBe('404-page')
    expect(config.main).toBeUndefined()
  })
})

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** The lines under one path in a `_headers` file. */
function headerBlock(file: string, path: string): string {
  const lines = file.split('\n')
  const start = lines.findIndex((l) => l === path)
  if (start < 0) throw new Error(`no ${path} in _headers`)
  const block: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (!l.startsWith(' ')) break
    block.push(l.trim())
  }
  return block.join('\n')
}
