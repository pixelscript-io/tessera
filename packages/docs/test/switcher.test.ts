import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterAll, describe, expect, it } from 'vitest'
import { serveDocs } from '../src'

// The docs of a project with two design systems, in a real browser: a switch shows the same components with
// the other system's tokens, and says what a component needs that the system lacks.
const sink = fileURLToPath(new URL('../../../examples/kitchen-sink', import.meta.url)).replaceAll(
  '\\',
  '/',
)
const cli = fileURLToPath(new URL('../../cli', import.meta.url))
const ui = fileURLToPath(new URL('../../ui', import.meta.url))
const scratch = join(sink, '.docs-test-switcher')
mkdirSync(scratch, { recursive: true })
const root = mkdtempSync(join(scratch, 'project-')).replaceAll('\\', '/')

// "Full" is the unstyled tokens; "Bare" is the same without the effects file, so it has no shadows.
const tokens = join(cli, 'templates', 'unstyled', 'system', 'unstyled', 'tokens')
cpSync(tokens, join(root, 'system', 'full', 'tokens'), { recursive: true })
cpSync(tokens, join(root, 'system', 'bare', 'tokens'), { recursive: true })
rmSync(join(root, 'system', 'bare', 'tokens', 'effects.tokens.json'))
for (const file of ['Card.tess', 'Button.tess'])
  cpSync(join(ui, 'components', file), join(root, 'system', 'components', file))
writeFileSync(join(root, 'package.json'), '{ "name": "two-systems" }\n')
writeFileSync(
  join(root, 'tessera.config.ts'),
  "export default { systems: [{ name: 'Full', path: '/full' }, { name: 'Bare', path: '/bare' }], defaultSystem: 'Full' }\n",
)

let browser: Browser | undefined
const closers: Array<() => Promise<void> | void> = []
afterAll(async () => {
  await browser?.close()
  for (const close of closers) await close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})

describe('the design system switch in the docs', () => {
  it('starts on the app’s system, and switching changes the tokens, the style sheet and the warnings', async () => {
    const dev = await serveDocs(root, { port: 0 })
    closers.push(() => dev.close())
    browser = await chromium.launch({ channel: 'msedge' })
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${dev.resolvedUrls!.local[0]!}#/components/Card`)
    await page.waitForSelector('#switch-system')

    expect(await page.inputValue('#switch-system')).toBe('Full')
    expect(await page.textContent('main')).not.toContain('does not define')
    expect(await page.textContent('#docs-system-tokens')).toContain('--t-shadow-sm')

    await page.selectOption('#switch-system', 'Bare')
    await page.waitForFunction(() =>
      document.querySelector('main')?.textContent?.includes('does not define'),
    )
    expect(await page.textContent('main')).toContain('$shadow.sm')
    expect(await page.textContent('#docs-system-tokens')).not.toContain('--t-shadow-sm')

    // The tokens pages follow, and so does the choice after a reload.
    await page.goto(`${dev.resolvedUrls!.local[0]!}#/tokens/color`)
    expect(await page.locator('.docs-nav a', { hasText: 'shadow' }).count()).toBe(0)
    await page.reload()
    await page.waitForSelector('#switch-system')
    expect(await page.inputValue('#switch-system')).toBe('Bare')

    await page.selectOption('#switch-system', 'Full')
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.docs-nav a')].some((a) => a.textContent === 'shadow'),
    )
    expect(errors).toEqual([])
  }, 60000)
})
