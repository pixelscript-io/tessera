import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import { presetFiles } from '../src/commands/init'
import { fetchComponentSet, fetchImages, parseSource, tokenFromEnv } from '../src/figma/fetch'
import { importComponentSet } from '../src/figma/import'
import { learn, winner } from '../src/figma/learn'
import { FigmaError, type ComponentSetFile, type FigmaMap } from '../src/figma/model'
import type { Io } from '../src/io'

// Importing a Figma component. The fixture is the Button of the Untitled UI file (Buttons page, 380 variants), as the
// REST API gives it, without the vector geometry; the map is the one the docs show.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const fixtures = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures/figma/button',
).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-figma')
mkdirSync(scratch, { recursive: true })
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }))

const file = JSON.parse(readFileSync(`${fixtures}/button-set.json`, 'utf8')) as ComponentSetFile
const map = JSON.parse(readFileSync(`${fixtures}/figma.map.json`, 'utf8')) as FigmaMap
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function project(): string {
  const root = mkdtempSync(join(scratch, 'p-')).replaceAll('\\', '/')
  writeFileSync(join(root, 'package.json'), '{ "name": "figma" }\n')
  for (const [name, content] of Object.entries(presetFiles('tailwind'))) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return root
}

function io(cwd: string) {
  const lines: string[] = []
  const errors: string[] = []
  const handle: Io = { cwd, out: (t) => void lines.push(t), err: (t) => void errors.push(t) }
  return { handle, out: () => lines.join('\n'), err: () => errors.join('\n') }
}

const fails = (fn: () => unknown): FigmaError => {
  try {
    fn()
  } catch (error) {
    if (error instanceof FigmaError) return error
    throw error
  }
  throw new Error('It did not fail.')
}

