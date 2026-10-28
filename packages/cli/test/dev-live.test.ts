import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { parseArgs } from '../src/args'
import { presetFiles } from '../src/commands/init'
import { startDev, type DevServers } from '../src/commands/serve'

// `tessera dev` starts the app and, beside it, the docs of the design system: two servers, two ports.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-dev-live')

/** A port nothing is listening on. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
}

const started: DevServers[] = []
const roots: string[] = []

async function newProject(
  config?: string,
  preset: 'unstyled' | 'tailwind' = 'unstyled',
): Promise<string> {
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'd-')).replaceAll('\\', '/')
  roots.push(root)
  writeFileSync(join(root, 'package.json'), '{ "name": "dev-test" }\n')
  for (const [file, content] of Object.entries(presetFiles(preset))) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  if (config !== undefined) writeFileSync(join(root, 'tessera.config.ts'), config)
  return root
}

async function start(root: string, ...argv: string[]): Promise<DevServers> {
  const servers = await startDev(root, parseArgs(argv))
  started.push(servers)
  return servers
}

beforeAll(() => rmSync(scratch, { recursive: true, force: true }))
afterEach(async () => {
  for (const { app, docs } of started.splice(0)) {
    await docs?.close()
    await app.close()
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// In its own file: the file watcher of a docs server started after another one was closed in the same process
// does not always see new files, which a real `tessera dev` never meets.
describe('tessera dev, while it runs', () => {
  it('shows a component added while it runs, without a restart', async () => {
    const root = await newProject()
    const { docs } = await start(root, '--port', String(await freePort()))
    const data = async () =>
      (await docs!.transformRequest('virtual:tessera-docs/data'))!.code as string
    expect(await data()).not.toContain('Chip')
    mkdirSync(join(root, 'system', 'components'), { recursive: true })
    const card = presetFiles('unstyled')['system/components/Card.tess']!
    writeFileSync(join(root, 'system', 'components', 'Chip.tess'), card.replaceAll('Card', 'Chip'))
    const deadline = Date.now() + 8000
    let text = await data()
    while (!text.includes('Chip') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150))
      text = await data()
    }
    expect(text).toContain('Chip')
  })

  it('says so when a token changed in the base is one the dark theme sets for itself', async () => {
    const root = await newProject(undefined, 'tailwind')
    const notes: string[] = []
    const servers = await startDev(root, parseArgs(['--port', String(await freePort())]), {
      note: (line) => notes.push(line),
    })
    started.push(servers)
    const file = join(root, 'system', 'tailwind', 'tokens', 'semantic.tokens.json')
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        /("primary": \{\s*"bg": \{\s*"\$value": ")\{color\.indigo\.600\}/,
        '$1{color.blue.600}',
      ),
    )
    const deadline = Date.now() + 8000
    while (notes.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 150))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('color.action.primary.bg')
    expect(notes[0]).toContain('themes/dark.tokens.json')
  })

  it('shows a token changed while it runs, in the docs of every design system', async () => {
    const root = await newProject(undefined, 'tailwind')
    const { docs } = await start(root, '--port', String(await freePort()))
    // What the previews are styled with: the token style sheet, as the docs page loads it.
    const sheet = async (): Promise<string | undefined> => {
      const code = (await docs!.transformRequest('virtual:tessera/tokens.css'))?.code ?? ''
      return /--t-color-action-primary-bg:\s*([^;]+);/.exec(code)?.[1]
    }
    const before = await sheet()
    expect(before).toBeDefined()
    const file = join(root, 'system', 'tailwind', 'tokens', 'semantic.tokens.json')
    const source = readFileSync(file, 'utf8')
    const edited = source.replace(
      /("primary": \{\s*"bg": \{\s*"\$value": ")\{color\.indigo\.600\}/,
      '$1{color.blue.600}',
    )
    expect(edited).not.toBe(source)
    writeFileSync(file, edited)
    const deadline = Date.now() + 8000
    let after = await sheet()
    while (after === before && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150))
      after = await sheet()
    }
    expect(after).not.toBe(before)
  })
})
