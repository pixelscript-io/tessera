import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
/** A folder to start a project in. */
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-init-'))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The tokens the docs app styles itself from, when a project has them (the docs fall back when it does not). */
export const DOCS_TOKENS = [
  'color.surface.default',
  'color.surface.raised',
  'color.surface.hover',
  'color.text.default',
  'color.text.muted',
  'color.border.default',
  'color.action.primary.bg',
  'color.action.primary.fg',
  'color.focus.ring',
  'color.status.success',
  'color.status.danger',
  'font.family.sans',
  'font.family.mono',
  'radius.sm',
]

const files = (dir: string, paths: string[]) => paths.map((p) => [p, existsSync(join(dir, p))])

/** What every preset starts with: the app, its two components, and the shared state and API examples. */
const STARTER = [
  'package.json',
  'tessera.config.ts',
  'tsconfig.json',
  '.gitignore',
  'app/main.ts',
  'app/tess.d.ts',
  'app/layouts/default.tess',
  'app/pages/index.tess',
  'app/apis/default.ts',
  'app/apis/default.api.json',
  'app/state/counter.ts',
  'system/components/Button.tess',
  'system/components/Button.docs.md',
  'system/components/Card.tess',
  'system/components/Card.docs.md',
]

for (const [preset, folder, name] of [
  ['tailwind', 'tailwind', 'Tailwind'],
  ['unstyled', 'unstyled', 'Unstyled'],
] as const) {
  describe(`tessera init --preset ${preset}`, () => {
    it('writes the starter app, a Button and a Card, and the tokens of its own design system', async () => {
      const dir = scratch()
      const { code, out } = await run(dir, 'init', 'my-app', '--preset', preset)
      expect(code).toBe(0)
      expect(out).toContain(`Started a Tessera project (${preset} preset) in my-app.`)
      expect(out).toContain('npm install')
      expect(out).toContain('npm run dev')
      const root = join(dir, 'my-app')
      for (const [file, there] of files(root, [
        ...STARTER,
        `system/${folder}/tokens/colors.tokens.json`,
        `system/${folder}/tokens/scale.tokens.json`,
        `system/${folder}/tokens/effects.tokens.json`,
        `system/${folder}/tokens/themes/dark.tokens.json`,
      ])) {
        expect(there, String(file)).toBe(true)
      }
      // Two components only, and tokens only in the system's own folder.
      expect(readdirSync(join(root, 'system/components')).sort()).toEqual([
        'Button.docs.md',
        'Button.tess',
        'Card.docs.md',
        'Card.tess',
      ])
      expect(existsSync(join(root, 'system/tokens'))).toBe(false)
      // A project needs no Vite config or HTML page of its own.
      expect(existsSync(join(root, 'vite.config.ts'))).toBe(false)
      expect(existsSync(join(root, 'index.html'))).toBe(false)
    })

    it('names its design system in the config, and does not depend on a component library', async () => {
      const dir = scratch()
      await run(dir, 'init', '--preset', preset)
      const config = read(dir, 'tessera.config.ts')
      expect(config).toContain(`systems: [{ name: '${name}', path: '/${folder}' }]`)
      expect(config).toContain(`defaultSystem: '${name}'`)
      expect(config).toContain('// docs: false')
      const manifest = JSON.parse(read(dir, 'package.json')) as {
        dependencies: Record<string, string>
      }
      expect(Object.keys(manifest.dependencies)).toEqual(['@pixelscriptio/tessera'])
    })

    it('passes tessera check, with no contrast failure in either theme', async () => {
      const dir = scratch()
      await run(dir, 'init', '--preset', preset)
      const { code, out } = await run(dir, 'check')
      expect(out).toMatch(/0 errors, 0 warnings in \d+ files\./)
      expect(code).toBe(0)
    })

    it('has the tokens the docs follow, and a dark theme', async () => {
      const dir = scratch()
      await run(dir, 'init', '--preset', preset)
      await run(dir, 'tokens', 'build')
      const manifest = JSON.parse(read(dir, '.tessera/tokens/manifest.json')) as {
        tokens: Array<{ path: string }>
        themes: Array<{ name: string }>
      }
      const paths = new Set(manifest.tokens.map((t) => t.path))
      for (const path of DOCS_TOKENS) expect(paths.has(path), path).toBe(true)
      expect(manifest.themes.map((t) => t.name)).toEqual(['dark'])
    })

    it('has the same Button and Card as the Tessera UI catalogue, so there is one copy of each', () => {
      const ui = (file: string) =>
        readFileSync(fileURLToPath(new URL(`../../ui/components/${file}`, import.meta.url)), 'utf8')
      const written = presetFiles(preset)
      for (const file of ['Button.tess', 'Button.docs.md', 'Card.tess', 'Card.docs.md']) {
        expect(written[`system/components/${file}`], file).toBe(ui(file))
      }
    })
  })
}

describe('tessera init --preset tailwind: the tokens', () => {
  it('are built from Tailwind, with its license', async () => {
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
    expect(existsSync(join(dir, 'system/tailwind/tokens/TAILWIND-LICENSE'))).toBe(true)
    expect(read(dir, 'system/tailwind/tokens/themes/dark.tokens.json')).toContain(
      'prefers-color-scheme: dark',
    )
  })
})

