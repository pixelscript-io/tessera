import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import type { Io } from '../src/io'
import { buildRegistry, writeRegistry } from '../src/registry/build'
import { applyMap, needsOf, parseMap } from '../src/token-fit'

const ui = fileURLToPath(new URL('../../ui', import.meta.url)).replaceAll('\\', '/')
const cli = fileURLToPath(new URL('..', import.meta.url))

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const color = (r: number, g: number, b: number) => ({
  $value: { colorSpace: 'srgb', components: [r, g, b] },
})
const rem = (value: number) => ({ $value: { value, unit: 'rem' } })

/**
 * Badge uses: color.action.danger.bg/fg, color.action.primary.bg/fg, color.surface.hover, color.text.default,
 * font.size.xs, radius.sm, space.1 and space.3. This system defines all but color.action.primary.bg and space.3,
 * and gives radius.sm the wrong type.
 */
const semantic = { $extensions: { tessera: { tier: 'semantic' } } }
const SYSTEM_BASE = {
  color: {
    ...semantic,
    $type: 'color',
    action: {
      danger: { bg: color(0.8, 0.1, 0.1), fg: color(1, 1, 1) },
      primary: { fg: color(1, 1, 1) },
    },
    surface: { hover: color(0.9, 0.9, 0.9) },
    text: { default: color(0.1, 0.1, 0.1) },
  },
  font: { ...semantic, size: { $type: 'dimension', xs: rem(0.75) } },
  radius: {
    ...semantic,
    sm: { $type: 'color', ...color(0, 0, 0) },
    md: { $type: 'dimension', ...rem(0.375) },
  },
  space: { ...semantic, $type: 'dimension', 1: rem(0.25) },
}
const SYSTEM_DARK = {
  $extends: 'base',
  $auto: 'prefers-color-scheme: dark',
  color: {
    surface: { hover: { $value: { colorSpace: 'srgb', components: [0.2, 0.2, 0.2] } } },
    text: { default: { $value: { colorSpace: 'srgb', components: [0.95, 0.95, 0.95] } } },
  },
}

function writeAll(root: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), content)
  }
}

/** A project with one design system, `Mine`, that lacks some of what Badge needs. */
function newProject(systems = ['Mine'], extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'tessera-fit-'))
  roots.push(root)
  writeAll(root, {
    'package.json': '{ "name": "mine", "type": "module" }\n',
    'tessera.config.ts': `export default { systems: [${systems.map((s) => `{ name: '${s}', path: '/${s.toLowerCase()}' }`).join(', ')}] }\n`,
    'app/pages/index.tess': '<template><main>Hi</main></template>\n',
    'system/components/.keep': '',
    'system/mine/tokens/base.tokens.json': JSON.stringify(SYSTEM_BASE, null, 2),
    'system/mine/tokens/themes/dark.tokens.json': JSON.stringify(SYSTEM_DARK, null, 2),
    ...extra,
  })
  return root
}

async function add(
  cwd: string,
  argv: string[],
  answers: { choose?: string[] } = {},
): Promise<{ code: number; out: string; asked: Array<{ question: string; choices: string[] }> }> {
  let out = ''
  const asked: Array<{ question: string; choices: string[] }> = []
  const choose = [...(answers.choose ?? [])]
  const io: Io = {
    cwd,
    out: (t) => void (out += t + '\n'),
    err: (t) => void (out += t + '\n'),
    ...(answers.choose
      ? {
          choose: async (question, choices) => {
            asked.push({ question, choices: choices.map((c) => c.label) })
            return choose.shift()!
          },
          ask: async () => '',
        }
      : {}),
  }
  const code = await main(['add', ...argv], io)
  return { code, out, asked }
}

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')
const catalogue = ['--from', ui]

