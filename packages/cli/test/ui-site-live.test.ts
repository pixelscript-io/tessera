import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildRegistry } from '../src/registry/build'
import { buildSite, writeSite } from '../src/site/build'
import { buildLive } from '../src/site/live'

// The real thing: the site is built with its bundle, served from a folder, and opened in a browser, because what
// matters is that the previews run, which a string check of the pages cannot say.
const ui = fileURLToPath(new URL('../../ui', import.meta.url))

const registry = buildRegistry({
  uiDir: ui,
  minTessera: '0.9.0',
  npmVersions: { lucide: '1.62.0' },
})
const components = registry.items.filter((i) => i.type === 'component').map((i) => i.name)

let out: string
let server: Server
let base: string
let browser: Browser
const work = join(ui, '.site-test')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
}

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'tessera-site-live-'))
  writeSite(
    buildSite(registry, { assets: { script: '/assets/site.js', css: '/assets/site.css' } }),
    out,
  )
  await buildLive(registry, {
    workDir: work,
    outDir: join(out, 'assets'),
    tokensDir: join(ui, 'systems', 'tessera', 'tokens'),
  })
  server = createServer((request, response) => {
    let path = decodeURIComponent((request.url ?? '/').split('?')[0]!)
    if (path.endsWith('/')) path += 'index.html'
    const file = join(out, path)
    if (!file.startsWith(out) || !existsSync(file)) {
      response.writeHead(404).end('not found')
      return
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain' })
    response.end(readFileSync(file))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  browser = await chromium.launch({ channel: 'msedge' })
}, 240_000)

afterAll(async () => {
  await browser?.close()
  server?.close()
  rmSync(out, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
})

describe('the Tessera UI bundle', () => {
  it('is a script, a style sheet and hashed chunks, where the pages and headers expect them', () => {
    expect(existsSync(join(out, 'assets', 'site.js'))).toBe(true)
    expect(existsSync(join(out, 'assets', 'site.css'))).toBe(true)
    expect(readdirSync(join(out, 'assets', 'chunks')).length).toBeGreaterThan(0)
  })

  it('is built for a project with no config, from the components as the registry has them', () => {
    expect(existsSync(join(work, 'system', 'components', 'Button.tess'))).toBe(true)
    expect(existsSync(join(work, 'pages', 'Button-0.tess'))).toBe(true)
  })
})

describe('the Tessera UI site in a browser', () => {
  it('runs the preview of every component, with nothing wrong in the console', async () => {
    const context = await browser.newContext()
    const problems: string[] = []
    for (const name of components) {
      const page = await context.newPage()
      page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`))
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`${name}: ${m.text()}`)
      })
      await page.goto(`${base}/components/${name}/`)
      await page.waitForFunction(
        (n) => {
          const live = document.querySelector(`[data-live="${n}-0"]`)
          return !!live && live.querySelector(':not(.nojs)') !== null
        },
        name,
        { timeout: 15_000 },
      )
      await page.close()
    }
    await context.close()
    expect(problems).toEqual([])
  }, 240_000)

  it('has a preview that works: a dialog opens from its button', async () => {
    const page = await browser.newPage()
    await page.goto(`${base}/components/Dialog/`)
    await page.getByRole('button', { name: 'Delete project' }).first().click()
    await expect(page.getByRole('dialog').first().isVisible()).resolves.toBe(true)
    await page.close()
  })

  it('switches between Preview and Code, and the code is the whole example', async () => {
    const page = await browser.newPage()
    await page.goto(`${base}/components/Button/`)
    const block = page.locator('.tabs.example').first()
    await expect(block.locator('.stage').isVisible()).resolves.toBe(true)
    await expect(block.locator('pre').isVisible()).resolves.toBe(false)
    await block.getByText('Code', { exact: true }).click()
    await expect(block.locator('pre').isVisible()).resolves.toBe(true)
    await expect(block.locator('.stage').isVisible()).resolves.toBe(false)
    expect(await block.locator('pre').innerText()).toContain('<Button')
    await page.close()
  })

  it('shows a copy button on code, which copies it', async () => {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    await page.goto(`${base}/components/Button/`)
    const copy = page.locator('button.copy').first()
    await copy.waitFor({ state: 'attached' })
    await page.locator('.tabs.example').first().getByText('Code', { exact: true }).click()
    await copy.click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('<Button')
    await context.close()
  })

  it('works with no script: the tabs still switch, and the code can be read', async () => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(`${base}/components/Button/`)
    const block = page.locator('.tabs.example').first()
    await block.getByText('Code', { exact: true }).click()
    await expect(block.locator('pre').isVisible()).resolves.toBe(true)
    await context.close()
  })

  it('follows the reader’s color scheme: the preview stage is dark in a dark scheme', async () => {
    const lightContext = await browser.newContext({ colorScheme: 'light' })
    const darkContext = await browser.newContext({ colorScheme: 'dark' })
    const stage = async (context: typeof lightContext) => {
      const page = await context.newPage()
      await page.goto(`${base}/components/Button/`)
      await page.waitForSelector('[data-live="Button-0"] button')
      return page
        .locator('.stage')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor)
    }
    const [light, dark] = [await stage(lightContext), await stage(darkContext)]
    const channel = (css: string) => Number(/\d+/.exec(css)![0])
    expect(channel(light)).toBeGreaterThan(200)
    expect(channel(dark)).toBeLessThan(80)
    await lightContext.close()
    await darkContext.close()
  })

  it('fits a phone: nothing scrolls sideways, and the menu is folded away', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 } })
    const page = await context.newPage()
    for (const name of ['Button', 'Combobox', 'Icon']) {
      await page.goto(`${base}/components/${name}/`)
      await page.waitForSelector(`[data-live="${name}-0"] *`)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        name,
      ).toBeLessThanOrEqual(1)
    }
    expect(
      await page.locator('details.menu').evaluate((el) => (el as HTMLDetailsElement).open),
    ).toBe(false)
    await context.close()
  })

  it('has no serious accessibility problem on its pages, in either color scheme, on a computer or a phone', async () => {
    const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
    const problems: string[] = []
    const paths = [
      '/',
      '/installation/',
      '/components/',
      '/tokens/',
      '/components/Button/',
      '/components/Dialog/',
      '/components/Select/',
      '/components/Icon/',
      '/components/Accordion/',
    ]
    for (const [scheme, width] of [
      ['light', 1280],
      ['dark', 1280],
      ['light', 390],
    ] as const) {
      const context = await browser.newContext({
        colorScheme: scheme,
        viewport: { width, height: 900 },
      })
      const page = await context.newPage()
      for (const path of paths) {
        await page.goto(`${base}${path}`)
        const name = /components\/(\w+)/.exec(path)?.[1]
        if (name) await page.waitForSelector(`[data-live="${name}-0"] *`)
        await page.addScriptTag({ content: axe })
        const result = await page.evaluate(() =>
          (
            window as unknown as {
              axe: {
                run: () => Promise<{
                  violations: Array<{ id: string; impact: string; nodes: unknown[] }>
                }>
              }
            }
          ).axe.run(),
        )
        for (const v of result.violations)
          if (v.impact === 'serious' || v.impact === 'critical')
            problems.push(`${scheme} ${width} ${path}: ${v.id} (${v.nodes.length})`)
      }
      await context.close()
    }
    expect(problems).toEqual([])
  }, 240_000)

  it('shows every value of a variant as a running component', async () => {
    const page = await browser.newPage()
    await page.goto(`${base}/components/Button/`)
    const tone = page.locator('[data-live="Button-variant-tone"]').first()
    await tone.locator('button').first().waitFor()
    expect(await tone.locator('button').count()).toBe(3)
    const texts = await tone.locator('figcaption').allInnerTexts()
    expect(texts).toEqual(['primary', 'neutral', 'danger'])
    const sizes = await page
      .locator('[data-live="Button-variant-size"] button')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.size))
    expect(sizes).toEqual(['sm', 'md', 'lg'])
    await page.close()
  })

  it('searches: it opens from the header or a key, finds a component by name or word, and goes to it', async () => {
    const page = await browser.newPage()
    await page.goto(`${base}/`)
    const open = page.getByRole('button', { name: 'Search the docs' })
    await open.waitFor()
    await open.click()
    const box = page.getByRole('searchbox', { name: 'Search' })
    await box.fill('dial')
    const first = page.locator('dialog.search-dialog a').first()
    await first.waitFor()
    expect(await first.innerText()).toContain('Dialog')
    // A word from the contract, not the name.
    await box.fill('danger')
    await page.locator('dialog.search-dialog a', { hasText: 'Button' }).first().waitFor()
    // Nothing matches: it says so.
    await box.fill('zzzzzz')
    await page.getByText('No results').waitFor()
    // Escape closes it, and a key opens it again.
    await page.keyboard.press('Escape')
    expect(
      await page.locator('dialog.search-dialog').evaluate((d) => (d as HTMLDialogElement).open),
    ).toBe(false)
    await page.keyboard.press('Control+k')
    await box.fill('toolt')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForURL('**/components/Tooltip/')
    await page.close()
  })

  it('changes theme from the header, remembers it, and the previews follow', async () => {
    const context = await browser.newContext({ colorScheme: 'light' })
    const page = await context.newPage()
    await page.goto(`${base}/components/Button/`)
    const toggle = page.getByRole('button', { name: /^Theme/ })
    await toggle.waitFor()
    const html = page.locator('html')
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const stage = () =>
      page
        .locator('.stage')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor)
    const lightness = (css: string) => Number(/\d+/.exec(css)![0])
    expect(await html.getAttribute('data-theme')).toBe('auto')
    await toggle.click() // light
    expect(await html.getAttribute('data-theme')).toBe('light')
    await toggle.click() // dark
    expect(await html.getAttribute('data-theme')).toBe('dark')
    expect(lightness(await background())).toBeLessThan(80)
    expect(lightness(await stage())).toBeLessThan(80)
    // It is kept: a new page starts dark, before the bundle has run.
    await page.goto(`${base}/components/Select/`)
    expect(await html.getAttribute('data-theme')).toBe('dark')
    await page.getByRole('button', { name: /^Theme/ }).click() // auto again
    expect(await html.getAttribute('data-theme')).toBe('auto')
    expect(await page.evaluate(() => localStorage.getItem('tessera-ui-theme'))).toBeNull()
    await context.close()
  })

  it('has the docs layout on a computer: the sidebar and the page’s sections beside the content', async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
    const page = await context.newPage()
    await page.goto(`${base}/components/Button/`)
    const sidebar = await page.locator('nav.sidebar').boundingBox()
    const main = await page.locator('main').boundingBox()
    const toc = await page.locator('nav.toc').boundingBox()
    expect(sidebar!.x + sidebar!.width).toBeLessThanOrEqual(main!.x)
    expect(main!.x + main!.width).toBeLessThanOrEqual(toc!.x)
    expect(await page.locator('details.menu > summary').isVisible()).toBe(false)
    await context.close()
  })
})
