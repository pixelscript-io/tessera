import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import { presetFiles } from '../src/commands/init'
import type { Io } from '../src/io'
import { VERSION } from '../src/version'
import { read, run } from './helpers'

const made: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-init-'))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const files = (dir: string, paths: string[]) => paths.map((p) => [p, existsSync(join(dir, p))])

describe('tessera init --preset tailwind', () => {
  it('writes a full design system, three components and a styled page', async () => {
    const dir = scratch()
    const { code, out } = await run(dir, 'init', 'my-app', '--preset', 'tailwind')
    expect(code).toBe(0)
    expect(out).toContain('Started a Tessera project (tailwind preset) in my-app.')
    expect(out).toContain('npm install')
    expect(out).toContain('npm run dev')
    const root = join(dir, 'my-app')
    for (const [file, there] of files(root, [
      'package.json',
      'tessera.config.ts',
      'tsconfig.json',
      '.gitignore',
      'system/tokens/colors.tokens.json',
      'system/tokens/scale.tokens.json',
      'system/tokens/effects.tokens.json',
      'system/tokens/layout.tokens.json',
      'system/tokens/semantic.tokens.json',
      'system/tokens/themes/dark.tokens.json',
      'system/tokens/TAILWIND-LICENSE',
      'system/components/Button.tess',
      'system/components/Card.tess',
      'system/components/Badge.tess',
      'app/main.ts',
      'app/tess.d.ts',
      'app/layouts/default.tess',
      'app/pages/index.tess',
    ])) {
      expect(there, String(file)).toBe(true)
    }
    // A project needs no Vite config or HTML page of its own.
    expect(existsSync(join(root, 'vite.config.ts'))).toBe(false)
    expect(existsSync(join(root, 'index.html'))).toBe(false)
  })

  it('passes tessera check, with no contrast failure in either theme', async () => {
    const dir = scratch()
    await run(dir, 'init', '--preset', 'tailwind')
    const { code, out } = await run(dir, 'check')
    expect(out).toContain('0 errors, 0 warnings in 5 files.')
    expect(code).toBe(0)
  })

  it('has the design system the spec lists, built from Tailwind', async () => {
    const dir = scratch()
    await run(dir, 'init', '--preset', 'tailwind')
    const { out } = await run(dir, 'tokens', 'build')
    expect(out).toMatch(/Built \d{3} tokens/)
    const manifest = JSON.parse(read(dir, '.tessera/tokens/manifest.json')) as {
      tokens: Array<{ path: string }>
    }
    const paths = new Set(manifest.tokens.map((t) => t.path))
    for (const path of [
      'color.red.500',
      'color.slate.950',
      'color.black',
      'color.white',
      'space.4',
      'space.0-5',
      'radius.xl',
      'font.size.5xl',
      'font.weight.bold',
      'font.family.sans',
      'shadow.md',
      'shadow.inset-sm',
      'motion.easing.in-out',
      'motion.duration.fast',
      'opacity.disabled',
      'breakpoint.lg',
      'color.surface.default',
      'color.action.primary.bg',
    ]) {
      expect(paths.has(path), path).toBe(true)
    }
    expect(read(dir, 'system/tokens/themes/dark.tokens.json')).toContain(
      'prefers-color-scheme: dark',
    )
  })

  it("uses the design system's own Button, so there is one copy to maintain", () => {
    const repoButton = readFileSync(
      fileURLToPath(new URL('../../../system/components/Button.tess', import.meta.url)),
      'utf8',
    )
    expect(presetFiles('tailwind')['system/components/Button.tess']).toBe(repoButton)
  })
})

describe('tessera init --preset none', () => {
  it('writes no tokens, themes or components, and the examples commented out', async () => {
    const dir = scratch()
    await run(dir, 'init', '--preset', 'none')
    expect(existsSync(join(dir, 'system/components'))).toBe(false)
    expect(existsSync(join(dir, 'system/tokens/base.tokens.json'))).toBe(false)
    // Inert examples: not *.tokens.json and not *.tess, so nothing reads them until they are renamed.
    expect(existsSync(join(dir, 'system/tokens/base.tokens.json.example'))).toBe(true)
    expect(existsSync(join(dir, 'app/components/Example.tess.example'))).toBe(true)
    expect(read(dir, 'app/main.ts')).toContain("// import 'virtual:tessera/tokens.css'")
    expect(read(dir, 'app/pages/index.tess')).toContain('<!--')
    expect(read(dir, 'system/README.md')).toContain('Rename `tokens/base.tokens.json.example`')
  })

  it('passes tessera check', async () => {
    const dir = scratch()
    await run(dir, 'init', '--preset', 'none')
    const { code, out } = await run(dir, 'check')
    expect(out).toContain('0 errors, 0 warnings in 2 files.')
    expect(code).toBe(0)
  })

  it('has tokens after the example is renamed, as its README says', async () => {
    const dir = scratch()
    await run(dir, 'init', '--preset', 'none')
    writeFileSync(
      join(dir, 'system/tokens/base.tokens.json'),
      read(dir, 'system/tokens/base.tokens.json.example').replace(/\n\s*"\$comment"[^\n]*/g, ''),
    )
    const { out } = await run(dir, 'tokens', 'build')
    expect(out).toMatch(/Built \d+ tokens/)
  })
})

