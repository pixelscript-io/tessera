import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import { parseArgs } from '../src/args'
import { presetFiles, STARTERS } from '../src/commands/init'
import { startDev, type DevServers } from '../src/commands/serve'
import type { Io } from '../src/io'

// The apps `tessera init` can start with: a to-do app, a starter page, and a blank slate. Each one, with each tokens
// choice, is a project that checks clean, and the to-do app works in a real browser.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-starters')

const roots: string[] = []
const started: DevServers[] = []
let browser: Browser | undefined

beforeAll(() => rmSync(scratch, { recursive: true, force: true }))
afterEach(async () => {
  for (const { app } of started.splice(0)) await app.close()
})
afterAll(async () => {
  await browser?.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  rmSync(scratch, { recursive: true, force: true })
})

async function run(root: string, ...argv: string[]) {
  let out = ''
  let err = ''
  const io: Io = {
    cwd: root,
    out: (t) => void (out += t + '\n'),
    err: (t) => void (err += t + '\n'),
  }
  const code = await main(argv, io)
  return { code, out, err }
}

async function created(starter: string, tokens: string): Promise<string> {
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'p-')).replaceAll('\\', '/')
  roots.push(root)
  writeFileSync(join(root, 'package.json'), '{ "name": "starter-test" }\n')
  const made = await run(root, 'init', '--starter', starter, '--tokens', tokens)
  expect(made.code, made.err).toBe(0)
  return root
}

describe('the files of each starter', () => {
  it('has three starters, and every one has a main.ts and a page', () => {
    expect([...STARTERS]).toEqual(['todo', 'page', 'blank'])
    for (const starter of STARTERS) {
      const files = presetFiles('tailwind', starter)
      expect(files['app/main.ts'], starter).toBeDefined()
      expect(files['app/pages/index.tess'], starter).toBeDefined()
      expect(files['system/components/Button.tess'], starter).toBeDefined()
    }
  })

  it('gives the to-do app its state, the page starter its counter and API, and the blank slate neither', () => {
    const todo = presetFiles('tailwind', 'todo')
    expect(todo['app/state/todos.ts']).toContain("persisted<Todo[]>('todos'")
    expect(todo['app/state/counter.ts']).toBeUndefined()
    expect(todo['app/apis/default.ts']).toBeUndefined()
    expect(todo['app/layouts/default.tess']).toBeDefined()

    const page = presetFiles('tailwind', 'page')
    expect(page['app/state/counter.ts']).toBeDefined()
    expect(page['app/apis/default.ts']).toBeDefined()
    expect(page['app/state/todos.ts']).toBeUndefined()

    const blank = presetFiles('tailwind', 'blank')
    expect(Object.keys(blank).filter((f) => f.startsWith('app/'))).toEqual([
      'app/main.ts',
      'app/pages/index.tess',
    ])
  })

  it('is the page starter when no starter is named, as before', () => {
    expect(presetFiles('unstyled')['app/pages/index.tess']).toBe(
      presetFiles('unstyled', 'page')['app/pages/index.tess'],
    )
  })
})

describe('init writes a project that checks clean', () => {
  for (const starter of STARTERS) {
    for (const tokens of ['tailwind', 'none']) {
      it(`${starter} starter with ${tokens} tokens`, async () => {
        const root = await created(starter, tokens)
        const checked = await run(root, 'check')
        expect(checked.err + checked.out, `${starter}/${tokens}`).not.toMatch(/\bERROR\b/)
        expect(checked.code).toBe(0)
        expect(existsSync(join(root, 'app/pages/index.tess'))).toBe(true)
      }, 120_000)
    }
  }
})

describe('the to-do app, in a browser', () => {
  async function open(root: string, path = '/') {
    const { app } = started[started.push(await startDev(root, parseArgs(['--port', '0']))) - 1]!
    browser ??= await chromium.launch({ channel: 'msedge' })
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on(
      'console',
      (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()),
    )
    const base = app.resolvedUrls!.local[0]!.replace(/\/$/, '')
    await page.goto(base + path)
    return { page, context, errors, base }
  }

  it('adds, ticks off, filters, removes, and keeps the list after a reload', async () => {
    const root = await created('todo', 'tailwind')
    const { page, context, errors, base } = await open(root)
    await page.waitForSelector('text=Nothing here')
    const add = async (text: string) => {
      await page.getByLabel('New todo').fill(text)
      await page.getByRole('button', { name: 'Add' }).click()
    }
    await add('Buy milk')
    await add('Write docs')
    await add('   ')
    expect(await page.locator('.root li, main li').count()).toBe(2)
    // The field is emptied after an add, and an empty one adds nothing.
    expect(await page.getByLabel('New todo').inputValue()).toBe('')
    expect(await page.locator('text=2 left').count()).toBe(1)

    await page.getByLabel('Done: Buy milk').check()
    expect(await page.locator('text=1 left').count()).toBe(1)

    await page.getByRole('button', { name: 'Done', exact: true }).click()
    expect(await page.locator('main li').allTextContents()).toEqual([
      expect.stringContaining('Buy milk'),
    ])
    expect(page.url()).toContain('filter=done')
    await page.getByRole('button', { name: 'Active' }).click()
    expect(await page.locator('main li').allTextContents()).toEqual([
      expect.stringContaining('Write docs'),
    ])

    // Still there after a reload, with the filter from the address.
    await page.reload()
    await page.waitForSelector('main li')
    expect(page.url()).toContain('filter=active')
    expect(await page.locator('main li').count()).toBe(1)
    await page.goto(base + '/')
    await page.waitForSelector('main li')
    expect(await page.locator('main li').count()).toBe(2)

    await page.getByRole('button', { name: 'Clear done' }).click()
    expect(await page.locator('main li').count()).toBe(1)
    await page.getByRole('button', { name: 'Remove' }).click()
    await page.waitForSelector('text=Nothing here')
    expect(errors).toEqual([])
    await context.close()
  }, 180_000)

  it('does not break on a damaged list in the browser’s storage', async () => {
    const root = await created('todo', 'tailwind')
    const { page, context, errors } = await open(root)
    await page.waitForSelector('text=Nothing here')
    await page.evaluate(() =>
      localStorage.setItem('todos', JSON.stringify({ v: 1, value: [{ id: 'x', title: 7 }] })),
    )
    await page.reload()
    await page.waitForSelector('text=Nothing here')
    expect(errors).toEqual([])
    await context.close()
  }, 180_000)
})

describe('the blank slate, in a browser', () => {
  it('shows its page with no layout, and no errors', async () => {
    const root = await created('blank', 'none')
    const { app } = started[started.push(await startDev(root, parseArgs(['--port', '0']))) - 1]!
    browser ??= await chromium.launch({ channel: 'msedge' })
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on(
      'console',
      (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()),
    )
    await page.goto(app.resolvedUrls!.local[0]!)
    await page.waitForSelector('h1')
    expect(await page.locator('h1').textContent()).toBe('Hello')
    expect(await page.locator('header').count()).toBe(0)
    expect(errors).toEqual([])
    await context.close()
  }, 180_000)
})
