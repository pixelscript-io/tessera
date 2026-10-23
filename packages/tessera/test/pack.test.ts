import { execFileSync, execSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The published package, as a user gets it: packed with `pnpm pack`, installed into an empty project with no
// link to this repository, then run in a real browser. Installing uses pnpm's offline store so the test needs
// no network; the same tarball installs with npm (docs/quick-start runs that, with the network).

const pkg = fileURLToPath(new URL('..', import.meta.url))
const repo = join(pkg, '..', '..')
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
)
const made: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-pack-'))
  made.push(dir)
  return dir
}
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** `pnpm` if it is installed, else a shim that runs the pinned version through npx. */
function pnpmEnv(dir: string): NodeJS.ProcessEnv {
  try {
    execSync('pnpm --version', { stdio: 'ignore' })
    return process.env
  } catch {
    const bin = join(dir, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexec npx --yes pnpm@10 "$@"\n', { mode: 0o755 })
    writeFileSync(join(bin, 'pnpm.cmd'), '@echo off\r\nnpx --yes pnpm@10 %*\r\n')
    return { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` }
  }
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })

/**
 * tar reads `C:\...` as a remote host, so it runs from the file's folder with a bare file name, and extracts
 * into a path given relative to that folder.
 */
function tar(file: string, flags: string, into?: string): string {
  const folder = dirname(file)
  const target = into ? ` -C "${relative(folder, into).replaceAll('\\', '/')}"` : ''
  return execSync(`tar ${flags} "${basename(file)}"${target}`, { cwd: folder, encoding: 'utf8' })
}

let tarball: string
const env = () => pnpmEnv(tarball.replace(/[^\\/]*$/, ''))

beforeAll(() => {
  const dir = scratch()
  execSync(`pnpm pack --pack-destination "${dir}"`, { cwd: pkg, env: pnpmEnv(dir), stdio: 'pipe' })
  tarball = join(
    dir,
    readdirSync(dir).find((f) => f.endsWith('.tgz'))!,
  )
}, 120_000)

/** A fresh project folder with this package installed from the tarball. */
function install(): string {
  const dir = scratch()
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'my-app', private: true, type: 'module' }),
  )
  execSync(`pnpm add "${tarball}" --offline`, { cwd: dir, env: env(), stdio: 'pipe' })
  return dir
}

const tessera = (dir: string, ...args: string[]) =>
  join(dir, 'node_modules', '@pixelscriptio', 'tessera', 'bin', 'tessera.js') + ' ' + args.join(' ')

const run = (dir: string, ...args: string[]) =>
  execFileSync(
    process.execPath,
    [join(dir, 'node_modules', '@pixelscriptio', 'tessera', 'bin', 'tessera.js'), ...args],
    {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  )

describe('the packed package', () => {
  it('has built entries, declarations and the Link component, and no workspace references', () => {
    const list = tar(tarball, '-tzf').split(/\r?\n/)
    for (const entry of [
      'package/bin/tessera.js',
      'package/dist/core.js',
      'package/dist/router.js',
      'package/dist/router-app.js',
      'package/dist/behavior.js',
      'package/dist/tokens.js',
      'package/dist/vite.js',
      'package/dist/cli.js',
      'package/dist/components/Link.tess',
      'package/dist/types/packages/tessera/src/core.d.ts',
      'package/dist/types/packages/tessera/src/router.d.ts',
    ]) {
      expect(list, entry).toContain(entry)
    }
    // No source, no tests, no other workspace package.
    expect(list.some((f) => f.startsWith('package/src/') || f.includes('/test/'))).toBe(false)

    const dir = scratch()
    tar(tarball, '-xzf', dir)
    const manifest = JSON.parse(readFileSync(join(dir, 'package', 'package.json'), 'utf8'))
    expect(manifest.name).toBe('@pixelscriptio/tessera')
    expect(manifest.exports['./core']).toEqual({
      types: './dist/types/packages/tessera/src/core.d.ts',
      default: './dist/core.js',
    })
    expect(manifest.bin.tessera).toBe('./bin/tessera.js')
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['acorn', 'vite'])
    expect(JSON.stringify(manifest)).not.toContain('workspace:')
  })

  it('has type declarations that resolve, with no @tessera/* import left in them', () => {
    const dir = install()
    run(dir, 'init', '--preset', 'none')
    writeFileSync(
      join(dir, 'app', 'types-check.ts'),
      `import { state, derived } from '@pixelscriptio/tessera/core'
import { navigate, useRoute } from '@pixelscriptio/tessera/router'
import { setTheme } from '@pixelscriptio/tessera/tokens'
import { tessera } from '@pixelscriptio/tessera/vite'

const n = state(1)
const double = derived(() => n.value * 2)
const value: number = double.value
void navigate('/')
void useRoute().path
setTheme('dark')
void tessera
void value
// @ts-expect-error a number is not a string
const wrong: string = n.value
void wrong
`,
    )
    // Compile the types as a user's editor would.
    const tsc = join(repo, 'node_modules', 'typescript', 'bin', 'tsc')
    execFileSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')], {
      cwd: dir,
      stdio: 'pipe',
    })
    const declarations = join(dir, 'node_modules', '@pixelscriptio', 'tessera', 'dist', 'types')
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
      )
    for (const file of walk(declarations)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/['"]@tessera\//)
    }
  }, 120_000)

  it('types the routes of an app: a literal route is accepted and a made-up one is an error', async () => {
    const dir = install()
    run(dir, 'init', '--preset', 'none')
    // `tessera build` writes .tessera/routes.d.ts, as the dev server does.
    run(dir, 'build')
    expect(readFileSync(join(dir, '.tessera', 'routes.d.ts'), 'utf8')).toContain(
      "declare module '@pixelscriptio/tessera/router'",
    )
    writeFileSync(
      join(dir, 'app', 'route-types.ts'),
      `import type { RoutePattern } from '@pixelscriptio/tessera/router'

export const ok: RoutePattern = '/'
// @ts-expect-error not a route of this app
export const bad: RoutePattern = '/nope'
`,
    )
    const tsc = join(repo, 'node_modules', 'typescript', 'bin', 'tsc')
    execFileSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')], {
      cwd: dir,
      stdio: 'pipe',
    })
  }, 120_000)
})

interface Running {
  url: string
  stop(): void
}

/** `tessera dev` in a project, resolved once it prints its address. */
async function startDev(dir: string): Promise<Running> {
  const port = await freePort()
  const child = spawn(
    process.execPath,
    [
      join(dir, 'node_modules', '@pixelscriptio', 'tessera', 'bin', 'tessera.js'),
      'dev',
      '--port',
      String(port),
    ],
    {
      cwd: dir,
    },
  )
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the dev server did not start:\n${output}`)),
      60_000,
    )
    const poll = setInterval(() => {
      if (output.includes(`${port}`)) {
        clearInterval(poll)
        clearTimeout(timer)
        resolve()
      }
    }, 100)
    child.on('exit', () => reject(new Error(`the dev server exited:\n${output}`)))
  })
  return {
    url: `http://localhost:${port}/`,
    stop: () => {
      if (process.platform === 'win32' && child.pid) {
        try {
          execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' })
        } catch {
          /* already gone */
        }
      } else child.kill('SIGTERM')
    },
  }
}

