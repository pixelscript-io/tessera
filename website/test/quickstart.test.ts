import { execSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import process from 'node:process'
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
// The page's bash block: every line but the last sets the project up, and the last starts the dev server.
const commands = blocks
  .find((b) => b.lang === 'bash' && b.tags.has('quickstart'))!
  .code.split('\n')
  .filter((l) => l.trim())
const setup = commands.slice(0, -1)
const serve = commands[commands.length - 1]!
/** The one line this test changes: the install reads the package from the checkout's tarball, so a run tests the code under change and not whatever was last published. */
const INSTALL = 'npm install @pixelscriptio/tessera@latest @pixelscriptio/tessera-ui@latest'

const made: string[] = []
// `git init` leaves read-only files on Windows, and a just-stopped server can still hold a handle for a moment:
// clean up with retries, and never fail a passing test over a temp folder.
afterAll(() =>
  made.forEach((d) => {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      /* the OS temp cleaner will take it */
    }
  }),
)

/** `pnpm` on the path (the real one, or a shim that runs the pinned version through npx), for `pnpm pack`. */
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

/** The Quick start installs with npm, which fetches Vite and its dependencies: that needs the registry. */
function registryReachable(): boolean {
  try {
    execSync('npm view vite version', { stdio: 'ignore', timeout: 20_000 })
    return true
  } catch {
    return false
  }
}

describe('the Quick start', () => {
  it('has commands to run and a server to start, and no shell-specific syntax in the shared ones', () => {
    expect(setup).toEqual([
      'mkdir my-app',
      'cd my-app',
      'git init',
      'npm init -y',
      INSTALL,
      'npx tessera init',
    ])
    expect(serve).toBe('npm run dev')
    // The documented create commands work in bash and PowerShell alike.
    const shown = blocks
      .filter((b) => b.lang === 'bash' || b.lang === 'powershell')
      .map((b) => b.code)
      .join('\n')
    expect(shown).not.toContain('export ')
    expect(shown).not.toContain('&&')
    const labels = blocks.filter((b) => b.tags.has('[PowerShell]'))
    expect(labels).toHaveLength(1)
  })

  it.skipIf(!registryReachable())(
    'run verbatim in a clean folder, ends with the dev server serving the index page',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tessera-quickstart-'))
      made.push(dir)
      const env = withPnpm({ ...process.env }, dir)

      // The tarball the commands install: what `pnpm pack` makes of the package.
      const packed = join(dir, 'packed')
      mkdirSync(packed)
      execSync(`pnpm pack --pack-destination "${packed}"`, {
        cwd: join(repo, 'packages', 'tessera'),
        env,
        stdio: 'pipe',
      })
      const tarball = join(
        packed,
        readdirSync(packed).find((f) => f.endsWith('.tgz'))!,
      ).replaceAll('\\', '/')

      // The component library, packed the same way.
      execSync(`pnpm pack --pack-destination "${packed}"`, {
        cwd: join(repo, 'packages', 'ui'),
        env,
        stdio: 'pipe',
      })
      const uiTarball = readdirSync(packed)
        .filter((f) => f.endsWith('.tgz'))
        .map((f) => join(packed, f).replaceAll('\\', '/'))
        .find((f) => f !== tarball)!

      // The commands, exactly as the page writes them.
      const work = join(dir, 'work')
      mkdirSync(work)
      // Run line by line in the platform's own shell (cmd.exe, sh), so it needs no bash. `cd` moves where the
      // next line runs. Only the install line differs from the page: it installs the tarball.
      let cwd = work
      const filled = (line: string) =>
        line === INSTALL ? `npm install "${tarball}" "${uiTarball}"` : line
      for (const line of setup) {
        const cd = /^cd\s+(.+)$/.exec(line.trim())
        if (cd) cwd = join(cwd, cd[1]!)
        else execSync(filled(line), { cwd, env, stdio: 'pipe' })
      }
      const child = spawn(serve, { cwd, env, shell: true })
      let output = ''
      child.stdout.on('data', (d) => (output += d))
      child.stderr.on('data', (d) => (output += d))

      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`the dev server did not start:\n${output}`)),
          180_000,
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
        expect(await page.textContent('h1')).toBe('Build interfaces from a system you can trust')
        expect(await page.title()).toBe('Welcome to Tessera')
        expect(existsSync(join(work, 'my-app', 'app', 'pages', 'index.tess'))).toBe(true)
        // `git init` ran, and the project has no config files of its own.
        expect(existsSync(join(work, 'my-app', '.git'))).toBe(true)
        expect(existsSync(join(work, 'my-app', 'vite.config.ts'))).toBe(false)
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
    },
    420_000,
  )
})
