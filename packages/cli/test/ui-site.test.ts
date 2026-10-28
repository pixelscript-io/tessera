import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { buildRegistry, writeRegistry } from '../src/registry/build'
import { openSource } from '../src/registry/source'
import { buildSite, writeSite } from '../src/site/build'
import { highlight } from '../src/site/highlight'

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
  buildRegistry({ uiDir: ui, minTessera: '0.9.0', npmVersions: { lucide: '1.62.0' }, tokenSets })
const components = registry().items.filter((i) => i.type === 'component')

const site = buildSite(registry())
const ASSETS = { script: '/assets/site.js', css: '/assets/site.css' }
const withAssets = buildSite(registry(), { assets: ASSETS })
const byPath = new Map(site.map((f) => [f.path, f.content]))
const page = (path: string): string => {
  const content = byPath.get(path)
  if (content === undefined) throw new Error(`no ${path} in the site`)
  return content
}
const pages = site.filter((f) => f.path.endsWith('.html'))

const unescape = (text: string): string =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
/** The text of the code block that shows a file: the tags that color it removed, the escapes undone. */
function codeOf(html: string, file: string): string {
  const start = html.indexOf(`data-file="${file}"`)
  if (start < 0) throw new Error(`no code block for ${file}`)
  const open = html.indexOf('<code>', start)
  const close = html.indexOf('</code>', open)
  return unescape(html.slice(open + '<code>'.length, close).replace(/<\/?span[^>]*>/g, ''))
}