describe('the tokens a component uses', () => {
  it('lists the tokens of the style blocks, with the component that uses each and the type the reference gives it', () => {
    const needs = needsOf([
      {
        path: 'Chip.tess',
        content:
          '<template><b>x</b></template>\n<style>\n b { color: $color.text.default; padding: $space.4; margin: $space.4 }\n</style>',
      },
      { path: 'Chip.docs.md', content: 'uses $space.9 in prose' },
    ])
    expect(needs).toEqual([
      { path: 'color.text.default', type: 'color', by: ['Chip'] },
      { path: 'space.4', type: 'dimension', by: ['Chip'] },
    ])
  })

  it('leaves the type undefined for a token the reference set does not define', () => {
    const [need] = needsOf([
      { path: 'Chip.tess', content: '<style>b { color: $brand.accent.main }</style>' },
    ])
    expect(need).toEqual({ path: 'brand.accent.main', type: undefined, by: ['Chip'] })
  })
})

describe('--map', () => {
  it('reads pairs, from repeated flags too', () => {
    expect([...parseMap('a.b=c.d,e.f=g.h')]).toEqual([
      ['a.b', 'c.d'],
      ['e.f', 'g.h'],
    ])
  })

  it('refuses a pair that is not two token paths', () => {
    expect(() => parseMap('a.b')).toThrow(/not a token mapping/)
    expect(() => parseMap('a=b')).toThrow(/not a token mapping/)
    expect(() => parseMap('a.b=c.d=e.f')).toThrow(/not a token mapping/)
  })

  it('rewrites tokens in styles and nothing else', () => {
    const [file, docs] = applyMap(
      [
        {
          path: 'Chip.tess',
          content:
            '<template><b>$color.a.b</b></template>\n<style>b { color: $color.a.b; border: $color.a.bc }</style>',
        },
        { path: 'Chip.docs.md', content: '$color.a.b' },
      ],
      new Map([['color.a.b', 'color.x.y']]),
    )
    expect(file!.content).toContain('<b>$color.a.b</b>')
    expect(file!.content).toContain('color: $color.x.y;')
    expect(file!.content).toContain('border: $color.a.bc')
    expect(docs!.content).toBe('$color.a.b')
  })
})

