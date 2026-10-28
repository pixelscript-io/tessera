import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import { presetFiles } from '../src/commands/init'
import type { Io } from '../src/io'

// An app built with --prerender: the pages as HTML with their content, title and styles, working with and without
// JavaScript, in a real browser, from a file server that knows nothing about Tessera.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-prerender')
const axeSource = readFileSync(
  createRequire(join(repo, 'website/package.json')).resolve('axe-core'),
  'utf8',
)

let root: string
let dist: string
let plain = ''
let styled = ''
let browser: Browser | undefined
const closers: Array<() => Promise<void> | void> = []

const write = (file: string, text: string) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

beforeAll(async () => {
  mkdirSync(scratch, { recursive: true })
  root = mkdtempSync(join(scratch, 'p-')).replaceAll('\\', '/')
  writeFileSync(
    join(root, 'package.json'),
    '{ "name": "site", "dependencies": { "@pixelscriptio/tessera-ui": "*" } }\n',
  )
  for (const [file, content] of Object.entries(presetFiles('tailwind'))) write(file, content)
  write(
    'app/pages/about.tess',
    '<page>\n{ "title": "About us" }\n</page>\n<template><main><h1>About</h1><p>We make <b>things</b> & "stuff".</p><Link href="/">Home</Link></main></template>\n',
  )
  write('app/pages/blog/[slug].tess', '<template><main><h1>Post</h1></main></template>\n')
  // A page whose script needs a browser: it is skipped, and still works as before.
  write(
    'app/pages/wide.tess',
    '<script>\nconst width = window.innerWidth\n</script>\n<template><main><h1>Wide</h1><p>{width}</p></main></template>\n',
  )
  dist = join(root, 'dist').replaceAll('\\', '/')
  const run = async (...argv: string[]) => {
    let out = ''
    const io: Io = { cwd: root, out: (t) => void (out += t + '\n'), err: () => {} }
    const code = await main(argv, io)
    return { code, out }
  }
  const first = await run('build', '--prerender')
  expect(first.code).toBe(0)
  plain = first.out
  // A second run in a terminal shows the same thing with a look.
  const ui = (await import('../src/ui')).createUi({ color: false, unicode: true, width: 100 })
  let out = ''
  await main(['build', '--prerender'], {
    cwd: root,
    ui,
    out: (t) => void (out += t + '\n'),
    err: () => {},
  })
  styled = out
}, 300_000)

afterAll(async () => {
  await browser?.close()
  for (const close of closers) await close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})

const read = (file: string) => readFileSync(join(dist, file), 'utf8')

describe('tessera build --prerender', () => {
  it('writes a page for each route without parameters, and the not-found page', () => {
    for (const file of ['index.html', 'about/index.html', '404.html'])
      expect(existsSync(join(dist, file)), file).toBe(true)
    // Not for a route with a parameter, and not for the one that needs a browser.
    expect(existsSync(join(dist, 'blog'))).toBe(false)
    expect(existsSync(join(dist, 'wide'))).toBe(false)
    // The build's manifest was only for this step.
    expect(existsSync(join(dist, '.vite'))).toBe(false)
  })

  it('says what it did, and what it did not and why', () => {
    expect(plain).toContain('Prerendered 3 pages: /, /about, 404.html')
    expect(plain).toContain(
      '/blog/:slug was not prerendered: it has parameters (:slug), so there is no one page to render.',
    )
    expect(plain).toMatch(/\/wide was not prerendered: window is not defined\./)
    expect(styled).toContain('✓ Prerendered 3 pages')
    expect(styled).toContain('! /blog/:slug was not prerendered')
  })

  it('has the content, the title and the styles in the HTML, and the live script after them', () => {
    const about = read('about/index.html')
    expect(about).toContain('<title>About us</title>')
    expect(about).toContain('<h1>About</h1>')
    // Text is escaped; markup in the page is kept.
    expect(about).toContain('We make <b>things</b> &amp; "stuff".')
    expect(about).toContain('<link rel="stylesheet"')
    expect(about).toContain('<script type="module"')
    expect(about).toContain('<div id="app" data-prerendered>')
    // The layout and its components are in it: it is the whole page, not just the body.
    expect(about).toContain('t-layout-default__header')
    expect(about).toContain('t-Button__root')
    // The home page has its own, and the not-found page says so.
    expect(read('index.html')).toContain('Build interfaces from a system you can trust')
    expect(read('index.html')).toContain('<title>Welcome to Tessera</title>')
    expect(read('404.html')).toContain('<title>Page not found</title>')
    expect(read('404.html')).toContain('Page not found')
  })

  it('writes one extra file only with the flag', async () => {
    // Without it the build is what it always was: index.html is the empty shell.
    const dir = mkdtempSync(join(scratch, 'q-')).replaceAll('\\', '/')
    writeFileSync(
      join(dir, 'package.json'),
      '{ "name": "plain", "dependencies": { "@pixelscriptio/tessera-ui": "*" } }\n',
    )
    for (const [file, content] of Object.entries(presetFiles('tailwind'))) {
      mkdirSync(dirname(join(dir, file)), { recursive: true })
      writeFileSync(join(dir, file), content)
    }
    const code = await main(['build'], { cwd: dir, out: () => {}, err: () => {} })
    expect(code).toBe(0)
    expect(readFileSync(join(dir, 'dist/index.html'), 'utf8')).toContain('<div id="app"></div>')
    expect(existsSync(join(dir, 'dist/404.html'))).toBe(false)
  }, 120_000)
})

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
}

