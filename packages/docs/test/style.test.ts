import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, describe, expect, it } from 'vitest'
import { serveDocs } from '../src'

// The docs take their look from the project's own semantic tokens, so the app and the docs share the token files.
// Each preset's files are copied into a throwaway project inside the kitchen-sink folder.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-style')
mkdirSync(scratch, { recursive: true })
const axeSource = readFileSync(
  createRequire(join(repo, 'website/package.json')).resolve('axe-core'),
  'utf8',
)

let browser: Browser | undefined
const closers: Array<() => Promise<void> | void> = []
afterAll(async () => {
  await browser?.close()
  for (const close of closers) await close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})

/** A project made of a preset's files (and the design system's Button), or of none. */
function project(preset: 'tessera' | 'tailwind' | 'none'): string {
  const root = mkdtempSync(join(scratch, `${preset}-`)).replaceAll('\\', '/')
  writeFileSync(join(root, 'package.json'), '{ "name": "styled" }\n')
  cpSync(join(repo, 'packages/cli/templates', preset), root, { recursive: true })
  if (preset !== 'none') {
    cpSync(
      join(repo, 'packages/ui/components/Button.tess'),
      join(root, 'system/components/Button.tess'),
    )
  }
  return root
}

async function open(root: string, scheme: 'light' | 'dark', hash = '#/'): Promise<Page> {
  const server = await serveDocs(root, { port: 0 })
  closers.push(() => server.close())
  browser ??= await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.emulateMedia({ colorScheme: scheme })
  await page.goto(`${server.resolvedUrls!.local[0]!}${hash}`)
  await page.waitForSelector('.docs-nav a', { timeout: 75_000 })
  await page.waitForLoadState('networkidle')
  return page
}

const colors = (page: Page) =>
  page.evaluate(() => {
    const css = (selector: string, prop: 'color' | 'backgroundColor' | 'fontFamily') =>
      getComputedStyle(document.querySelector(selector)!)[prop]
    return {
      page: css('body', 'backgroundColor'),
      text: css('body', 'color'),
      nav: css('.docs-nav', 'backgroundColor'),
      font: css('body', 'fontFamily'),
    }
  })

async function axe(page: Page): Promise<string[]> {
  await page.evaluate(axeSource)
  return (await page.evaluate(() =>
    (window as any).axe.run(document, { resultTypes: ['violations'] }).then((r: any) =>
      r.violations
        .filter((v: any) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v: any) =>
            `${v.id} (${v.impact}): ${v.nodes
              .map((n: any) => n.target.join(' '))
              .slice(0, 3)
              .join(', ')}`,
        ),
    ),
  )) as string[]
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('the docs are styled by the project’s tokens', () => {
  it('takes its colors and type from the tessera preset, in light and in dark', async () => {
    const root = project('tessera')
    const light = await open(root, 'light', '#/components/Button')
    expect(await colors(light)).toMatchObject({
      page: rgb('#faf9f6'), // color.surface.default
      text: rgb('#17160f'), // color.text.default
      nav: rgb('#f2f0ea'), // the sidebar is color.surface.raised
    })
    // The font is the token's, not the docs' own.
    expect((await colors(light)).font).toContain('ui-sans-serif')

    const dark = await open(root, 'dark', '#/components/Button')
    expect(await colors(dark)).toMatchObject({
      page: rgb('#13120e'),
      text: rgb('#edeae2'),
      nav: rgb('#1b1a15'),
    })
  }, 120_000)

  it('follows a change to a token, and the theme switcher moves the whole page', async () => {
    const root = project('tessera')
    const file = join(root, 'system/tokens/semantic.tokens.json')
    // The page color becomes white, in the file the app also reads.
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        '"surface": {\n      "default": {\n        "$value": "{color.stone.50}"',
        '"surface": {\n      "default": {\n        "$value": "{color.white}"',
      ),
    )
    const page = await open(root, 'light')
    expect((await colors(page)).page).toBe(rgb('#ffffff'))
    await page.locator('#switch-theme').selectOption('dark')
    expect((await colors(page)).page).toBe(rgb('#13120e'))
  }, 120_000)

  it('falls back to its own look for a project without tokens', async () => {
    const page = await open(project('none'), 'light')
    expect(await colors(page)).toMatchObject({ page: rgb('#faf9f6'), text: rgb('#17160f') })
  }, 120_000)

  for (const preset of ['tessera', 'tailwind', 'none'] as const) {
    it(`passes axe with the ${preset} preset, in light and dark`, async () => {
      const root = project(preset)
      for (const scheme of ['light', 'dark'] as const) {
        const page = await open(root, scheme, '#/')
        expect(await axe(page), `overview, ${scheme}`).toEqual([])
        if (preset !== 'none') {
          await page.goto(page.url().split('#')[0] + '#/components/Button')
          await page.waitForSelector('.docs-stage > *')
          expect(await axe(page), `Button, ${scheme}`).toEqual([])
          await page.goto(page.url().split('#')[0] + '#/tokens/contrast')
          await page.waitForSelector('.docs-main h1')
          expect(await axe(page), `contrast, ${scheme}`).toEqual([])
        }
      }
    }, 180_000)
  }
})