describe('tessera add: token fit', () => {
  it('reports, per design system, what is missing and what has the wrong type, and still writes the component', async () => {
    const root = newProject()
    const { code, out } = await add(root, ['Badge', ...catalogue])
    expect(code).toBe(0)
    expect(out).toMatch(/Mine:/)
    expect(out).toMatch(/missing\s+color\.action\.primary\.bg \(a color\) \(Badge\)/)
    expect(out).toMatch(/missing\s+space\.3 \(a dimension\) \(Badge\)/)
    expect(out).toMatch(
      /wrong type\s+radius\.sm is a color here, and the components expect a dimension/,
    )
    expect(out).not.toMatch(/missing\s+space\.1/)
    expect(existsSync(join(root, 'system/components/Badge.tess'))).toBe(true)
    // The ways to fix it are named.
    expect(out).toContain('--fit add')
    expect(out).toContain('--map')
    expect(out).toContain('--fit set')
  })

  it('says nothing about tokens when every system has them all', async () => {
    const root = newProject()
    // Replace the system with the whole reference set.
    rmSync(join(root, 'system/mine'), { recursive: true })
    const registry = mkdtempSync(join(tmpdir(), 'tessera-fit-reg-'))
    roots.push(registry)
    writeRegistry(
      buildRegistry({
        uiDir: ui,
        tokenSets: [
          {
            name: 'tailwind',
            description: 'x',
            dir: join(cli, 'templates/tailwind/system/tailwind/tokens'),
          },
        ],
        minTessera: '0.8.0',
        npmVersions: { lucide: '1.62.0' },
      }),
      registry,
    )
    await add(root, ['tokens:tailwind', '--as', 'mine', '--from', registry])
    const { out } = await add(root, ['Badge', ...catalogue])
    expect(out).not.toMatch(/missing/)
    expect(out).not.toMatch(/wrong type/)
  })

  it('names every system that falls short, and the ones that do not', async () => {
    const root = newProject(['Mine', 'Other'], {
      'system/other/tokens/base.tokens.json': JSON.stringify({
        color: { $type: 'color', x: color(0, 0, 0) },
      }),
    })
    const { out } = await add(root, ['Badge', ...catalogue])
    expect(out).toMatch(/Mine:/)
    expect(out).toMatch(/Other:/)
    // Other lacks everything Badge uses.
    expect(out).toMatch(/missing\s+space\.1 /)
  })

  it('is silent when the project has no tokens to compare', async () => {
    const root = newProject([], { 'tessera.config.ts': 'export default {}\n' })
    rmSync(join(root, 'system/mine'), { recursive: true })
    const { code, out } = await add(root, ['Badge', ...catalogue])
    expect(code).toBe(0)
    expect(out).not.toMatch(/missing/)
  })

  describe('--fit add', () => {
    it('writes the missing tokens in a marked file, with the reference values, and the dark ones in the dark theme', async () => {
      const root = newProject()
      const { code, out } = await add(root, ['Badge', '--fit', 'add', ...catalogue])
      expect(code).toBe(0)
      const marked = JSON.parse(read(root, 'system/mine/tokens/tessera-ui.tokens.json')) as any
      expect(Object.keys(marked)).toEqual(['color', 'space'])
      expect(marked.color.action.primary.bg.$type).toBe('color')
      expect(marked.color.action.primary.bg.$value.colorSpace).toBeDefined()
      expect(marked.color.action.primary.bg.$description).toMatch(/Added by tessera add/)
      expect(marked.space['3'].$type).toBe('dimension')
      expect(marked.space['3'].$value).toEqual({ value: 0.75, unit: 'rem' })
      // The reference gives the primary action another value in the dark theme; it goes into the system's dark file,
      // beside the override that was already there.
      const dark = JSON.parse(read(root, 'system/mine/tokens/themes/dark.tokens.json')) as any
      expect(dark.color.action.primary.bg.$value.colorSpace).toBeDefined()
      expect(dark.color.surface.hover).toBeDefined()
      expect(out).toContain('system/mine/tokens/tessera-ui.tokens.json')
      expect(out).toContain('system/mine/tokens/themes/dark.tokens.json')
      // What it cannot fix is still reported: a wrong type needs --map.
      expect(out).toMatch(/radius\.sm is a color here/)
    })

    it('leaves a system with every token alone, and does not touch a system without the dark theme', async () => {
      const root = newProject(['Mine'], {})
      rmSync(join(root, 'system/mine/tokens/themes'), { recursive: true })
      await add(root, ['Badge', '--fit', 'add', ...catalogue])
      expect(existsSync(join(root, 'system/mine/tokens/themes'))).toBe(false)
      expect(existsSync(join(root, 'system/mine/tokens/tessera-ui.tokens.json'))).toBe(true)
    })

    it('makes the tokens build, and the check pass for the tokens it added', async () => {
      const root = newProject()
      const { out } = await add(root, [
        'Badge',
        '--fit',
        'add',
        '--map',
        'radius.sm=radius.md',
        ...catalogue,
      ])
      expect(out).not.toMatch(/error/i)
      const second = await add(root, ['Badge', '--replace', ...catalogue])
      // Run again: nothing missing is left.
      expect(second.out).not.toMatch(/missing\s+(color|space)/)
    })

    it('adds to the file it made before, without losing what it wrote', async () => {
      const root = newProject()
      await add(root, ['Badge', '--fit', 'add', ...catalogue])
      const before = JSON.parse(read(root, 'system/mine/tokens/tessera-ui.tokens.json')) as any
      // A second component needing more tokens extends the same file.
      await add(root, ['Alert', '--fit', 'add', ...catalogue])
      const after = JSON.parse(read(root, 'system/mine/tokens/tessera-ui.tokens.json')) as any
      expect(after.color.action.primary.bg).toEqual(before.color.action.primary.bg)
      expect(JSON.stringify(after).length).toBeGreaterThan(JSON.stringify(before).length)
    })
  })

  describe('--map', () => {
    it('rewrites the component to use your token, and then checks the fit against it', async () => {
      const root = newProject()
      const { out } = await add(root, [
        'Badge',
        '--map',
        'color.action.primary.bg=color.surface.hover,radius.sm=radius.md',
        ...catalogue,
      ])
      const badge = read(root, 'system/components/Badge.tess')
      expect(badge).not.toContain('$color.action.primary.bg')
      expect(badge).toContain('$color.surface.hover')
      expect(badge).toContain('$radius.md')
      // Mapped onto tokens the system has, only space.3 is left.
      expect(out).not.toMatch(/missing\s+color\.action\.primary\.bg/)
      expect(out).toMatch(/missing\s+space\.3/)
      expect(out).not.toMatch(/wrong type/)
    })

    it('reports a token it was mapped to when the system lacks that too', async () => {
      const root = newProject()
      const { out } = await add(root, [
        'Badge',
        '--map',
        'color.action.primary.bg=color.brand.bg',
        ...catalogue,
      ])
      expect(out).toMatch(/missing\s+color\.brand\.bg/)
    })

    it('refuses a mapping from a token no component being added uses', async () => {
      const root = newProject()
      const { code, out } = await add(root, [
        'Badge',
        '--map',
        'color.nope.x=color.brand.bg',
        ...catalogue,
      ])
      expect(code).not.toBe(0)
      expect(out).toMatch(/no component you are adding uses color\.nope\.x/)
      expect(existsSync(join(root, 'system/components/Badge.tess'))).toBe(false)
    })

    it('refuses a mapping that is not two token paths', async () => {
      const root = newProject()
      const { code, out } = await add(root, ['Badge', '--map', 'oops', ...catalogue])
      expect(code).not.toBe(0)
      expect(out).toMatch(/not a token mapping/)
    })

    it('takes --map more than once', async () => {
      const root = newProject()
      await add(root, [
        'Badge',
        '--map',
        'radius.sm=radius.md',
        '--map',
        'space.3=space.1',
        ...catalogue,
      ])
      const badge = read(root, 'system/components/Badge.tess')
      expect(badge).not.toContain('$space.3')
      expect(badge).not.toContain('$radius.sm')
    })
  })

  describe('--fit set', () => {
    it('installs the reference set as another design system and says how to list it', async () => {
      const root = newProject()
      const registry = mkdtempSync(join(tmpdir(), 'tessera-fit-reg-'))
      roots.push(registry)
      writeRegistry(
        buildRegistry({
          uiDir: ui,
          tokenSets: [
            {
              name: 'tailwind',
              description: 'x',
              dir: join(cli, 'templates/tailwind/system/tailwind/tokens'),
            },
          ],
          minTessera: '0.8.0',
          npmVersions: { lucide: '1.62.0' },
        }),
        registry,
      )
      const { code, out } = await add(root, ['Badge', '--fit', 'set', '--from', registry])
      expect(code).toBe(0)
      expect(existsSync(join(root, 'system/tailwind/tokens/semantic.tokens.json'))).toBe(true)
      expect(out).toContain("{ name: 'Tailwind', path: '/tailwind' }")
      // Your system is left as it was.
      expect(existsSync(join(root, 'system/mine/tokens/tessera-ui.tokens.json'))).toBe(false)
    })

    it('says so when the registry has no reference set', async () => {
      const root = newProject()
      const { code, out } = await add(root, ['Badge', '--fit', 'set', ...catalogue])
      expect(code).not.toBe(0)
      expect(out).toMatch(/no "tokens:tailwind"/)
      expect(existsSync(join(root, 'system/components/Badge.tess'))).toBe(false)
    })
  })

  describe('asking', () => {
    it('offers the fixes in a terminal, and writes nothing on cancel', async () => {
      const root = newProject()
      const { code, asked } = await add(root, ['Badge', ...catalogue], { choose: ['cancel'] })
      expect(code).toBe(1)
      expect(asked).toHaveLength(1)
      expect(asked[0]!.choices.map((c) => c.split(':')[0])).toEqual([
        'add',
        'set',
        'continue',
        'cancel',
      ])
      expect(existsSync(join(root, 'system/components/Badge.tess'))).toBe(false)
    })

    it('adds the tokens when that is what is chosen', async () => {
      const root = newProject()
      await add(root, ['Badge', ...catalogue], { choose: ['add'] })
      expect(existsSync(join(root, 'system/mine/tokens/tessera-ui.tokens.json'))).toBe(true)
      expect(existsSync(join(root, 'system/components/Badge.tess'))).toBe(true)
    })

    it('continues without a fix when told to', async () => {
      const root = newProject()
      const { code } = await add(root, ['Badge', ...catalogue], { choose: ['continue'] })
      expect(code).toBe(0)
      expect(existsSync(join(root, 'system/components/Badge.tess'))).toBe(true)
      expect(existsSync(join(root, 'system/mine/tokens/tessera-ui.tokens.json'))).toBe(false)
    })

    it('does not ask when a fix was given, or --yes was', async () => {
      const root = newProject()
      const { asked } = await add(root, ['Badge', '--fit', 'add', ...catalogue], { choose: [] })
      expect(asked).toHaveLength(0)
      const other = newProject()
      const second = await add(other, ['Badge', '--yes', ...catalogue], { choose: [] })
      expect(second.asked).toHaveLength(0)
    })

    it('does not ask when nothing is missing', async () => {
      const root = newProject()
      await add(root, ['Badge', '--fit', 'add', '--map', 'radius.sm=radius.md', ...catalogue])
      const { asked } = await add(
        root,
        ['Badge', '--replace', '--map', 'radius.sm=radius.md', ...catalogue],
        {
          choose: [],
        },
      )
      expect(asked).toHaveLength(0)
    })
  })

  it('refuses a --fit value it does not know', async () => {
    const root = newProject()
    const { code, out } = await add(root, ['Badge', '--fit', 'mend', ...catalogue])
    expect(code).not.toBe(0)
    expect(out).toMatch(/"--fit" is add, set or skip/)
  })

  it('--fit skip reports nothing and fixes nothing', async () => {
    const root = newProject()
    const { out } = await add(root, ['Badge', '--fit', 'skip', ...catalogue])
    expect(out).not.toMatch(/wrong type/)
    expect(out).not.toContain('--fit add')
    expect(existsSync(join(root, 'system/components/Badge.tess'))).toBe(true)
  })

  describe('after the component is written', () => {
    it('checks the new components, and says what is wrong with them', async () => {
      const root = newProject()
      const { code, out } = await add(root, ['Badge', ...catalogue])
      // Without the fix, Badge uses tokens the system lacks, and the check says so.
      expect(out).toMatch(/Checked Badge/)
      expect(out).toMatch(/error|T\d{4}/)
      expect(code).toBe(0)
    })

    it('reports a clean check once the tokens are there', async () => {
      const root = newProject()
      const { out } = await add(root, [
        'Badge',
        '--fit',
        'add',
        '--map',
        'radius.sm=radius.md',
        ...catalogue,
      ])
      expect(out).toMatch(/Checked Badge: no problems/)
    })

    it('points to the generated accessibility tests', async () => {
      const root = newProject()
      const { out } = await add(root, [
        'Badge',
        '--fit',
        'add',
        '--map',
        'radius.sm=radius.md',
        ...catalogue,
      ])
      expect(out).toContain('npx tessera a11y')
    })
  })
})