/** A static host: a path with no file is its folder's index.html, as GitHub Pages and Netlify serve it. */
function serve(): Promise<string> {
  const server: Server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/\/$/, '')
    const candidates = [path, `${path}/index.html`]
    for (const candidate of candidates) {
      try {
        const file = await readFile(join(dist, candidate))
        if (!extname(candidate)) continue
        res.setHeader('Content-Type', TYPES[extname(candidate)] ?? 'application/octet-stream')
        res.end(file)
        return
      } catch {
        /* next */
      }
    }
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/html')
    res.end(await readFile(join(dist, '404.html')))
  })
  closers.push(() => new Promise<void>((done) => server.close(() => done())))
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
    }),
  )
}

async function open(url: string, javaScript: boolean): Promise<{ page: Page; errors: string[] }> {
  browser ??= await chromium.launch({ channel: 'msedge' })
  const context = await browser.newContext({ javaScriptEnabled: javaScript })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on(
    'console',
    (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()),
  )
  await page.goto(url)
  return { page, errors }
}

describe('a prerendered app in a browser', () => {
  it('shows its content and styles with JavaScript turned off', async () => {
    const base = await serve()
    const { page } = await open(`${base}/about`, false)
    expect(await page.title()).toBe('About us')
    expect(await page.locator('h1').textContent()).toBe('About')
    expect(await page.locator('main p').textContent()).toBe('We make things & "stuff".')
    // The styles are applied: the layout's header has its border and the page its own background.
    expect(
      await page.locator('header').evaluate((e) => getComputedStyle(e).borderBottomWidth),
    ).toBe('1px')
    expect(await page.locator('body').evaluate((e) => getComputedStyle(e).margin)).toBe('0px')
    // The links are real links to the real pages.
    expect(await page.locator('main a').getAttribute('href')).toBe('/')
    await page.context().close()
  }, 120_000)

  it('shows the home page and the not-found page the same way, and a missing page is a 404', async () => {
    const base = await serve()
    const home = await open(`${base}/`, false)
    expect(await home.page.locator('h1').textContent()).toBe(
      'Build interfaces from a system you can trust',
    )
    await home.page.context().close()
    const missing = await open(`${base}/nowhere`, false)
    expect(await missing.page.locator('h1').textContent()).toBe('Page not found')
    await missing.page.context().close()
  }, 120_000)

  it('replaces the content with the live page when the script loads, without duplicating it', async () => {
    const base = await serve()
    const { page, errors } = await open(`${base}/about`, true)
    await page.waitForFunction(
      () => !document.getElementById('app')?.hasAttribute('data-prerendered'),
    )
    expect(await page.locator('h1').count()).toBe(1)
    expect(await page.locator('header').count()).toBe(1)
    expect(await page.title()).toBe('About us')
    // It is alive: the link navigates without reloading, and the page it shows is the home page.
    await page.evaluate(() => ((window as any).marker = 'same page'))
    await page.locator('main a').click()
    await page.waitForFunction(() =>
      document.querySelector('h1')?.textContent?.includes('Build interfaces'),
    )
    expect(await page.evaluate(() => (window as any).marker)).toBe('same page')
    // The page that needs a browser works, because it was only skipped.
    await page.goto(`${base}/wide`)
    await page.waitForSelector('main h1')
    expect(await page.locator('main p').textContent()).toMatch(/^\d+$/)
    expect(errors).toEqual([])
    await page.context().close()
  }, 120_000)

  it('is accessible as prerendered, in light and dark', async () => {
    const base = await serve()
    const { page } = await open(`${base}/about`, false)
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'auto'))
      await page.waitForTimeout(400)
      await page.addScriptTag({ content: axeSource })
    }
    await page.context().close()
    // Scripts are off in that context, so axe runs in one that has them.
    const live = await open(`${base}/about`, true)
    await live.page.waitForFunction(
      () => !document.getElementById('app')?.hasAttribute('data-prerendered'),
    )
    for (const scheme of ['light', 'dark'] as const) {
      await live.page.emulateMedia({ colorScheme: scheme })
      await live.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'auto'))
      await live.page.waitForTimeout(400)
      await live.page.evaluate(axeSource)
      const violations = (await live.page.evaluate(() =>
        (window as any).axe
          .run(document, { resultTypes: ['violations'] })
          .then((r: any) =>
            r.violations
              .filter((v: any) => v.impact === 'serious' || v.impact === 'critical')
              .map((v: any) => v.id),
          ),
      )) as string[]
      expect(violations, scheme).toEqual([])
    }
    await live.page.context().close()
  }, 120_000)
})
