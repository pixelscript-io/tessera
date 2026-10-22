import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { build, createServer } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'
import { findCheckout } from '../src/commands/init'
import { read, run } from './helpers'

const made: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-init-'))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('tessera init: what it writes', () => {
  it('scaffolds the project the spec lists', async () => {
    const dir = scratch()
    const { code, out } = await run(dir, 'init', 'my-app')
    expect(code).toBe(0)
    expect(out).toContain('Created a Tessera project in my-app.')
    expect(out).toContain('pnpm install')
    const root = join(dir, 'my-app')
    for (const file of [
      'package.json',
      'vite.config.ts',
      'index.html',
      'tsconfig.json',
      'tessera.config.ts',
      '.gitignore',
      'system/tokens/base.tokens.json',
      'system/tokens/themes/dark.tokens.json',
      'system/tokens/themes/compact.tokens.json',
      'system/components/Button.tess',
      'app/main.ts',
      'app/layouts/default.tess',
      'app/pages/index.tess',
    ]) {
      expect(existsSync(join(root, file)), file).toBe(true)
    }
    const manifest = JSON.parse(read(root, 'package.json'))
    expect(manifest.name).toBe('my-app')
    expect(manifest.dependencies['@tessera/core']).toMatch(/^link:/)
  })

  it('initialises the current folder when given none', async () => {
    const dir = scratch()
    const { out } = await run(dir, 'init')
    expect(out).toContain('Created a Tessera project in the current folder.')
    expect(existsSync(join(dir, 'app/pages/index.tess'))).toBe(true)
  })

  it('refuses a folder that already has a project, and changes nothing', async () => {
    const dir = scratch()
    await run(dir, 'init')
    const before = read(dir, 'app/pages/index.tess')
    const { code, err } = await run(dir, 'init')
    expect(code).toBe(1)
    expect(err).toContain('This folder already has package.json, app, system, vite.config.ts.')
    expect(read(dir, 'app/pages/index.tess')).toBe(before)
  })

  it('finds the checkout it runs from', () => {
    expect(findCheckout()).toBeDefined()
    expect(findCheckout(tmpdir())).toBeUndefined()
  })

  it('produces a project that passes tessera check', async () => {
    const dir = scratch()
    await run(dir, 'init', 'app')
    const { code, out } = await run(join(dir, 'app'), 'check')
    expect(out).toContain('0 errors, 0 warnings in 3 files.')
    expect(code).toBe(0)
  })
})

describe('tessera init: the project runs', () => {
  let root: string

  it('installs, serves the index page at /, and the page is live', async () => {
    const dir = scratch()
    await run(dir, 'init', 'app')
    root = join(dir, 'app')
    execSync('npx --yes pnpm@10 install --offline', { cwd: root, stdio: 'pipe' })

    const server = await createServer({
      root,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
    })
    await server.listen()
    const url = server.resolvedUrls!.local[0]!
    const browser = await chromium.launch({ channel: 'msedge' })
    try {
      const page = await browser.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(url)
      await page.waitForSelector('h1')
      expect(await page.textContent('h1')).toBe('Welcome to Tessera')
      expect(await page.title()).toBe('Welcome')
      // The default layout is around the page, and the Button (a system component, never imported) works.
      expect(await page.textContent('body')).toContain('My Tessera app')
      const button = page.getByRole('button')
      expect(await button.textContent()).toContain('Clicked 0 times')
      await button.click()
      expect(await button.textContent()).toContain('Clicked 1 times')
      expect(errors).toEqual([])

      // A path with no page shows the router's not-found page; the server falls back to index.html.
      await page.goto(`${url}nowhere`)
      await page.waitForSelector('h1')
      expect(await page.textContent('h1')).toBe('Page not found')
    } finally {
      await browser.close()
      await server.close()
    }
  }, 180_000)

  it('builds for production', async () => {
    const result = await build({ root, logLevel: 'silent', build: { write: false } })
    const outputs = (Array.isArray(result) ? result : [result as never]).flatMap(
      (o: { output: Array<{ fileName: string }> }) => o.output,
    )
    expect(outputs.some((o) => o.fileName === 'index.html')).toBe(true)
    expect(outputs.filter((o) => o.fileName.endsWith('.js')).length).toBeGreaterThan(1)
  }, 120_000)
})

describe('create-tessera', () => {
  it('is tessera init, run from its own entry point', () => {
    const dir = scratch()
    const bin = fileURLToPath(
      new URL('../../create-tessera/bin/create-tessera.js', import.meta.url),
    )
    const out = execFileSync('node', [bin, 'site'], { cwd: dir, encoding: 'utf8' })
    expect(out).toContain('Created a Tessera project in site.')
    expect(readFileSync(join(dir, 'site', 'app', 'pages', 'index.tess'), 'utf8')).toContain(
      'Welcome to Tessera',
    )
  })
})