describe('importing the Button', () => {
  const result = importComponentSet(file, map)

  it('reads every variant and says what each property is', () => {
    expect(result.report.mapped).toEqual(
      expect.arrayContaining([
        '380 variants of "Buttons/Button"',
        'Size (5 values) is the prop "size"',
        'Hierarchy (7 values) is the prop "hierarchy"',
        'Icon (3 values) is the prop "icon"',
        'State (4 values) is the state: Default (none), Hover :hover, Focused :focus-visible, Disabled :disabled',
      ]),
    )
  })

  it('writes a contract with the default first, the states as states, and the slots', () => {
    const contract = JSON.parse(/<contract>\n([\s\S]*?)\n<\/contract>/.exec(result.tess)![1]!)
    expect(contract.name).toBe('Button')
    expect(contract.variants.size).toEqual(['md', 'sm', 'lg', 'xl', '2xl'])
    expect(contract.variants.hierarchy[0]).toBe('primary')
    expect(contract.variants.hierarchy).toContain('secondary-gray')
    expect(contract.variants.icon).toEqual(['default', 'dot-leading', 'only'])
    expect(contract.states).toEqual(['hover', 'focus-visible', 'disabled'])
    expect(contract.parts).toEqual(['root', 'icon', 'label', 'icon-end'])
    expect(Object.keys(contract.slots)).toEqual(['default', 'icon', 'icon-end'])
    expect(contract.behavior).toBe('press')
  })

  it('writes each state as a pseudo-class, with the hover that does not apply to a disabled button', () => {
    expect(result.tess).toContain(':where(:not(:hover, :focus-visible, :disabled))')
    expect(result.tess).toMatch(
      /\.root\[data-hierarchy='[a-z-]+'\]:hover:where\(:not\(:disabled\)\) \{/,
    )
    expect(result.tess).toMatch(/\.root:focus-visible/)
    expect(result.tess).toMatch(/\.root\[data-hierarchy='[a-z-]+'\]:disabled \{/)
  })

  it('writes no raw value for what a token can be, and no stroke that changes the size', () => {
    const style = /<style>([\s\S]*)<\/style>/.exec(result.tess)![1]!
    expect(style).not.toMatch(/(?:padding|gap|border-radius|font-size): [^$;]*\d+px/)
    expect(style).not.toMatch(/\bborder-width\b/)
    // A stroke is an outline pulled inward: the design's strokes sit inside the box.
    expect(style).toMatch(/outline: 1px solid \$color\.figma-/)
    expect(style).toMatch(/outline-offset: -1px/)
  })

  it('names tokens after the styles of the design, and the rest after their values', () => {
    const colors = Object.keys((result.tokens.color as Record<string, unknown>) ?? {})
    expect(colors).toEqual(expect.arrayContaining(['figma-brand-600', 'figma-base-white']))
    expect(Object.keys(result.tokens)).toEqual(
      expect.arrayContaining(['color', 'space', 'radius', 'shadow', 'font']),
    )
    const shadow = (result.tokens.shadow as Record<string, any>)[
      'figma-shadows-shadow-xs-skeuomorphic'
    ]
    // The look of the primary button: a drop shadow and two inner ones, as in the design.
    expect(shadow.$value).toHaveLength(3)
    expect(shadow.$value.filter((l: { inset?: boolean }) => l.inset)).toHaveLength(2)
    expect(result.report.unbound.length).toBeGreaterThan(0)
  })

  it('gives every variant what the design has, for every property of every part (checked as it is written)', () => {
    // The importer replays the stylesheet against the design and throws F009 if one variant would differ. Importing
    // the whole set without that error is the check.
    expect(result.variants).toHaveLength(380)
    expect(result.variants.every((v) => v.boxes.root)).toBe(true)
  })

  it('records where each part is, so the test can compare', () => {
    const md = result.variants.find(
      (v) => v.name === 'Size=md, Hierarchy=Primary, Icon=Default, State=Default',
    )!
    expect(md.width).toBe(158)
    expect(md.height).toBe(40)
    expect(Object.keys(md.boxes)).toEqual(['root', 'icon', 'label', 'icon-end'])
    expect(md.boxes.icon).toEqual({ x: 14, y: 10, width: 20, height: 20 })
    // The focus ring reaches past the box.
    const focused = result.variants.find(
      (v) =>
        v.name.endsWith('State=Focused') &&
        v.name.includes('Size=md, Hierarchy=Primary, Icon=Default'),
    )!
    expect(focused.bleed.left).toBeGreaterThan(0)
  })
})

describe('what the map must say', () => {
  it('stops at a variant property it does not have', () => {
    const m = clone(map)
    delete m.props.Hierarchy
    const e = fails(() => importComponentSet(file, m))
    expect(e.code).toBe('F003')
    expect(e.message).toBe('The variant property "Hierarchy" is not in the map.')
    expect(e.hint).toContain('Add it to "props"')
  })

  it('stops at a boolean or a swap that is not accounted for', () => {
    const m = clone(map)
    delete m.ignore!['⬅️ Icon leading#3287:1577']
    const e = fails(() => importComponentSet(file, m))
    expect(e.code).toBe('F005')
    expect(e.message).toBe('The boolean property "⬅️ Icon leading#3287:1577" is not in the map.')
  })

  it('stops at a state value with no pseudo-class', () => {
    const m = clone(map)
    delete (m.props.State as { states: Record<string, unknown> }).states.Hover
    const e = fails(() => importComponentSet(file, m))
    expect(e.code).toBe('F004')
    expect(e.message).toBe('The state values "Hover" of "State" are not in the map.')
  })

  it('stops at a property the set does not have', () => {
    const m = clone(map)
    m.props.Colour = { prop: 'colour' }
    const e = fails(() => importComponentSet(file, m))
    expect(e.code).toBe('F006')
    expect(e.message).toBe('The map names the property "Colour", which the set does not have.')
  })

  it('stops at the wrong set, a kind it cannot build and parts with no root', () => {
    expect(fails(() => importComponentSet(file, { ...map, component: 'Cards' })).message).toBe(
      'The map is for the component set "Cards", but the file has "Buttons/Button".',
    )
    expect(fails(() => importComponentSet(file, { ...map, kind: 'dialog' })).message).toBe(
      '"kind" is "dialog", and only "button" can be imported so far.',
    )
    const m = clone(map)
    delete (m.parts as Record<string, unknown>).root
    expect(fails(() => importComponentSet(file, m)).code).toBe('F008')
  })
})

describe('the rules a property gets', () => {
  const axes = [
    { name: 'Size', values: ['md', 'sm'], defaultValue: 'md' },
    { name: 'Tone', values: ['a', 'b'], defaultValue: 'a' },
    { name: 'State', values: ['Default', 'Hover'], defaultValue: 'Default' },
  ]
  const places = axes[0]!.values.flatMap((Size) =>
    axes[1]!.values.flatMap((Tone) => axes[2]!.values.map((State) => ({ Size, Tone, State }))),
  )

  it('writes what one axis decides once, and what two decide where they meet', () => {
    // The size decides the padding; the tone and the state decide the color; one pair has its own.
    const values = places.map((p) => (p.Size === 'sm' ? 'small' : 'big'))
    const { base, rules } = learn({ places, values, axes, light: new Set(['State']) })
    expect(base).toBe('big')
    expect(rules).toEqual([{ when: [{ axis: 'Size', value: 'sm' }], value: 'small' }])
    for (const [i, p] of places.entries())
      expect(winner(p, base, rules, ['Size', 'Tone', 'State'])).toBe(values[i])
  })

  it('lets the later axis win where two rules of the same weight meet', () => {
    // sm is "small" and b is "bold"; where both apply, the tone (later) wins.
    const values = places.map((p) => (p.Tone === 'b' ? 'bold' : p.Size === 'sm' ? 'small' : 'big'))
    const { base, rules } = learn({ places, values, axes, light: new Set(['State']) })
    for (const [i, p] of places.entries())
      expect(winner(p, base, rules, ['Size', 'Tone', 'State'])).toBe(values[i])
    expect(rules.length).toBeLessThanOrEqual(2)
  })

  it('writes the state that has no pseudo-class as a condition with no weight', () => {
    const values = places.map((p) => (p.State === 'Default' ? 'rest' : 'hover'))
    const { rules } = learn({ places, values, axes, light: new Set(['State']) })
    expect(rules).toEqual([{ when: [{ axis: 'State', value: 'Hover' }], value: 'hover' }])
  })
})

describe('asking Figma', () => {
  it('reads a link, or a file and a node', () => {
    expect(
      parseSource('https://www.figma.com/design/lFTS9qbiRo9UK522alLoBm/Name?node-id=1-1183&t=x'),
    ).toEqual({ fileKey: 'lFTS9qbiRo9UK522alLoBm', nodeId: '1:1183' })
    expect(parseSource(undefined, 'abc', '12-3')).toEqual({ fileKey: 'abc', nodeId: '12:3' })
    expect(fails(() => parseSource('https://www.figma.com/design/abc')).message).toBe(
      'The link has no file or no node in it.',
    )
    expect(fails(() => parseSource(undefined)).message).toContain('Say where the component is')
  })

  it('needs the token in the environment, and says how to make one', () => {
    const e = fails(() => tokenFromEnv({}))
    expect(e.message).toBe('There is no Figma token.')
    expect(e.hint).toContain('export FIGMA_TOKEN=')
    expect(tokenFromEnv({ FIGMA_TOKEN: 'x' })).toBe('x')
  })

  const page = {
    name: 'The file',
    nodes: {
      '1:1': {
        document: { id: '1:1', name: 'Buttons', type: 'CANVAS', children: [file.set] },
        styles: Object.fromEntries(Object.entries(file.styles)),
      },
    },
  }
  const answer = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('finds the set on the page, with the styles it uses', async () => {
    const seen: Array<{ url: string; token: string | null }> = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      seen.push({ url, token: new Headers(init?.headers).get('x-figma-token') })
      return new Response(JSON.stringify(page))
    }) as unknown as typeof fetch
    const got = await fetchComponentSet(
      { fileKey: 'k', nodeId: '1:1' },
      'Buttons/Button',
      'SECRET',
      fetcher,
    )
    expect(got.set.name).toBe('Buttons/Button')
    expect(Object.values(got.styles).map((s) => s.name)).toContain('Brand/600')
    expect(seen[0]!.url).toBe('https://api.figma.com/v1/files/k/nodes?ids=1%3A1')
    // The token goes in the header, never in the address.
    expect(seen[0]!.token).toBe('SECRET')
    expect(seen[0]!.url).not.toContain('SECRET')
  })

  it('says why Figma refused, and never prints the token', async () => {
    for (const [status, text] of [
      [
        403,
        'Figma refused the token: it may be wrong, expired, or without the "File content" read scope.',
      ],
      [404, 'Figma has no such file or node, or the token cannot see it.'],
      [500, 'Figma answered 500.'],
    ] as const) {
      const e = await fetchComponentSet(
        { fileKey: 'k', nodeId: '1:1' },
        'Buttons/Button',
        'SECRET-TOKEN-VALUE',
        answer({}, status),
      ).catch((x: FigmaError) => x)
      expect((e as FigmaError).message).toBe(text)
      expect(JSON.stringify(e)).not.toContain('SECRET-TOKEN-VALUE')
    }
  })

  it('says when the set is not there', async () => {
    const e = await fetchComponentSet(
      { fileKey: 'k', nodeId: '1:1' },
      'Cards',
      't',
      answer(page),
    ).catch((x: FigmaError) => x)
    expect((e as FigmaError).message).toBe('There is no component set called "Cards" at 1:1.')
  })

  it('fetches the pictures in batches and keeps the ones it was given', async () => {
    const calls: string[] = []
    const fetcher = (async (url: string) => {
      calls.push(url)
      if (url.includes('/images/')) {
        const ids = decodeURIComponent(/ids=([^&]*)/.exec(url)![1]!).split(',')
        return new Response(
          JSON.stringify({
            images: Object.fromEntries(
              ids.filter((i) => i !== 'n:2').map((i) => [i, `https://cdn/${i}.png`]),
            ),
          }),
        )
      }
      return new Response(new Uint8Array([1, 2, 3]))
    }) as unknown as typeof fetch
    const ids = Array.from({ length: 45 }, (_, i) => `n:${i + 1}`)
    const got = await fetchImages('k', ids, 't', fetcher)
    expect(calls.filter((c) => c.includes('/images/'))).toHaveLength(2)
    expect(got.size).toBe(44)
    expect(got.has('n:2')).toBe(false)
  })
})

