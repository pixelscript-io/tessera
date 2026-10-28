import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import type { Io } from '../src/io'
import { buildRegistry, writeRegistry } from '../src/registry/build'
import { checksum, itemFile } from '../src/registry/schema'

const ui = fileURLToPath(new URL('../../ui', import.meta.url)).replaceAll('\\', '/')
const cli = fileURLToPath(new URL('..', import.meta.url))

const roots: string[] = []
const servers: Server[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  for (const s of servers) s.close()
})

/** A project with a design system and one page, as `init` leaves it, but without the components. */
function newProject(extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'tessera-add-'))
  roots.push(root)
  const files: Record<string, string> = {
    'package.json': '{ "name": "mine", "type": "module" }\n',
    'tessera.config.ts': "export default { systems: [{ name: 'Unstyled', path: '/unstyled' }] }\n",
    'app/pages/index.tess': '<template><main>Hi</main></template>\n',
    ...extra,
  }
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  mkdirSync(join(root, 'system', 'components'), { recursive: true })
  return root
}

interface Asked {
  question: string
  choices: string[]
}

async function add(
  cwd: string,
  argv: string[],
  answers: { choose?: string[]; ask?: string[] } = {},
) {
  let out = ''
  let err = ''
  const asked: Asked[] = []
  const choose = [...(answers.choose ?? [])]
  const ask = [...(answers.ask ?? [])]
  const io: Io = {
    cwd,
    out: (t) => void (out += t + '\n'),
    err: (t) => void (err += t + '\n'),
    ...(answers.choose
      ? {
          choose: async (question, choices) => {
            asked.push({ question, choices: choices.map((c) => c.label) })
            return choose.shift()!
          },
          ask: async () => ask.shift() ?? '',
        }
      : {}),
  }
  const code = await main(['add', ...argv], io)
  return { code, out, err, asked }
}

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')
const catalogue = ['--from', ui]