describe('the Tessera UI site: what it holds', () => {
  it('has a home page, an installation page, a components list, a page for every component, a tokens page and a 404', () => {
    for (const path of ['index.html', 'installation/index.html', 'components/index.html'])
      expect(byPath.has(path), path).toBe(true)
    expect(byPath.has('tokens/index.html')).toBe(true)
    expect(byPath.has('404.html')).toBe(true)
    for (const item of components)
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

describe('the Tessera UI site: every page', () => {
  it('is a whole document with a title, a language, a viewport, one h1 and a skip link', () => {
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

  it('has no link that goes nowhere, and a link to an anchor lands on it', () => {
    const known = new Set(site.map((f) => f.path))
    for (const { path, content } of pages) {
      for (const m of content.matchAll(/\bhref="([^"]+)"/g)) {
        const href = m[1]!
        if (/^(https?:|mailto:|data:)/.test(href)) continue
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

  it('is readable in both color schemes and has a phone layout', () => {
    const home = page('index.html')
    expect(home).toContain('prefers-color-scheme: dark')
    expect(home).toMatch(/@media \(max-width: \d+px\)/)
    expect(home).toContain('color-scheme: light dark')
  })

  it('has the docs layout: a header, a sidebar of every component with the current page marked, and a menu for a phone', () => {
    for (const { path, content } of pages) {
      if (path === '404.html') continue
      expect(content, path).toMatch(/<header class="top">/)
      const sidebar = /<nav class="sidebar" aria-label="Docs">([\s\S]*?)<\/nav>/.exec(content)
      expect(sidebar, path).not.toBeNull()
      expect(sidebar![1], path).toContain('Get started')
      expect(sidebar![1], path).toContain('Components')
      // The link to the page you are on is `./`, so it is found by its name.
      for (const item of components.filter((c) => path !== `components/${c.name}/index.html`))
        expect(sidebar![1], `${path}: ${item.name}`).toMatch(
          new RegExp(`<a [^>]*href="(\\.\\./)*(components/)?${item.name}/"`),
        )
      // One link is the current page, and says so.
      expect(content.match(/<a [^>]*aria-current="page"/g)?.length, path).toBe(1)
      expect(content, path).toMatch(/<details class="menu" open>/)
    }
    const button = page('components/Button/index.html')
    expect(button).toMatch(/<a [^>]*aria-current="page"[^>]*>Button<\/a>/)
  })

  it('lists the components in alphabetical order', () => {
    const sidebar = /<nav class="sidebar" aria-label="Docs">([\s\S]*?)<\/nav>/.exec(
      page('index.html'),
    )![1]!
    const names = [...sidebar.matchAll(/href="components\/([A-Za-z]+)\/"/g)].map((m) => m[1])
    expect(names).toEqual([...names].sort((a, b) => a!.localeCompare(b!)))
    expect(names).toHaveLength(components.length)
  })

  it('has no script and no outside resource when no bundle is given', () => {
    for (const { path, content } of pages) {
      expect(content, path).not.toMatch(/<script/i)
      expect(content, path).not.toMatch(/<link[^>]+rel="stylesheet"/i)
      expect(content, path).not.toMatch(/\b(src|srcset|poster|data)="/)
      expect(content, path).not.toMatch(/url\(\s*['"]?(https?:)?\/\//)
    }
  })

  it('with a bundle, loads that one script and style sheet from this site and nothing else', () => {
    for (const { path, content } of withAssets.filter((f) => f.path.endsWith('.html'))) {
      expect(content.match(/<script[^>]*>/g), path).toEqual([
        '<script type="module" src="/assets/site.js">',
      ])
      expect(content, path).toContain('<link rel="stylesheet" href="/assets/site.css">')
      expect(content, path).not.toMatch(/<script[^>]*>[^<]+<\/script>/)
      expect(content.match(/\bsrc="[^"]*"/g), path).toEqual(['src="/assets/site.js"'])
    }
  })

  it('sets the design system theme to follow the reader’s scheme, so the previews match the page', () => {
    expect(page('components/Button/index.html')).toMatch(/<html lang="en" data-theme="auto"/)
  })

  it('escapes what a component says about itself, so a registry cannot put markup on the page', () => {
    const dir = scratch()
    const folder = join(dir, 'components')
    mkdirSync(folder)
    writeFileSync(
      join(folder, 'Evil.tess'),
      `<contract>\n{\n  "name": "Evil",\n  "role": "generic",\n  "description": "A <script>alert(1)</script> & \\"thing\\".",\n  "parts": ["root"],\n  "variants": {},\n  "states": [],\n  "slots": {},\n  "events": {}\n}\n</contract>\n<template><div class="root"></div></template>\n`,
    )
    writeFileSync(
      join(folder, 'Evil.docs.md'),
      '# Using <b>Evil</b>\n\n<script>alert(2)</script>\n\n```tess live\n<template><i onclick="alert(3)">x</i></template>\n```\n',
    )
    const evil = buildSite(buildRegistry({ uiDir: dir, minTessera: '0.9.0' }))
    for (const { path, content } of evil.filter((f) => f.path.endsWith('.html'))) {
      expect(content, path).not.toContain('<script')
      expect(content, path).not.toContain('<b>Evil')
      expect(content, path).not.toContain('<i onclick')
    }
    expect(evil.find((f) => f.path === 'components/Evil/index.html')!.content).toContain(
      'A &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;thing&quot;.',
    )
  })

  it('works with no components or no token sets', () => {
    const dir = scratch()
    mkdirSync(join(dir, 'components'))
    const empty = buildSite(buildRegistry({ uiDir: dir, minTessera: '0.9.0' }))
    for (const path of ['index.html', 'tokens/index.html', 'components/index.html'])
      expect(
        empty.some((f) => f.path === path),
        path,
      ).toBe(true)
  })
})

describe('the Tessera UI site: the home, installation and component list pages', () => {
  it('the home page says what Tessera UI is and where to start', () => {
    const home = page('index.html')
    expect(home).toContain('<h1>Introduction</h1>')
    expect(home).toContain('href="installation/"')
    expect(home).toContain('href="components/"')
  })

  it('the installation page shows the steps, with the command for each package manager', () => {
    const install = page('installation/index.html')
    expect(install).toContain('npm create @pixelscriptio/tessera@latest')
    expect(install).toContain('npx @pixelscriptio/tessera add Button')
    expect(install).toContain('tessera.lock.json')
    expect(install).toContain('--fit add')
  })

  it('the components page lists every component with its description', () => {
    const list = page('components/index.html')
    for (const item of components) {
      expect(list, item.name).toContain(`href="${item.name}/"`)
      expect(list, item.name).toContain(escapeHtml(item.description))
    }
  })

  it('the tokens page lists each set with the command that adds it', () => {
    const tokens = page('tokens/index.html')
    expect(tokens).toContain('npx @pixelscriptio/tessera add tokens:tailwind')
    expect(tokens).toContain('npx @pixelscriptio/tessera add tokens:unstyled')
    expect(tokens).toContain('The default theme of Tailwind CSS as Tessera tokens.')
  })
})

describe('the Tessera UI site: a component page', () => {
  it('opens with the name, the description and a preview that has a Preview and a Code tab', () => {
    const button = page('components/Button/index.html')
    expect(button).toContain('<h1>Button</h1>')
    expect(button).toContain('Triggers an action.')
    expect(button).toMatch(
      /<div class="tabs example"[\s\S]*?>Preview<\/label>[\s\S]*?>Code<\/label>/,
    )
    expect(button).toContain('data-live="Button-0"')
  })

  it('shows a preview of every component, so a page is never only words', () => {
    for (const item of components)
      expect(page(`components/${item.name}/index.html`), item.name).toContain(
        `data-live="${item.name}-0"`,
      )
  })

  it('the code tab of an example is the whole example, as written', () => {
    const live = /```tess live\n([\s\S]*?)```/.exec(
      readFileSync(join(ui, 'components', 'Dialog.docs.md'), 'utf8'),
    )![1]!
    expect(codeOf(page('components/Dialog/index.html'), 'Dialog-0.tess')).toBe(live)
  })

  it('shows the whole source of the component, in the manual steps and in the registry file', () => {
    const button = page('components/Button/index.html')
    const source = readFileSync(join(ui, 'components', 'Button.tess'), 'utf8')
    expect(codeOf(button, 'system/components/Button.tess')).toBe(source)
    expect(button).toContain('Copy and paste')
  })

  it('shows every file a component copies, the scripts it imports included', () => {
    const icon = page('components/Icon/index.html')
    expect(codeOf(icon, 'system/components/icons.ts')).toBe(
      readFileSync(join(ui, 'components', 'icons.ts'), 'utf8'),
    )
  })

  it('has install tabs: the command for each package manager, and the manual way', () => {
    const accordion = page('components/Accordion/index.html')
    expect(accordion).toContain('npx @pixelscriptio/tessera add Accordion')
    expect(accordion).toContain('pnpm exec tessera add Accordion')
    expect(accordion).toContain('yarn tessera add Accordion')
    expect(accordion).toContain('bunx @pixelscriptio/tessera add Accordion')
    expect(accordion).toMatch(/>CLI<\/label>[\s\S]*?>Manual<\/label>/)
  })

  it('says what it needs and brings along, with links', () => {
    const accordion = page('components/Accordion/index.html')
    expect(accordion).toContain('href="../AccordionItem/"')
    expect(accordion).toContain('color.border.default')
    expect(accordion).toContain('0.9.0')
    const withIcon = registry().items.find((i) => i.npm)!
    const text = page(`components/${withIcon.name}/index.html`)
    expect(text).toContain('npm install lucide@1.62.0')
  })

  it('shows the contract as tables: variants with the default marked, states, slots and events', () => {
    const button = page('components/Button/index.html')
    expect(button).toMatch(/id="api"/)
    expect(button).toMatch(/tone[\s\S]*primary[\s\S]*neutral[\s\S]*danger/)
    expect(button).toContain('default')
    expect(button).toContain('focus-visible')
    expect(button).toContain('label content')
    expect(button).toContain('fired on click, Enter, or Space')
  })

  it('shows the guidance of the docs page, with the examples as previews with code', () => {
    const button = page('components/Button/index.html')
    expect(button).toContain('Say what happens')
    expect(button).toContain('id="usage"')
    // Docs headings sit below the page's own, and no example is left as a bare placeholder.
    expect(button).not.toContain('class="docs-live"')
    expect(button.match(/data-live="Button-0"/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('has the page’s sections on the right, and each one is on the page', () => {
    const button = page('components/Button/index.html')
    const toc = /<nav class="toc" aria-label="On this page">([\s\S]*?)<\/nav>/.exec(button)!
    for (const id of ['installation', 'usage', 'api']) expect(toc[1], id).toContain(`href="#${id}"`)
  })

  it('links to the component before and after it', () => {
    const names = components.map((c) => c.name).sort((a, b) => a.localeCompare(b))
    const first = page(`components/${names[0]}/index.html`)
    const second = page(`components/${names[1]}/index.html`)
    expect(first).not.toContain('rel="prev"')
    expect(first).toContain(`rel="next" href="../${names[1]}/"`)
    expect(second).toContain(`rel="prev" href="../${names[0]}/"`)
  })
})

describe('highlighting', () => {
  it('gives the source back when the tags are removed and the escapes undone', () => {
    for (const item of components)
      for (const file of item.files.filter((f) => /\.(tess|ts)$/.test(f.path))) {
        const html = highlight(file.content, file.path.endsWith('.ts') ? 'ts' : 'tess')
        expect(unescape(html.replace(/<\/?span[^>]*>/g, '')), file.path).toBe(file.content)
      }
  })

  it('colors comments, strings, tags, attributes, token references and keywords', () => {
    const html = highlight(
      '<!-- note -->\n<Button tone="danger" :open="x">$space.4</Button>\nconst a = 1 // c',
      'tess',
    )
    expect(html).toContain('<span class="tk-c">&lt;!-- note --&gt;</span>')
    expect(html).toContain('<span class="tk-t">&lt;Button</span>')
    expect(html).toContain('<span class="tk-a">tone</span>')
    expect(html).toContain('<span class="tk-s">&quot;danger&quot;</span>')
    expect(html).toContain('<span class="tk-a">:open</span>')
    expect(html).toContain('<span class="tk-v">$space.4</span>')
    expect(html).toContain('<span class="tk-k">const</span>')
    expect(html).toContain('<span class="tk-c">// c</span>')
  })

  it('only escapes what it does not know', () => {
    expect(highlight('npx tessera add <Button> & more', 'bash')).toBe(
      'npx tessera add &lt;Button&gt; &amp; more',
    )
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

  it('caches the bundle for a year, since its file names carry a hash', () => {
    expect(headerBlock(headers, '/assets/chunks/*')).toMatch(/max-age=31536000, immutable/)
  })

  it('replaces the page cache rule instead of adding to it', () => {
    for (const path of ['/r/*', '/index.json', '/assets/chunks/*'])
      expect(headerBlock(headers, path), path).toMatch(/^! Cache-Control$/m)
  })

  it('tells the browser not to guess types or frame the pages, and allows only this site’s scripts and styles', () => {
    const all = headerBlock(headers, '/*')
    expect(all).toMatch(/X-Content-Type-Options: nosniff/)
    expect(all).toMatch(/Content-Security-Policy: [^\n]*default-src 'none'/)
    expect(all).toMatch(/Content-Security-Policy: [^\n]*script-src 'self'/)
    expect(all).toMatch(/Content-Security-Policy: [^\n]*style-src 'self' 'unsafe-inline'/)
    expect(all).toMatch(/Content-Security-Policy: [^\n]*frame-ancestors 'none'/)
    expect(all).not.toMatch(/unsafe-eval/)
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
