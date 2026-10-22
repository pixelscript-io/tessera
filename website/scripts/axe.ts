/**
 * Scans every page of the built site with axe-core, in the light and dark themes, and fails on a serious or
 * critical violation. Run after `vitepress build` by `pnpm --filter website build`.
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = fileURLToPath(new URL('.', import.meta.url))
const dist = join(here, '..', 'content', '.vitepress', 'dist')
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
)

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
}

function htmlPages(dir: string, root = dir): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'assets') out.push(...htmlPages(path, root))
    } else if (name.endsWith('.html') && name !== '404.html') {
      out.push('/' + path.slice(root.length + 1).replaceAll('\\', '/'))
    }
  }
  return out.sort()
}

/** A static server with VitePress's clean URLs: `/guide/cli` serves `guide/cli.html`. */
function serve() {
  return createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]!)
    const candidates = [join(dist, url), join(dist, url + '.html'), join(dist, url, 'index.html')]
    const file = candidates.find((c) => existsSync(c) && statSync(c).isFile())
    if (!file) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
}

interface Violation {
  id: string
  impact?: string | null
  help: string
  nodes: Array<{ target: unknown[]; any?: Array<{ message: string }> }>
}

const server = serve()
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const browser = await chromium.launch({ channel: 'msedge' })
const failures: string[] = []
let scanned = 0

try {
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ colorScheme: scheme })
    const page = await context.newPage()
    for (const path of htmlPages(dist)) {
      await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'load' })
      await page.evaluate(axeSource)
      const result = (await page.evaluate(() =>
        (
          window as unknown as {
            axe: { run: (c: Document, o: object) => Promise<{ violations: Violation[] }> }
          }
        ).axe.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'],
          },
        }),
      )) as { violations: Violation[] }
      scanned++
      for (const v of result.violations) {
        if (v.impact === 'serious' || v.impact === 'critical') {
          failures.push(
            `${path} (${scheme}): ${v.id} (${v.impact}): ${v.help}\n    ${v.nodes
              .slice(0, 3)
              .map((n) => `${JSON.stringify(n.target)} ${n.any?.[0]?.message ?? ''}`)
              .join('\n    ')}`,
          )
        }
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
  server.close()
}

if (failures.length) {
  console.error(
    `axe found ${failures.length} serious or critical violations:\n\n${failures.join('\n\n')}`,
  )
  process.exit(1)
}
console.log(`axe: ${scanned} page scans (light and dark), no serious or critical violations.`)