describe('tessera init --preset unstyled: the tokens', () => {
  it('have plain values: square corners, no shadow, and a README with examples of changing them', async () => {
    const dir = scratch()
    await run(dir, 'init', '--preset', 'unstyled')
    await run(dir, 'tokens', 'build')
    const manifest = JSON.parse(read(dir, '.tessera/tokens/manifest.json')) as {
      tokens: Array<{ path: string; values: { base: { css: string } } }>
    }
    const css = (path: string) => manifest.tokens.find((t) => t.path === path)?.values.base.css
    expect(css('radius.md')).toBe('0px')
    expect(css('color.surface.default')).toBe('#ffffff')
    expect(manifest.tokens.length).toBeLessThan(80)
    expect(existsSync(join(dir, 'system/unstyled/tokens/TAILWIND-LICENSE'))).toBe(false)
    expect(read(dir, 'system/unstyled/tokens/README.md')).toContain('Round the corners.')
  })
})

describe('the starter app', () => {
  it('shows a counter from shared state and a list from an API call, with the same page in every preset', () => {
    for (const preset of ['tailwind', 'unstyled'] as const) {
      const page = presetFiles(preset)['app/pages/index.tess']!
      expect(page, preset).toContain('counter.bump()')
      expect(page, preset).toContain("get('/objects')")
    }
    expect(presetFiles('tailwind')['app/pages/index.tess']).toBe(
      presetFiles('unstyled')['app/pages/index.tess'],
    )
    expect(presetFiles('tailwind')['app/state/counter.ts']).toContain('export function bump')
  })
})

describe('earlier presets', () => {
  it('say what to use now', async () => {
    const dir = scratch()
    const tessera = await run(dir, 'init', '--preset', 'tessera')
    expect(tessera.code).toBe(1)
    expect(tessera.err).toContain('There is no preset "tessera".')
    expect(tessera.err).toContain('--preset tailwind')
    expect(tessera.err).toContain('tessera add tokens:tessera')
    const none = await run(dir, 'init', '--preset', 'none')
    expect(none.code).toBe(1)
    expect(none.err).toContain('--preset unstyled')
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
        return 'unstyled'
      },
    }
    expect(await main(['init'], io)).toBe(0)
    expect(asked).toBe('Which starting point?: tailwind, unstyled')
    expect(existsSync(join(dir, 'system/unstyled/tokens/colors.tokens.json'))).toBe(true)
    expect(existsSync(join(dir, 'system/tailwind'))).toBe(false)
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
        return 'unstyled'
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
    expect(err).toContain('Presets: tailwind, unstyled.')
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
    const { code, out } = await run(dir, 'init', '--preset', 'unstyled')
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
    const { out } = await run(dir, 'init', '--preset', 'unstyled')
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
      'unstyled',
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

describe('tessera init: files for AI tools', () => {
  for (const preset of ['tailwind', 'unstyled']) {
    it(`writes AGENTS.md, llms.txt, CLAUDE.md and .mcp.json (${preset} preset)`, async () => {
      const dir = scratch()
      const { code } = await run(dir, 'init', 'my-app', '--preset', preset)
      expect(code).toBe(0)
      const root = join(dir, 'my-app')
      for (const file of ['AGENTS.md', 'llms.txt', 'CLAUDE.md', '.mcp.json'])
        expect(existsSync(join(root, file)), file).toBe(true)
      const agents = read(root, 'AGENTS.md')
      expect(agents.startsWith('<!-- Generated by `tessera agent-files`')).toBe(true)
      expect(agents).toContain('## How a Tessera app is written')
      expect(agents).toContain('node_modules/@pixelscriptio/tessera/dist/docs/llms-full.txt')
      expect(agents).toContain('npm run check')
      expect(agents).toMatch(/a bare `npx tessera` can download an unrelated package/i)
      expect(read(root, 'CLAUDE.md')).toBe('@AGENTS.md\n')
      expect(JSON.parse(read(root, '.mcp.json'))).toEqual({
        mcpServers: { tessera: { command: 'npx', args: ['@pixelscriptio/tessera', 'mcp'] } },
      })
    })
  }

  it('never tells a tool to run a bare "npx tessera", which can fetch an unrelated package', async () => {
    const dir = scratch()
    await run(dir, 'init', 'my-app', '--preset', 'tailwind')
    const root = join(dir, 'my-app')
    // The one sentence that explains the danger is the only place the bare form appears.
    const explained = read(root, 'AGENTS.md').replaceAll(/a bare `npx tessera` can download/gi, '')
    for (const file of ['llms.txt', '.mcp.json'])
      expect(read(root, file), file).not.toMatch(/npx tessera\b/)
    expect(explained).not.toMatch(/npx tessera\b/)
    expect(read(root, '.mcp.json')).toContain('@pixelscriptio/tessera')
  })

  it('lists the components of the preset, and agent-files then finds nothing to change', async () => {
    const dir = scratch()
    await run(dir, 'init', 'my-app', '--preset', 'tailwind')
    const root = join(dir, 'my-app')
    expect(read(root, 'AGENTS.md')).toContain('`Button`')
    expect(read(root, 'llms.txt')).toContain('Button:')
    const again = await run(root, 'agent-files')
    expect(again.out).toContain('Up to date: AGENTS.md')
    expect(again.out).toContain('Up to date: llms.txt')
  })

  it('leaves a file that is already there alone, and says so', async () => {
    const dir = scratch()
    mkdirSync(join(dir, 'my-app'))
    writeFileSync(join(dir, 'my-app', 'AGENTS.md'), '# Mine\n')
    const { out } = await run(dir, 'init', 'my-app', '--preset', 'unstyled')
    expect(readFileSync(join(dir, 'my-app', 'AGENTS.md'), 'utf8')).toBe('# Mine\n')
    expect(out).toContain('AGENTS.md')
    expect(existsSync(join(dir, 'my-app', 'CLAUDE.md'))).toBe(true)
  })
})
