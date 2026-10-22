import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tessera } from '../src/vite'

const repo = fileURLToPath(new URL('../../../', import.meta.url)).replaceAll('\\', '/')
const component = (name: string, text = name) => `<contract>
{ "name": "${name}", "role": "group", "parts": ["root"] }
</contract>
<template><div class="root">${text}</div></template>`

let dir: string
let server: ViteDevServer
let reloaded: string[] = []

const write = (path: string, text: string) => {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), text)
}

/** Transform a file the way the dev server would, returning the error message if it fails. */
async function request(path: string): Promise<{ code?: string; error?: string }> {
  try {
    const result = await server.transformRequest(`/${path}`, { ssr: true })
    return { code: result?.code }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** The registry reacts to file system events, which arrive a moment after the write. */
async function until<T>(check: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000
  for (;;) {
    const value = await check()
    if (done(value) || Date.now() > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tessera-hmr-')).replaceAll('\\', '/')
  write('app/components/Alpha.tess', component('Alpha'))
  write(
    'app/components/Host.tess',
    `<contract>
{ "name": "Host", "role": "group", "parts": ["root"] }
</contract>
<template><section class="root"><Beta /></section></template>`,
  )
  server = await createServer({
    root: dir,
    logLevel: 'silent',
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: { usePolling: true, interval: 50 } },
    appType: 'custom',
    plugins: [tessera({ tokens: `${repo}system/tokens` })],
  })
  const reload = server.reloadModule.bind(server)
  server.reloadModule = async (module) => {
    reloaded.push(module.file ?? '')
    return reload(module)
  }
  await server.listen?.().catch(() => undefined)
})

afterAll(async () => {
  await server.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('adding, removing and renaming component files, without restarting the dev server', () => {
  it('starts with the tag unresolved, because Beta does not exist yet', async () => {
    const { error } = await request('app/components/Host.tess')
    expect(error).toContain('Unknown component <Beta>')
  })

  it('resolves the tag once Beta is added, recompiles users, and updates the types', async () => {
    reloaded = []
    write('app/components/Beta.tess', component('Beta', 'BETA_V1'))
    const { code } = await until(
      () => request('app/components/Host.tess'),
      (r) => r.code !== undefined,
    )
    expect(code).toContain('/app/components/Beta.tess')
    expect(readFileSync(join(dir, '.tessera/components.d.ts'), 'utf8')).toContain(
      'Beta: { props: BetaProps',
    )
  })

  it('asks the server to reload the compiled .tess modules that were loaded', async () => {
    expect(reloaded.some((f) => f.endsWith('Host.tess'))).toBe(true)
  })

  it('reports an unknown tag again when Beta is removed', async () => {
    unlinkSync(join(dir, 'app/components/Beta.tess'))
    const { error } = await until(
      () => request('app/components/Host.tess'),
      (r) => r.error !== undefined,
    )
    expect(error).toContain('Unknown component <Beta>')
    expect(readFileSync(join(dir, '.tessera/components.d.ts'), 'utf8')).not.toContain('Beta: {')
  })

  it('follows a rename: the old tag stops working and the new one starts', async () => {
    write('app/components/Gamma.tess', component('Gamma'))
    await until(
      () => request('app/components/Host.tess'),
      () => readFileSync(join(dir, '.tessera/components.d.ts'), 'utf8').includes('Gamma: {'),
    )
    write(
      'app/components/Host.tess',
      `<contract>
{ "name": "Host", "role": "group", "parts": ["root"] }
</contract>
<template><section class="root"><Gamma /></section></template>`,
    )
    const { code } = await until(
      () => request('app/components/Host.tess'),
      (r) => r.code !== undefined,
    )
    expect(code).toContain('/app/components/Gamma.tess')
  })

  it('shows a duplicate name as an error on the file that repeats it', async () => {
    write('app/components/nested/Alpha.tess', component('Alpha'))
    const { error } = await until(
      () => request('app/components/nested/Alpha.tess'),
      (r) => r.error !== undefined,
    )
    expect(error).toContain('T5001')
    expect(error).toContain(
      'Duplicate component name "Alpha". It is also defined in app/components/Alpha.tess.',
    )
  })
})
