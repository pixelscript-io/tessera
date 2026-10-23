import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterAll, describe, expect, it } from 'vitest'
import { exportDocs, serveDocs } from '../src'

// The docs app in a real browser, against a throwaway project inside the kitchen-sink folder (so the runtime and
// the repository's tokens resolve as they do for a real project).
const sink = fileURLToPath(new URL('../../../examples/kitchen-sink', import.meta.url)).replaceAll(
  '\\',
  '/',
)
const scratch = join(sink, '.docs-test')
mkdirSync(scratch, { recursive: true })
const root = mkdtempSync(join(scratch, 'project-')).replaceAll('\\', '/')
const tokens = fileURLToPath(new URL('../../../system/tokens', import.meta.url)).replaceAll(
  '\\',
  '/',
)

const write = (file: string, content: string) => {
  mkdirSync(join(root, file, '..'), { recursive: true })
  writeFileSync(join(root, file), content)
}

const badge = (name: string, description: string) => `<contract>
{
  "name": "${name}",
  "role": "group",
  "description": ${JSON.stringify(description)},
  "parts": ["root"],
  "variants": { "tone": ["info", "warn"] },
  "slots": { "default": "The badge text." }
}
</contract>
<template><span class="root"><slot /></span></template>
<style>
.root { padding: $space.2; }
</style>
`

write('tessera.config.ts', `export default { tokens: ${JSON.stringify(tokens)} }\n`)
write('package.json', '{ "name": "scratch-docs" }\n')
write('app/components/Tag.tess', badge('Tag', 'A tag.'))

let browser: Browser | undefined
const closers: Array<() => Promise<void> | void> = []
afterAll(async () => {
  await browser?.close()
  for (const close of closers) await close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
}

/** A file server that knows nothing about Vite: what any static host does. */
function staticServer(dir: string): Promise<{ url: string; server: Server }> {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!)
    const name = path === '/' ? '/index.html' : path
    try {
      const file = await readFile(join(dir, name))
      res.setHeader('Content-Type', TYPES[extname(name)] ?? 'application/octet-stream')
      res.end(file)
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number }
      resolve({ url: `http://127.0.0.1:${address.port}/`, server })
    }),
  )
}

const report = () => ({ a11y: { generated: [] } })

describe('the docs app', () => {
  it('shows a component added while it runs, with controls, and a .docs.md beside it', async () => {
    const dev = await serveDocs(root, { report, port: 0 })
    closers.push(() => dev.close())
    const url = dev.resolvedUrls!.local[0]!
    browser = await chromium.launch({ channel: 'msedge' })
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(url)
    await page.waitForSelector('.docs-nav a')
    const names = () => page.$$eval('.docs-nav a', (as) => as.map((a) => a.textContent))
    expect(await names()).toContain('Tag')
    expect(await names()).not.toContain('Badge')

    // Add a component: no restart, no other file.
    write('app/components/Badge.tess', badge('Badge', 'A small status label.'))
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.docs-nav a')].some((a) => a.textContent === 'Badge'),
    )
    await page.goto(`${url}#/components/Badge`)
    await page.waitForSelector('.docs-stage > *')
    expect(await page.textContent('main h1')).toBe('Badge')
    expect(await page.textContent('.docs-lead')).toBe('A small status label.')
    // A control for the variant, and the preview follows it.
    const select = page.locator('#ctl-Badge-tone')
    expect(await select.locator('option').allTextContents()).toEqual(['info', 'warn'])
    expect(await page.getAttribute('.docs-stage > *', 'data-tone')).toBe('info')
    await select.selectOption('warn')
    expect(await page.getAttribute('.docs-stage > *', 'data-tone')).toBe('warn')
    await page.fill('#ctl-Badge-slot', 'Hello')
    await page.waitForFunction(() => document.querySelector('.docs-stage')?.textContent === 'Hello')

    // A .docs.md beside the component renders next to the generated sections, and its live example runs.
    write(
      'app/components/Badge.docs.md',
      '# When to use a badge\n\nUse it for **status**.\n\n```tess live\n<template><Badge tone="warn">Beta</Badge></template>\n```\n',
    )
    await page.waitForSelector('.docs-prose h1')
    expect(await page.textContent('.docs-prose h1')).toBe('When to use a badge')
    await page.waitForFunction(() => document.querySelector('.docs-live')?.textContent === 'Beta')
    expect(await page.getAttribute('.docs-live [data-tone]', 'data-tone')).toBe('warn')
    expect(await page.textContent('h2:has-text("Variants") + table')).toContain('info, warn')
    expect(errors).toEqual([])
  }, 90_000)

  it('exports static files that serve from a plain file server', async () => {
    const out = join(scratch, 'out')
    const { files } = await exportDocs(root, out, { report })
    expect(files).toContain('index.html')
    const host = await staticServer(out)
    closers.push(() => new Promise<void>((done) => host.server.close(() => done())))
    const page = await browser!.newPage()
    const failed: string[] = []
    page.on('requestfailed', (r) => failed.push(r.url()))
    page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`))
    await page.goto(host.url)
    await page.waitForSelector('.docs-nav a')
    expect(await page.$$eval('.docs-nav a', (as) => as.map((a) => a.textContent))).toContain(
      'Badge',
    )
    await page.goto(`${host.url}#/components/Badge`)
    await page.waitForSelector('.docs-stage > *')
    expect(await page.getAttribute('.docs-stage > *', 'data-tone')).toBe('info')
    await page.waitForFunction(() => document.querySelector('.docs-live')?.textContent === 'Beta')
    // The theme switcher is there, and the tokens page has values.
    expect(await page.locator('#switch-theme option').allTextContents()).toEqual([
      'default',
      'auto',
      'dark',
    ])
    await page.goto(`${host.url}#/tokens/space`)
    await page.waitForSelector('tbody tr')
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(3)
    expect(failed).toEqual([])
  }, 120_000)
})
