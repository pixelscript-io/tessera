import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, describe, expect, it } from 'vitest'
import { presetFiles } from '../../cli/src/commands/init'
import { serveDocs } from '../src'

// The layout of the generated docs, which follows Tessera UI: a centered page, a sidebar on the left, the contents of
// the page on the right, and an example with Preview and Code tabs whose controls sit under the stage.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-layout')
mkdirSync(scratch, { recursive: true })

let browser: Browser | undefined
const closers: Array<() => Promise<void> | void> = []
afterAll(async () => {
  await browser?.close()
  for (const close of closers) await close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})

async function open(hash: string, width = 1440): Promise<Page> {
  const root = mkdtempSync(join(scratch, 'p-')).replaceAll('\\', '/')
  writeFileSync(join(root, 'package.json'), '{ "name": "layout" }\n')
  for (const [file, content] of Object.entries(presetFiles('tailwind'))) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  const server = await serveDocs(root, { port: 0 })
  closers.push(() => server.close())
  browser ??= await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(`${server.resolvedUrls!.local[0]!}${hash}`)
  await page.waitForSelector('.docs-nav a', { state: 'attached', timeout: 75_000 })
  return page
}

const box = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, width: r.width }
    })

describe('a component page', () => {
  it('is a centered column with the sidebar on the left and the contents of the page on the right', async () => {
    const page = await open('#/components/Button')
    await page.waitForSelector('.docs-stage > *')
    const shell = await box(page, '.docs-shell')
    // Centered: the same space on both sides.
    expect(Math.abs(shell.left - (1440 - shell.right))).toBeLessThan(20)
    expect(shell.width).toBeLessThanOrEqual(1400)
    const nav = await box(page, '.docs-nav')
    const main = await box(page, '.docs-main')
    const toc = await box(page, '.docs-toc')
    expect(nav.right).toBeLessThanOrEqual(main.left)
    expect(main.right).toBeLessThanOrEqual(toc.left)
    // The contents lists the headings of the page, and a link scrolls to its heading without changing the route.
    const labels = await page.locator('.docs-toc a').allTextContents()
    expect(labels).toEqual(expect.arrayContaining(['Anatomy', 'Usage']))
    await page.locator('.docs-toc a', { hasText: 'Usage' }).click()
    await page.waitForFunction(
      () => document.querySelector('.docs-toc a[aria-current=location]')?.textContent === 'Usage',
    )
    expect(page.url()).toContain('#/components/Button')
    await page.close()
  }, 120_000)

  it('has no contents column on a page with nothing to list, and gives the page the room', async () => {
    const page = await open('#/tokens/color')
    await page.waitForSelector('.docs-main h1')
    expect(await page.locator('.docs-toc').count()).toBe(0)
    expect(await page.locator('.docs-shell.no-toc').count()).toBe(1)
    await page.close()
  }, 120_000)

  it('hides the sidebar behind a Menu button on a narrow screen', async () => {
    const page = await open('#/components/Button', 390)
    await page.waitForSelector('.docs-stage > *')
    expect(await page.locator('.docs-nav').isVisible()).toBe(false)
    expect(await page.locator('.docs-toc').isVisible()).toBe(false)
    await page.getByRole('button', { name: 'Menu' }).click()
    expect(await page.locator('.docs-nav').isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
    await page.close()
  }, 120_000)
})

describe('the example: Preview and Code, with the controls under the stage', () => {
  it('starts on Preview, with the controls below the stage and inside the same card', async () => {
    const page = await open('#/components/Button')
    await page.waitForSelector('.docs-stage > *')
    expect(await page.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(await page.getByRole('tab', { name: 'Code' }).getAttribute('aria-selected')).toBe(
      'false',
    )
    const stage = await box(page, '.docs-stage')
    const controls = await box(page, '.docs-controls')
    expect(controls.top).toBeGreaterThan(stage.top)
    // The stage and the controls are in the one card.
    expect(await page.locator('.docs-demo .docs-stage').count()).toBe(1)
    expect(await page.locator('.docs-demo .docs-controls').count()).toBe(1)
    expect(await page.locator('.docs-code').isHidden()).toBe(true)
    await page.close()
  }, 120_000)

  it('shows the code for what the controls show, and follows them', async () => {
    const page = await open('#/components/Button')
    await page.waitForSelector('.docs-stage > *')
    await page.getByRole('tab', { name: 'Code' }).click()
    expect(await page.locator('.docs-stage').isHidden()).toBe(true)
    const code = page.locator('.docs-code code')
    // The defaults need no attributes.
    expect(await code.textContent()).toMatch(/^<Button[^>]*>Save changes<\/Button>$/)
    // A change in the controls is in the code at once, and the stage is still the live example.
    await page.getByRole('tab', { name: 'Preview' }).click()
    await page.locator('#ctl-Button-tone').selectOption('danger')
    await page.locator('#ctl-Button-slot').fill('Delete it')
    await page.getByRole('tab', { name: 'Code' }).click()
    expect(await code.textContent()).toContain('tone="danger"')
    expect(await code.textContent()).toContain('>Delete it</Button>')
    // Arrow keys move between the tabs.
    await page.getByRole('tab', { name: 'Code' }).press('ArrowLeft')
    expect(await page.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(await page.locator('.docs-stage').isVisible()).toBe(true)
    await page.close()
  }, 120_000)
})
