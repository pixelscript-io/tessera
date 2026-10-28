import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { parseArgs } from '../src/args'
import { presetFiles } from '../src/commands/init'
import { startDev, type DevServers } from '../src/commands/serve'

// `tessera dev --mock`: an API that has a description is answered by the dev server from that description, so a page
// can be built before the server exists, and its loading, error and empty states seen on purpose.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-dev-mock')

const description = {
  types: { Item: { id: 'number', title: 'string', price: 'number' } },
  paths: {
    '/items': {
      get: { returns: 'Item[]' },
      post: { body: { title: 'string' }, returns: 'Item' },
    },
    '/items/:id': { get: { returns: 'Item', errors: { '404': 'No such item' } } },
  },
}

const page = `<script>
const items = shop.get('/items')
</script>

<template>
  <main>
    <p if="items.loading">Loading...</p>
    <p else-if="items.error">Could not load: {items.error.message}</p>
    <p else-if="items.data.length === 0">Nothing here yet</p>
    <ul else>
      <li each="item in items.data" key="item.id">{item.title}</li>
    </ul>
  </main>
</template>
`

const started: DevServers[] = []
const roots: string[] = []
let browser: Browser | undefined

async function project(): Promise<string> {
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'd-')).replaceAll('\\', '/')
  roots.push(root)
  writeFileSync(join(root, 'package.json'), '{ "name": "mock-test" }\n')
  writeFileSync(join(root, 'tessera.config.ts'), 'export default { docs: false }\n')
  const files: Record<string, string> = {
    ...presetFiles('unstyled'),
    // The real server does not exist: its address would fail to resolve.
    'app/apis/shop.ts': `import { createApi } from '@pixelscriptio/tessera/core'\n\nexport default createApi({ base: 'https://shop.invalid', headers: { authorization: 'Bearer real-secret' } })\n`,
    'app/apis/shop.api.json': JSON.stringify(description),
    'app/apis/bare.ts': `import { createApi } from '@pixelscriptio/tessera/core'\n\nexport default createApi({ base: 'https://bare.invalid' })\n`,
    'app/pages/index.tess': page,
  }
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  return root
}

async function start(root: string, ...argv: string[]): Promise<string> {
  const servers = await startDev(root, parseArgs(['--port', '0', ...argv]))
  started.push(servers)
  return servers.app.resolvedUrls!.local[0]!.replace(/\/$/, '')
}

afterEach(async () => {
  for (const { app } of started.splice(0)) await app.close()
  delete process.env.TESSERA_MOCK
})
afterAll(async () => {
  await browser?.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  rmSync(scratch, { recursive: true, force: true })
})
beforeAll(() => rmSync(scratch, { recursive: true, force: true }))

const ask = async (base: string, path: string, init: RequestInit = {}) => {
  const response = await fetch(`${base}/__tessera/mock/${path}`, init)
  const text = await response.text()
  return { status: response.status, json: text ? (JSON.parse(text) as unknown) : undefined }
}

describe('tessera dev --mock: the server', () => {
  it('answers a read from the description', async () => {
    const base = await start(await project(), '--mock')
    const answer = await ask(base, 'shop/items')
    expect(answer.status).toBe(200)
    const items = answer.json as Array<{ id: number; title: string; price: number }>
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(items[0]).toMatchObject({ id: expect.any(Number), title: expect.any(String) })
  }, 120_000)

  it('puts what a write sent into its answer', async () => {
    const base = await start(await project(), '--mock')
    const answer = await ask(base, 'shop/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Oat milk' }),
    })
    expect(answer.json).toMatchObject({ title: 'Oat milk' })
  }, 120_000)

  it('shows an error or an empty list when asked, with x-tessera-mock', async () => {
    const base = await start(await project(), '--mock')
    const failed = await ask(base, 'shop/items/9', { headers: { 'x-tessera-mock': 'error:404' } })
    expect(failed).toEqual({ status: 404, json: { message: 'No such item' } })
    const empty = await ask(base, 'shop/items', { headers: { 'x-tessera-mock': 'empty' } })
    expect(empty.json).toEqual([])
  }, 120_000)

  it('says what is missing when the api or its description is not there', async () => {
    const base = await start(await project(), '--mock')
    const none = await ask(base, 'nope/items')
    expect(none.status).toBe(404)
    expect((none.json as { message: string }).message).toContain('no API named "nope"')
    const bare = await ask(base, 'bare/items')
    expect(bare.status).toBe(404)
    expect((bare.json as { message: string }).message).toContain('has no description')
  }, 120_000)

  it('does nothing without --mock: the api file is as written, and nothing answers', async () => {
    const root = await project()
    const base = await start(root)
    const response = await fetch(`${base}/__tessera/mock/shop/items`)
    expect(response.headers.get('content-type') ?? '').not.toContain('application/json')
    const { app } = started[0]!
    const code = (await app.transformRequest('/app/apis/shop.ts'))!.code
    expect(code).not.toContain('createMockedApi')
  }, 120_000)

  it('gives the api file its name, and the secret of the real one never reaches the mock', async () => {
    const root = await project()
    await start(root, '--mock')
    const { app } = started[0]!
    const code = (await app.transformRequest('/app/apis/shop.ts'))!.code
    expect(code).toContain('createMockedApi("shop", {')
    expect(code).not.toContain('createApi(')
  }, 120_000)
})

describe('tessera dev --mock: the page', () => {
  async function open(base: string, query = '') {
    browser ??= await chromium.launch({ channel: 'msedge' })
    const context = await browser.newContext()
    const page = await context.newPage()
    const requests: string[] = []
    page.on('request', (r) => requests.push(r.url()))
    await page.goto(`${base}/${query}`, { waitUntil: 'domcontentloaded' })
    return { page, requests, context }
  }

  it('lists the made-up items, and asks only the dev server', async () => {
    const base = await start(await project(), '--mock')
    const { page, requests, context } = await open(base)
    await page.waitForSelector('li')
    expect(await page.locator('li').count()).toBeGreaterThanOrEqual(3)
    expect(requests.some((u) => u.includes('shop.invalid'))).toBe(false)
    expect(requests.some((u) => u.includes('/__tessera/mock/shop/items'))).toBe(true)
    await context.close()
  }, 120_000)

  it('shows the error, empty and loading states when the address asks for them', async () => {
    const base = await start(await project(), '--mock')
    const failed = await open(base, '?mock=error')
    await failed.page.waitForSelector('text=Could not load')
    await failed.context.close()
    const empty = await open(base, '?mock=empty')
    await empty.page.waitForSelector('text=Nothing here yet')
    await empty.context.close()
    const loading = await open(base, '?mock=loading')
    await loading.page.waitForSelector('text=Loading...')
    await loading.page.waitForTimeout(500)
    expect(await loading.page.locator('li').count()).toBe(0)
    expect(await loading.page.locator('text=Loading...').count()).toBe(1)
    await loading.context.close()
  }, 120_000)
})
