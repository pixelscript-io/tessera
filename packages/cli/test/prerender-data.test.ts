import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import { presetFiles } from '../src/commands/init'
import type { Io } from '../src/io'

// The data a page declares, and hydration, in a real build: a page that says what it needs in its <page> block is
// written with that data in its HTML, shows it with no request and no loading state, keeps its elements when the script
// loads, and asks again once it is up. A page whose data could not be fetched is not written.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-prerender-data')

let root: string
let dist: string
let output = ''
let browser: Browser | undefined
let api: string
let apiServer: Server
/** The requests the API has had, and what it answers (changed after the build, to see the page ask again). */
const hits: string[] = []
let title = 'First post'
const closers: Array<() => Promise<void> | void> = []

const write = (file: string, text: string) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

const postsPage = (declare: string) => `<page>
{ "title": "Posts", "data": ${declare} }
</page>

<script>
const posts = get('/posts')
const clicks = state(0)
</script>

<template>
  <main class="root">
    <h1>Posts</h1>
    <p if="posts.loading">Loading...</p>
    <p else-if="posts.error">Could not load: {posts.error.message}</p>
    <ul else>
      <li each="post in posts.data" key="post.id">{post.title}</li>
    </ul>
    <button type="button" @click="clicks++">Clicked {clicks} times</button>
    <Link to="/">Home</Link>
  </main>
</template>

<style>
.root {
  padding: $space.4;
}
</style>
`

beforeAll(async () => {
  apiServer = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    res.setHeader('content-type', 'application/json')
    res.setHeader('access-control-allow-origin', '*')
    if (req.url === '/posts') {
      res.end(
        JSON.stringify([
          { id: 1, title },
          { id: 2, title: 'Second post' },
        ]),
      )
    } else if (req.url === '/broken') {
      res.statusCode = 500
      res.end('{"message":"down"}')
    } else {
      res.statusCode = 404
      res.end('{"message":"nothing"}')
    }
  })
  await new Promise<void>((done) => apiServer.listen(0, '127.0.0.1', done))
  api = `http://127.0.0.1:${(apiServer.address() as { port: number }).port}`
  closers.push(() => new Promise<void>((done) => apiServer.close(() => done())))

  mkdirSync(scratch, { recursive: true })
  root = mkdtempSync(join(scratch, 'd-')).replaceAll('\\', '/')
  writeFileSync(join(root, 'package.json'), '{ "name": "site" }\n')
  for (const [file, content] of Object.entries(presetFiles('tailwind'))) write(file, content)
  // The starter's API is replaced by ours, with no description (so any path is allowed).
  write(
    'app/apis/default.ts',
    `import { createApi } from '@pixelscriptio/tessera/core'\n\nexport default createApi({ base: ${JSON.stringify(api)} })\n`,
  )
  rmSync(join(root, 'app/apis/default.api.json'), { force: true })
  write(
    'app/pages/index.tess',
    '<template><main><h1>Home</h1><Link to="/posts">Posts</Link></main></template>\n',
  )
  write('app/pages/posts.tess', postsPage('["/posts"]'))
  write('app/pages/broken.tess', postsPage('["/broken"]').replaceAll('/posts', '/broken'))
  dist = join(root, 'dist').replaceAll('\\', '/')

  const io: Io = { cwd: root, out: (t) => void (output += t + '\n'), err: () => {} }
  expect(await main(['build', '--prerender'], io)).toBe(0)
}, 300_000)

afterAll(async () => {
  await browser?.close()
  for (const close of closers) await close()
  rmSync(scratch, { recursive: true, force: true })
})

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
}

/** A static host: a path with no file is its folder's index.html. */
function serve(): Promise<string> {
  const server: Server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/\/$/, '')
    for (const candidate of [path, `${path}/index.html`]) {
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
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
    ),
  )
}

async function open(
  url: string,
  options: { javaScript?: boolean; delayScripts?: number } = {},
): Promise<{ page: Page; warnings: string[]; errors: string[] }> {
  browser ??= await chromium.launch({ channel: 'msedge' })
  const context = await browser.newContext({ javaScriptEnabled: options.javaScript ?? true })
  const page = await context.newPage()
  const warnings: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text())
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text())
  })
  // The script arrives late, as it does on a slow connection: the page is in the HTML for a while before it is live.
  if (options.delayScripts)
    await page.route('**/*.js', async (route) => {
      await new Promise((r) => setTimeout(r, options.delayScripts))
      await route.continue()
    })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return { page, warnings, errors }
}

