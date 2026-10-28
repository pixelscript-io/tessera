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
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-dev')

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

const port = (server: DevServers['app']) => Number(new URL(server.resolvedUrls!.local[0]!).port)

const page = async (server: DevServers['app']) => {
  const response = await fetch(server.resolvedUrls!.local[0]!, { headers: { accept: 'text/html' } })
  return { status: response.status, html: await response.text() }
}

beforeAll(() => rmSync(scratch, { recursive: true, force: true }))
afterEach(async () => {
  for (const { app, docs } of started.splice(0)) {
    await docs?.close()
    await app.close()
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('tessera dev', () => {
  it('serves the app and the docs, each on its own port', async () => {
    const root = await newProject()
    const appPort = await freePort()
    const { app, docs } = await start(root, '--port', String(appPort))
    expect(docs).toBeDefined()
    expect(port(app)).toBe(appPort)
    expect(port(docs!)).not.toBe(port(app))
    const [a, d] = [await page(app), await page(docs!)]
    expect(a.status).toBe(200)
    expect(a.html).toContain('/app/main.ts')
    expect(d.status).toBe(200)
    expect(d.html).toContain('/.tessera/docs/main.ts')
  })

  it('puts the docs on --docs-port when it is given', async () => {
    const root = await newProject()
    const [appPort, docsPort] = [await freePort(), await freePort()]
    const { docs } = await start(root, '--port', String(appPort), '--docs-port', String(docsPort))
    expect(port(docs!)).toBe(docsPort)
  })

  it('refuses a --docs-port that is not a number, and leaves nothing running', async () => {
    const root = await newProject()
    await expect(
      start(root, '--port', String(await freePort()), '--docs-port', 'next'),
    ).rejects.toThrow(/--docs-port/)
  })

  it('starts only the app when the config says docs: false', async () => {
    const root = await newProject('export default { docs: false }\n')
    const { app, docs } = await start(root, '--port', String(await freePort()))
    expect(docs).toBeUndefined()
    expect((await page(app)).status).toBe(200)
  })
})