describe('tessera init: where and how it runs', () => {
  it('asks which preset in a terminal, and takes the answer', async () => {
    const dir = scratch()
    let asked = ''
    const io: Io = {
      cwd: dir,
      out: () => {},
      err: () => {},
      async choose(question, choices) {
        asked = `${question}: ${choices.map((c) => c.value).join(', ')}`
        return 'none'
      },
    }
    expect(await main(['init'], io)).toBe(0)
    expect(asked).toBe('Which starting point?: tailwind, none')
    expect(existsSync(join(dir, 'system/components'))).toBe(false)
  })

  it('does not ask when --preset is given, and uses tailwind with no terminal and no flag, saying so', async () => {
    const dir = scratch()
    let asked = false
    let output = ''
    const io: Io = {
      cwd: dir,
      out: (t) => void (output += t + '\n'),
      err: () => {},
      async choose() {
        asked = true
        return 'none'
      },
    }
    await main(['init', '--preset', 'tailwind'], io)
    expect(asked).toBe(false)

    const other = scratch()
    const quiet: Io = { cwd: other, out: (t) => void (output += t + '\n'), err: () => {} }
    await main(['init'], quiet)
    expect(output).toContain('No --preset given and no terminal to ask in, so using "tailwind".')
    expect(existsSync(join(other, 'system/components/Card.tess'))).toBe(true)
  })

  it('rejects a preset that does not exist', async () => {
    const { code, err } = await run(scratch(), 'init', '--preset', 'bootstrap')
    expect(code).toBe(1)
    expect(err).toContain('There is no preset "bootstrap".')
    expect(err).toContain('Presets: tailwind, none.')
  })

  it('works beside an existing package.json: adds scripts and the dependency, keeps everything else', async () => {
    const dir = scratch()
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'mine',
        version: '2.0.0',
        scripts: { test: 'vitest', dev: 'my-own-dev' },
        license: 'MIT',
      }),
    )
    writeFileSync(join(dir, '.gitignore'), 'node_modules\ncoverage')
    const { code, out } = await run(dir, 'init', '--preset', 'none')
    expect(code).toBe(0)
    const manifest = JSON.parse(read(dir, 'package.json'))
    expect(manifest).toMatchObject({
      name: 'mine',
      version: '2.0.0',
      license: 'MIT',
      scripts: {
        test: 'vitest',
        dev: 'my-own-dev',
        build: 'tessera build',
        preview: 'tessera preview',
        check: 'tessera check',
      },
      dependencies: { '@pixelscriptio/tessera': `^${VERSION}` },
    })
    expect(out).toContain('package.json (added script "build"')
    // .gitignore keeps what was there and gains what is missing.
    expect(read(dir, '.gitignore')).toBe('node_modules\ncoverage\ndist\n.tessera\n')
  })

  it('does not ask for npm install when the dependency is already there', async () => {
    const dir = scratch()
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'mine', dependencies: { '@pixelscriptio/tessera': '^0.1.0' } }),
    )
    const { out } = await run(dir, 'init', '--preset', 'none')
    expect(out).not.toContain('npm install')
    expect(out).toContain('npm run dev')
  })

  it('never overwrites a file, and lists what it left alone', async () => {
    const dir = scratch()
    mkdirSync(join(dir, 'app/pages'), { recursive: true })
    writeFileSync(join(dir, 'app/pages/index.tess'), '<template><main>mine</main></template>')
    const first = await run(dir, 'init', '--preset', 'tailwind')
    expect(first.out).toContain('Left alone (already there): app/pages/index.tess')
    expect(read(dir, 'app/pages/index.tess')).toBe('<template><main>mine</main></template>')

    // A second run changes nothing at all.
    const before = read(dir, 'app/layouts/default.tess')
    const second = await run(dir, 'init', '--preset', 'tailwind')
    expect(second.out).not.toContain('Wrote:')
    expect(read(dir, 'app/layouts/default.tess')).toBe(before)
  })

  it('can depend on a checkout of Tessera instead of the published version, for working on Tessera', async () => {
    const dir = scratch()
    await run(
      dir,
      'init',
      'app',
      '--preset',
      'none',
      '--link',
      join(dir, 'tessera', 'packages', 'tessera'),
    )
    const manifest = JSON.parse(read(join(dir, 'app'), 'package.json'))
    expect(manifest.dependencies['@pixelscriptio/tessera']).toBe('link:../tessera/packages/tessera')
  })

  it('writes the version of the package it ships in', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../tessera/package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    expect(VERSION).toBe(manifest.version)
  })
})