async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource)
  const result = (await page.evaluate(() =>
    (
      window as unknown as {
        axe: {
          run: (
            c: Document,
          ) => Promise<{ violations: Array<{ id: string; impact: string; nodes: unknown[] }> }>
        }
      }
    ).axe.run(document),
  )) as { violations: Array<{ id: string; impact: string; nodes: unknown[] }> }
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`)
}

describe.each(['tailwind', 'none'] as const)(
  'a new project from the packed package: the %s preset',
  (preset) => {
    it('installs, serves the index page with no config files of its own, builds, and previews', async () => {
      const dir = install()
      const initOut = run(dir, 'init', '--preset', preset)
      expect(initOut).toContain(`Started a Tessera project (${preset} preset)`)
      // The user's project has no link to this repository, and no Vite config or HTML page.
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(JSON.stringify(manifest)).not.toContain('link:')
      expect(existsSync(join(dir, 'vite.config.ts'))).toBe(false)
      expect(existsSync(join(dir, 'index.html'))).toBe(false)
      expect(manifest.scripts.dev).toBe('tessera dev')

      expect(run(dir, 'check')).toContain('0 errors')

      const dev = await startDev(dir)
      const browser = await chromium.launch({ channel: 'msedge' })
      try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
        const problems: string[] = []
        page.on('pageerror', (e) => problems.push(e.message))
        page.on(
          'console',
          (m) => m.type() === 'error' && !m.text().includes('404') && problems.push(m.text()),
        )
        await page.goto(dev.url)
        await page.waitForSelector('h1')

        expect(await page.title()).toBe('Welcome to Tessera')
        expect(await page.textContent('h1')).toBe(
          preset === 'tailwind'
            ? 'Build interfaces from a system you can trust'
            : 'Welcome to Tessera',
        )

        if (preset === 'tailwind') {
          // Styled by its tokens: the page has no margin and a white surface in light, and the button works.
          const light = await page.evaluate(() => {
            const cs = getComputedStyle(document.body)
            return { margin: cs.margin, background: cs.backgroundColor }
          })
          expect(light.margin).toBe('0px')
          expect(light.background).toBe('rgb(255, 255, 255)')
          const button = page.getByRole('button', { name: /Clicked/ })
          expect(await button.textContent()).toContain('Clicked 0 times')
          await button.click()
          expect(await button.textContent()).toContain('Clicked 1 times')
          expect(await axeViolations(page)).toEqual([])

          // Dark: the switch in the layout changes the theme, and it is still accessible.
          await page.getByRole('button', { name: 'Dark' }).click()
          await page.waitForTimeout(300)
          expect(
            await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
          ).toBe('dark')
          expect(
            await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
          ).not.toBe('rgb(255, 255, 255)')
          expect(await axeViolations(page)).toEqual([])
        } else {
          // No tokens: no token CSS is loaded and nothing is styled, but it renders and is accessible.
          expect(await page.textContent('body')).toContain(
            'Run npx tessera check to validate the project.',
          )
          expect(await axeViolations(page)).toEqual([])
        }

        // A route with no page is the router's not-found page; the server answers any path with the app.
        await page.goto(`${dev.url}nowhere`)
        await page.waitForSelector('h1')
        expect(await page.textContent('h1')).toBe('Page not found')
        expect(problems).toEqual([])
      } finally {
        await browser.close()
        dev.stop()
      }

      // A production build, then the preview server.
      expect(run(dir, 'build')).toContain('index.html')
      expect(existsSync(join(dir, 'dist', 'index.html'))).toBe(true)
      const previewPort = await freePort()
      const preview = spawn(
        process.execPath,
        [
          join(dir, 'node_modules', '@pixelscriptio', 'tessera', 'bin', 'tessera.js'),
          'preview',
          '--port',
          String(previewPort),
        ],
        { cwd: dir },
      )
      try {
        let html = ''
        for (let i = 0; i < 100 && !html.includes('<div id="app">'); i++) {
          await new Promise((r) => setTimeout(r, 100))
          html = await fetch(`http://localhost:${previewPort}/`)
            .then((r) => r.text())
            .catch(() => '')
        }
        expect(html).toContain('<div id="app">')
      } finally {
        if (process.platform === 'win32' && preview.pid) {
          try {
            execSync(`taskkill /pid ${preview.pid} /T /F`, { stdio: 'ignore' })
          } catch {
            /* already gone */
          }
        } else preview.kill('SIGTERM')
      }
    }, 300_000)
  },
)