describe('tessera add', () => {
  it('copies a component and its docs file into system/components', async () => {
    const root = newProject()
    const { code, out } = await add(root, ['Button', ...catalogue])
    expect(code).toBe(0)
    expect(read(root, 'system/components/Button.tess')).toBe(
      readFileSync(join(ui, 'components/Button.tess'), 'utf8'),
    )
    expect(existsSync(join(root, 'system/components/Button.docs.md'))).toBe(true)
    expect(out).toContain('system/components/Button.tess')
    expect(out).toContain('tessera check')
  })

  it('brings the components a component needs', async () => {
    const root = newProject()
    await add(root, ['Accordion', ...catalogue])
    expect(existsSync(join(root, 'system/components/AccordionItem.tess'))).toBe(true)
  })

  it('keeps your own component of a name a dependency needs, and says so', async () => {
    const root = newProject({ 'system/components/AccordionItem.tess': 'mine' })
    const { out } = await add(root, ['Accordion', ...catalogue])
    expect(read(root, 'system/components/AccordionItem.tess')).toBe('mine')
    expect(out).toContain('Kept your AccordionItem')
  })

  it('tells what to install for a component that imports a package, and does not install it unasked', async () => {
    const root = newProject()
    const { out } = await add(root, ['Icon', ...catalogue])
    expect(out).toMatch(/npm install lucide@/)
    expect(existsSync(join(root, 'system/components/icons.ts'))).toBe(true)
    expect(existsSync(join(root, 'node_modules'))).toBe(false)
  })

  it('does not ask for a package the project already has', async () => {
    const root = newProject({
      'package.json': '{ "name": "mine", "dependencies": { "lucide": "1.0.0" } }\n',
    })
    const { out } = await add(root, ['Icon', ...catalogue])
    expect(out).not.toContain('npm install')
  })

  it('copies a token set into its own folder and says how to list it in the config', async () => {
    const root = newProject()
    const dir = mkdtempSync(join(tmpdir(), 'tessera-reg-'))
    roots.push(dir)
    writeRegistry(
      buildRegistry({
        uiDir: ui,
        tokenSets: [
          {
            name: 'unstyled',
            description: 'Plain.',
            dir: join(cli, 'templates/unstyled/system/unstyled/tokens'),
          },
        ],
        minTessera: '0.1.0',
        npmVersions: { lucide: '1.62.0' },
      }),
      dir,
    )
    const { code, out } = await add(root, ['tokens:unstyled', '--from', dir])
    expect(code).toBe(0)
    expect(existsSync(join(root, 'system/unstyled/tokens/colors.tokens.json'))).toBe(true)
    expect(existsSync(join(root, 'system/unstyled/tokens/themes/dark.tokens.json'))).toBe(true)
    expect(out).toContain("{ name: 'Unstyled', path: '/unstyled' }")
  })

  it('records what it installed in tessera.lock.json', async () => {
    const root = newProject()
    await add(root, ['Button', ...catalogue])
    const lock = JSON.parse(read(root, 'tessera.lock.json'))
    expect(lock.items.Button.item).toBe('Button')
    expect(lock.items.Button.files).toEqual(['Button.docs.md', 'Button.tess'])
    expect(lock.items.Button.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a name nothing in the registry has, and suggests a near one', async () => {
    const root = newProject()
    const { code, err } = await add(root, ['Buton', ...catalogue])
    expect(code).toBe(1)
    expect(err).toContain('has no "Buton"')
    expect(err).toContain('Button')
  })

  it('needs a name', async () => {
    const { code, err } = await add(newProject(), catalogue)
    expect(code).toBe(1)
    expect(err).toContain('Say what to add')
  })
})

describe('when the name is taken', () => {
  const taken = () => newProject({ 'system/components/Button.tess': 'mine' })

  it('stops without a terminal, and says the two ways forward', async () => {
    const root = taken()
    const { code, err } = await add(root, ['Button', ...catalogue])
    expect(code).toBe(1)
    expect(err).toContain('already a component named "Button"')
    expect(err).toContain('--replace')
    expect(err).toContain('--as <Name>')
    expect(read(root, 'system/components/Button.tess')).toBe('mine')
  })

  it('--replace overwrites yours', async () => {
    const root = taken()
    await add(root, ['Button', '--replace', ...catalogue])
    expect(read(root, 'system/components/Button.tess')).toContain('"name": "Button"')
  })

  it('--as adds the new one under another name, in the file name, the contract and the docs', async () => {
    const root = taken()
    const { code } = await add(root, ['Button', '--as', 'ActionButton', ...catalogue])
    expect(code).toBe(0)
    expect(read(root, 'system/components/Button.tess')).toBe('mine')
    const renamed = read(root, 'system/components/ActionButton.tess')
    expect(renamed).toContain('"name": "ActionButton"')
    expect(renamed).not.toContain('"name": "Button"')
    expect(read(root, 'system/components/ActionButton.docs.md')).toContain('ActionButton')
    expect(read(root, 'system/components/ActionButton.docs.md')).not.toMatch(/\bButton\b/)
  })

  it('--as refuses a name that is taken or not a component name', async () => {
    const root = taken()
    writeFileSync(join(root, 'system/components/Other.tess'), 'x')
    for (const name of ['Button', 'other', '../x', 'A B']) {
      const { code } = await add(root, ['Button', '--as', name, ...catalogue])
      expect(code).toBe(1)
    }
  })

  it('--yes never asks: a taken name still needs --replace or --as', async () => {
    const root = taken()
    const { code, asked } = await add(root, ['Button', '--yes', ...catalogue], {
      choose: ['replace'],
    })
    expect(code).toBe(1)
    expect(asked).toEqual([])
  })

  it('in a terminal, asks, naming which is yours and which is new', async () => {
    const root = taken()
    const { asked } = await add(root, ['Button', ...catalogue], { choose: ['cancel'] })
    expect(asked[0]!.question).toContain('Existing: system/components/Button.tess (yours)')
    expect(asked[0]!.question).toContain('New: Button from')
    expect(asked[0]!.choices.map((c) => c.split(':')[0])).toEqual(['replace', 'rename', 'cancel'])
  })

  it('cancel changes nothing', async () => {
    const root = taken()
    const { code, out } = await add(root, ['Button', ...catalogue], { choose: ['cancel'] })
    expect(code).toBe(1)
    expect(out).toContain('Nothing was changed')
    expect(read(root, 'system/components/Button.tess')).toBe('mine')
    expect(existsSync(join(root, 'tessera.lock.json'))).toBe(false)
  })

  it('replace overwrites yours', async () => {
    const root = taken()
    await add(root, ['Button', ...catalogue], { choose: ['replace'] })
    expect(read(root, 'system/components/Button.tess')).toContain('"name": "Button"')
  })

  it('rename asks for the new name, and asks again when it is taken', async () => {
    const root = taken()
    const { code, out } = await add(root, ['Button', ...catalogue], {
      choose: ['rename'],
      ask: ['Button', 'PrimaryButton'],
    })
    expect(code).toBe(0)
    expect(out).toContain('already used')
    expect(existsSync(join(root, 'system/components/PrimaryButton.tess'))).toBe(true)
    expect(read(root, 'system/components/Button.tess')).toBe('mine')
  })

  it('cannot replace a component that lives in app/components, and offers to rename or cancel', async () => {
    const root = newProject({
      'app/components/Button.tess':
        '<contract>\n{ "name": "Button", "role": "button", "description": "mine", "parts": ["root"] }\n</contract>\n<template><button class="root"><slot /></button></template>\n',
    })
    const withReplace = await add(root, ['Button', '--replace', ...catalogue])
    expect(withReplace.code).toBe(1)
    expect(withReplace.err).toContain('app/components/Button.tess')
    const { asked } = await add(root, ['Button', ...catalogue], { choose: ['cancel'] })
    expect(asked[0]!.choices.map((c) => c.split(':')[0])).toEqual(['rename', 'cancel'])
  })

  it('refuses a support file that is already there with other content', async () => {
    const root = newProject({ 'system/components/icons.ts': 'export const ICONS = {}\n' })
    const { code, err } = await add(root, ['Icon', ...catalogue])
    expect(code).toBe(1)
    expect(err).toContain('icons.ts already exists with different content')
  })

  it('adding the same thing twice changes nothing', async () => {
    const root = newProject()
    await add(root, ['Icon', ...catalogue])
    const { code, out } = await add(root, ['Icon', ...catalogue], { choose: ['cancel'] })
    // The component itself is now a taken name: the second run asks, and cancelling leaves it alone.
    expect(code).toBe(1)
    expect(out).toContain('Nothing was changed')
  })
})

describe('--diff and --list', () => {
  it('--diff shows how yours differs and writes nothing', async () => {
    const original = readFileSync(join(ui, 'components/Button.docs.md'), 'utf8')
    const root = newProject({
      'system/components/Button.tess': readFileSync(
        join(ui, 'components/Button.tess'),
        'utf8',
      ).replace('Triggers an action.', 'My own words.'),
      'system/components/Button.docs.md': original,
    })
    const before = read(root, 'system/components/Button.tess')
    const { code, out } = await add(root, ['Button', '--diff', ...catalogue])
    expect(code).toBe(0)
    expect(out).toContain('- ')
    expect(out).toContain('My own words.')
    expect(out).toContain('Triggers an action.')
    expect(out).toContain('Button.docs.md: same as')
    expect(read(root, 'system/components/Button.tess')).toBe(before)
    expect(existsSync(join(root, 'tessera.lock.json'))).toBe(false)
  })

  it('--list --json lists the items, and marks the installed ones', async () => {
    const root = newProject()
    await add(root, ['Badge', ...catalogue])
    const { out } = await add(root, ['--list', '--json', ...catalogue])
    const listed = JSON.parse(out) as {
      items: Array<{ name: string; installed: boolean; description: string }>
    }
    expect(listed.items.find((i) => i.name === 'Badge')!.installed).toBe(true)
    expect(listed.items.find((i) => i.name === 'Button')!.installed).toBe(false)
    expect(listed.items.some((i) => i.name === 'tokens:tessera')).toBe(true)
  })

  it('--list prints a line per item', async () => {
    const { out } = await add(newProject(), ['--list', ...catalogue])
    expect(out).toMatch(/Button\s+Triggers an action/)
  })
})

describe('what the registry may do', () => {
  const served = (items: Record<string, unknown>): Promise<string> => {
    const server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname
      if (path === '/redirect/index.json') {
        res.statusCode = 302
        res.setHeader('Location', 'http://127.0.0.1:1/index.json')
        res.end()
        return
      }
      const body = items[path.slice(1)]
      if (body === undefined) {
        res.statusCode = 404
        res.end('no')
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    })
    servers.push(server)
    return new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
      ),
    )
  }
  const entry = (name: string, files: Array<{ path: string; content: string }>) => ({
    name,
    type: 'component',
    description: 'x',
    files,
    sha256: checksum(files),
  })
  const index = (...names: string[]) => ({
    version: 1,
    name: 'Evil',
    items: names.map((name) => ({
      name,
      type: 'component',
      description: 'x',
      files: [],
      sha256: '',
    })),
  })

  it('installs from a registry served over http on this computer', async () => {
    const files = [{ path: 'Chip.tess', content: 'chip' }]
    const url = await served({
      'index.json': index('Chip'),
      [itemFile('Chip')]: entry('Chip', files),
    })
    const root = newProject()
    const { code } = await add(root, ['Chip', '--from', url])
    expect(code).toBe(0)
    expect(read(root, 'system/components/Chip.tess')).toBe('chip')
  })

  it('writes nothing outside system/components, whatever path the registry names', async () => {
    const root = newProject()
    for (const path of [
      '../../escape.tess',
      '..\\escape.tess',
      '/tmp/escape.tess',
      'sub/dir/X.tess',
      'package.json',
    ]) {
      const files = [{ path, content: 'owned' }]
      const url = await served({
        'index.json': index('Chip'),
        [itemFile('Chip')]: entry('Chip', files),
      })
      const { code, err } = await add(root, ['Chip', '--from', url])
      expect(code, path).toBe(1)
      expect(err, path).toContain('cannot be used')
    }
    expect(existsSync(join(root, '..', 'escape.tess'))).toBe(false)
    expect(read(root, 'package.json')).toContain('"name": "mine"')
    expect(readdirOf(root, 'system/components')).toEqual([])
  })

  it('refuses files that do not match their checksum', async () => {
    const files = [{ path: 'Chip.tess', content: 'chip' }]
    const bad = { ...entry('Chip', files), files: [{ path: 'Chip.tess', content: 'swapped' }] }
    const url = await served({ 'index.json': index('Chip'), [itemFile('Chip')]: bad })
    const { code, err } = await add(newProject(), ['Chip', '--from', url])
    expect(code).toBe(1)
    expect(err).toContain('checksum')
  })

  it('refuses an item that is not the one asked for', async () => {
    const files = [{ path: 'Other.tess', content: 'x' }]
    const url = await served({
      'index.json': index('Chip'),
      [itemFile('Chip')]: entry('Other', files),
    })
    const { code, err } = await add(newProject(), ['Chip', '--from', url])
    expect(code).toBe(1)
    expect(err).toContain('not "Chip"')
  })

  it('refuses a registry over plain http that is not on this computer, and a redirect elsewhere', async () => {
    const root = newProject()
    const remote = await add(root, ['Button', '--from', 'http://example.com'])
    expect(remote.code).toBe(1)
    expect(remote.err).toContain('https')
    const url = await served({})
    const redirected = await add(root, ['Button', '--from', `${url}/redirect`])
    expect(redirected.code).toBe(1)
  })

  it('refuses a component that needs a newer Tessera than the project has', async () => {
    const files = [{ path: 'Chip.tess', content: 'chip' }]
    const item = { ...entry('Chip', files), minTessera: '99.0.0' }
    const url = await served({ 'index.json': index('Chip'), [itemFile('Chip')]: item })
    const root = newProject()
    const { code, err } = await add(root, ['Chip', '--from', url])
    expect(code).toBe(1)
    expect(err).toContain('needs @pixelscriptio/tessera 99.0.0')
    expect(existsSync(join(root, 'system/components/Chip.tess'))).toBe(false)
  })

  it('says so when the registry cannot be reached', async () => {
    const { code, err } = await add(newProject(), ['Button', '--from', 'http://127.0.0.1:1'])
    expect(code).toBe(1)
    expect(err).toContain('Could not reach')
  })

  it('says so when --from is not a registry', async () => {
    const { code, err } = await add(newProject(), ['Button', '--from', tmpdir()])
    expect(code).toBe(1)
    expect(err).toContain('is not a registry')
  })
})

import { readdirSync } from 'node:fs'
const readdirOf = (root: string, dir: string) => readdirSync(join(root, dir))
