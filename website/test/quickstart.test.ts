import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { afterAll, describe, expect, it } from 'vitest'
import { parseBlocks } from '../scripts/checker'

const repo = fileURLToPath(new URL('../..', import.meta.url))
  .replaceAll('\\', '/')
  .replace(/\/$/, '')
const quickStart = readFileSync(
  fileURLToPath(new URL('../content/quick-start.md', import.meta.url)),
  'utf8',
)

/** Terminal color codes, which Vite prints around the address. */
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')

const blocks = parseBlocks(quickStart)
const setup = blocks.filter((b) => b.lang === 'bash' && b.tags.has('quickstart')).map((b) => b.code)
const serve = blocks.find((b) => b.lang === 'bash' && b.tags.has('quickstart-serve'))!.code.trim()

const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** A `pnpm` on the path: the real one if there is one, else a shim that runs the pinned version through npx. */
function withPnpm(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  try {
    execSync('pnpm --version', { stdio: 'ignore' })
    return env
  } catch {
    const bin = join(dir, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexec npx --yes pnpm@10 "$@"\n', { mode: 0o755 })
    writeFileSync(join(bin, 'pnpm.cmd'), '@echo off\r\nnpx --yes pnpm@10 %*\r\n')
    return { ...env, PATH: `${bin}${delimiter}${env.PATH}` }
  }
}

describe('the Quick start', () => {
  it('has commands to run and a server to start', () => {
    expect(setup.join('\n')).toContain('tessera.js init my-app')
    expect(setup.join('\n')).toContain('pnpm install')
    expect(serve).toBe('pnpm dev')
  })

  it('run verbatim in a clean folder, ends with the dev server serving the index page', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tessera-quickstart-'))
    made.push(dir)
    const env = withPnpm(
      // Tessera's own packages are linked from the checkout; do not reach for the network for the rest.
      { ...process.env, TESSERA: repo, npm_config_offline: 'true' },
      dir,
    )

    // The commands, exactly as the page writes them.
    const script = [...setup, serve].join('\n')
    const child = spawn('bash', ['-c', script], { cwd: dir, env })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))

    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`the dev server did not start:\n${output}`)),
        120_000,
      )
      const poll = setInterval(() => {
        const match = /Local:\s+(http:\/\/[^\s]+)/.exec(output.replace(ANSI, ''))
        if (match) {
          clearInterval(poll)
          clearTimeout(timer)
          resolve(match[1]!)
        }
      }, 200)
      child.on('exit', (code) => {
        clearInterval(poll)
        clearTimeout(timer)
        reject(new Error(`the commands exited early (${code}):\n${output}`))
      })
    })

    const browser = await chromium.launch({ channel: 'msedge' })
    try {
      const page = await browser.newPage()
      await page.goto(url)
      await page.waitForSelector('h1')
      expect(await page.textContent('h1')).toBe('Welcome to Tessera')
      expect(existsSync(join(dir, 'my-app', 'app', 'pages', 'index.tess'))).toBe(true)
    } finally {
      await browser.close()
      if (process.platform === 'win32' && child.pid) {
        try {
          execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' })
        } catch {
          /* already gone */
        }
      } else child.kill('SIGTERM')
    }
  }, 240_000)
})