describe('the build', () => {
  it('writes the page with its data in it: the elements numbered, and the answers in a script the browser does not run', () => {
    const html = readFileSync(join(dist, 'posts/index.html'), 'utf8')
    expect(html).toContain('First post')
    expect(html).toContain('Second post')
    // No loading state: the page was written after its data was in.
    expect(html).not.toContain('Loading...')
    expect(html).toMatch(/<main data-h="\d+"/)
    expect(html).toContain('<div id="app" data-prerendered>')
    const script = /<script type="application\/json" id="tessera-data">(.*?)<\/script>/.exec(html)
    expect(script).not.toBeNull()
    const baked = JSON.parse(script![1]!) as {
      v: number
      entries: Array<{ url: string; data: unknown }>
    }
    expect(baked.v).toBe(1)
    expect(baked.entries).toEqual([
      {
        url: `${api}/posts`,
        data: [
          { id: 1, title: 'First post' },
          { id: 2, title: 'Second post' },
        ],
      },
    ])
  })

  it('does not write a page whose declared data could not be fetched, and says why', () => {
    expect(existsSync(join(dist, 'broken/index.html'))).toBe(false)
    expect(output).toMatch(/broken[\s\S]*could not be fetched at build time[\s\S]*\/broken/)
    // The pages that did work were written.
    expect(existsSync(join(dist, 'index.html'))).toBe(true)
    expect(existsSync(join(dist, 'posts/index.html'))).toBe(true)
  })

  it('puts no data in a page that declares none', () => {
    expect(readFileSync(join(dist, 'index.html'), 'utf8')).not.toContain('tessera-data')
  })
})

describe('the page in a browser', () => {
  it('shows its data with JavaScript turned off', async () => {
    const base = await serve()
    const { page } = await open(`${base}/posts`, { javaScript: false })
    expect(await page.locator('li').allTextContents()).toEqual(['First post', 'Second post'])
    await page.context().close()
  }, 120_000)

  it('keeps the elements that are in the page when the script loads, and the page works', async () => {
    const base = await serve()
    hits.length = 0
    const { page, warnings, errors } = await open(`${base}/posts`, { delayScripts: 600 })
    // In the HTML, before any script: mark what is there.
    await page.evaluate(() => {
      document.querySelector('ul')!.setAttribute('data-mark', 'list')
      document.querySelector('li')!.setAttribute('data-mark', 'first')
      document.querySelector('main button')!.setAttribute('data-mark', 'button')
    })
    await page.waitForFunction(
      () => !document.getElementById('app')?.hasAttribute('data-prerendered'),
    )
    // Hydrated, not made again: what was marked is still there.
    expect(await page.locator('[data-mark="list"]').count()).toBe(1)
    expect(await page.locator('[data-mark="first"]').textContent()).toBe('First post')
    expect(await page.locator('[data-mark="button"]').count()).toBe(1)
    expect(await page.locator('[data-h]').count()).toBe(0)
    expect(warnings.filter((w) => w.includes('rendered again'))).toEqual([])
    // It is alive.
    await page.locator('main button').click()
    expect(await page.locator('main button').textContent()).toBe('Clicked 1 times')
    expect(errors).toEqual([])
    await page.context().close()
  }, 120_000)

  it('did not ask for the data to show it, and asks again once the page is up, so it is not as old as the build', async () => {
    const base = await serve()
    hits.length = 0
    title = 'Edited since the build'
    const { page } = await open(`${base}/posts`)
    // The baked data is what shows first.
    expect(await page.locator('li').first().textContent()).toBe('First post')
    // Then the page asks, and shows what the server says now, with no loading state in between.
    await page.waitForFunction(
      () => document.querySelector('li')?.textContent === 'Edited since the build',
    )
    expect(hits).toEqual(['GET /posts'])
    expect(await page.locator('p', { hasText: 'Loading' }).count()).toBe(0)
    title = 'First post'
    await page.context().close()
  }, 120_000)

  it('asks once for the data of a page it goes to, not twice: the router starts it and the page joins it', async () => {
    const base = await serve()
    const { page } = await open(`${base}/`)
    await page.waitForFunction(
      () => !document.getElementById('app')?.hasAttribute('data-prerendered'),
    )
    hits.length = 0
    await page.locator('main a', { hasText: 'Posts' }).click()
    await page.waitForSelector('li')
    expect(await page.locator('li').allTextContents()).toEqual(['First post', 'Second post'])
    expect(hits.filter((h) => h === 'GET /posts')).toHaveLength(1)
    await page.context().close()
  }, 120_000)

  it('renders the page again, from nothing, and works, when the HTML is from another build than the script', async () => {
    const base = await serve()
    // The page was written for an older app: an element the app does not make any more.
    const { page, warnings } = await open(`${base}/posts`, { delayScripts: 300 })
    await page.evaluate(() => {
      const extra = document.createElement('div')
      extra.setAttribute('data-h', '99')
      document.querySelector('main')!.append(extra)
    })
    await page.waitForFunction(
      () => !document.getElementById('app')?.hasAttribute('data-prerendered'),
    )
    expect(warnings.some((w) => w.includes('rendered again'))).toBe(true)
    expect(await page.locator('li').allTextContents()).toEqual(['First post', 'Second post'])
    await page.locator('main button').click()
    expect(await page.locator('main button').textContent()).toBe('Clicked 1 times')
    await page.context().close()
  }, 120_000)
})
