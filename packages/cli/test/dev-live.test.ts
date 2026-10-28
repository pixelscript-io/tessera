import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

async function newProject(config?: string): Promise<string> {
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'd-')).replaceAll('\\', '/')
  roots.push(root)
  writeFileSync(join(root, 'package.json'), '{ "name": "dev-test" }\n')
  for (const [file, content] of Object.entries(presetFiles('unstyled'))) {
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
})