void tessera

describe('@pixelscriptio/create-tessera, as `npm create @pixelscriptio/tessera` runs it', () => {
  it('starts a project in a new folder from the packed packages alone', () => {
    const packed = scratch()
    execSync(`pnpm pack --pack-destination "${packed}"`, {
      cwd: join(repo, 'packages', 'create-tessera'),
      env: pnpmEnv(packed),
      stdio: 'pipe',
    })
    const create = join(
      packed,
      readdirSync(packed).find((f) => f.includes('create-tessera') && f.endsWith('.tgz'))!,
    )

    // The create package depends on `@pixelscriptio/tessera`, which is not published yet: point that at the tarball.
    const dir = scratch()
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'runner',
        private: true,
        type: 'module',
        pnpm: { overrides: { '@pixelscriptio/tessera': `file:${tarball.replaceAll('\\', '/')}` } },
      }),
    )
    execSync(`pnpm add "${create}" --offline`, { cwd: dir, env: pnpmEnv(dir), stdio: 'pipe' })

    // Like `npm create @pixelscriptio/tessera my-site`: the bin runs `tessera init my-site`.
    const bin = join(
      dir,
      'node_modules',
      '@pixelscriptio',
      'create-tessera',
      'bin',
      'create-tessera.js',
    )
    const out = execFileSync(process.execPath, [bin, 'my-site', '--preset', 'none'], {
      cwd: dir,
      encoding: 'utf8',
    })
    expect(out).toContain('Started a Tessera project (none preset) in my-site.')
    expect(out).toContain('npm install')
    expect(existsSync(join(dir, 'my-site', 'app', 'pages', 'index.tess'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(dir, 'my-site', 'package.json'), 'utf8'))
    expect(manifest.dependencies['@pixelscriptio/tessera']).toMatch(/^\^\d/)
    expect(manifest.scripts.dev).toBe('tessera dev')
  }, 180_000)
})