describe('tessera figma import', () => {
  it('writes the component, the tokens, the design and the test, and the project still checks clean', async () => {
    const root = project()
    const run = io(root)
    const code = await main(
      [
        'figma',
        'import',
        '--map',
        `${fixtures}/figma.map.json`,
        '--from-json',
        `${fixtures}/button-set.json`,
        '--replace',
      ],
      run.handle,
    )
    expect(run.err()).toBe('')
    expect(code).toBe(0)
    expect(run.out()).toContain('Imported Button from Figma.')
    for (const f of [
      'system/components/Button.tess',
      'system/components/Button.figma.browser.test.ts',
      'system/components/figma/Button/Button.figma.json',
    ])
      expect(existsSync(join(root, f)), f).toBe(true)
    expect(existsSync(join(root, 'system/tailwind/tokens/figma.tokens.json'))).toBe(true)
    const design = JSON.parse(
      readFileSync(join(root, 'system/components/figma/Button/Button.figma.json'), 'utf8'),
    )
    expect(design.variants).toHaveLength(380)
    expect(design.threshold).toBe(0.01)

    // The tokens it made are enough: no raw value, no unknown token.
    const checked = io(root)
    expect(await main(['check'], checked.handle)).toBe(0)
    expect(checked.out()).toContain('0 errors, 0 warnings')
  }, 120_000)

  it('does not overwrite a file without --replace, and says which it left', async () => {
    const root = project()
    const run = io(root)
    const args = [
      'figma',
      'import',
      '--map',
      `${fixtures}/figma.map.json`,
      '--from-json',
      `${fixtures}/button-set.json`,
    ]
    expect(await main(args, run.handle)).toBe(0)
    // The preset's own Button is there, so it is left, and so is its (new) test only if it was written before.
    expect(run.out()).toContain(
      'Left alone (already there; --replace writes it again): system/components/Button.tess',
    )
    expect(readFileSync(join(root, 'system/components/Button.tess'), 'utf8')).not.toContain(
      'figma-brand-600',
    )
  }, 120_000)

  it('stops with --strict when a value has no style, and writes nothing', async () => {
    const root = project()
    const run = io(root)
    const code = await main(
      [
        'figma',
        'import',
        '--map',
        `${fixtures}/figma.map.json`,
        '--from-json',
        `${fixtures}/button-set.json`,
        '--strict',
      ],
      run.handle,
    )
    expect(code).toBe(1)
    expect(run.err()).toMatch(/F014: \d+ values? (has|have) no style in the design/)
    expect(existsSync(join(root, 'system/components/Button.figma.browser.test.ts'))).toBe(false)
  }, 120_000)

  it('needs a map, and a place to read from', async () => {
    const root = project()
    const a = io(root)
    expect(await main(['figma', 'import'], a.handle)).toBe(1)
    expect(a.err()).toContain('Say which map to use: --map <file>.')
    const b = io(root)
    delete process.env.FIGMA_TOKEN
    expect(await main(['figma', 'import', '--map', `${fixtures}/figma.map.json`], b.handle)).toBe(1)
    expect(b.err()).toContain('F010: There is no Figma token.')
    const c = io(root)
    expect(await main(['figma', 'nope'], c.handle)).toBe(1)
    expect(c.err()).toContain('Unknown figma command "nope".')
  }, 120_000)
})
