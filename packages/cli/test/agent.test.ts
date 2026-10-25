import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { main } from '../src'
import { component, page, project, read, run, write } from './helpers'

const files = () => ({
  'app/components/Card.tess': component('Card', '.root { padding: $space.4; }'),
  'app/pages/index.tess': page(),
})

describe('tessera manifest', () => {
  it('writes the manifest and the custom-elements export', async () => {
    const root = project(files())
    const { code, out } = await run(root, 'manifest')
    expect(code).toBe(0)
    expect(out).toContain('Wrote .tessera/manifest.json (')
    const manifest = JSON.parse(read(root, '.tessera/manifest.json'))
    expect(manifest.components.map((c: { name: string }) => c.name)).toContain('Card')
    const elements = JSON.parse(read(root, '.tessera/custom-elements.json'))
    expect(elements.schemaVersion).toBe('1.0.0')
    expect(
      elements.modules.map(
        (m: { declarations: Array<{ name: string }> }) => m.declarations[0]!.name,
      ),
    ).toContain('Card')
  })
})

describe('the custom-elements export', () => {
  it('maps variants to attributes, parts to cssParts, and the default slot to the empty name', async () => {
    const root = project({
      'app/components/Tag.tess': `<contract>
{ "name": "Tag", "role": "group", "parts": ["root", "label"], "variants": { "tone": ["info", "warn"] }, "events": {}, "slots": { "default": "The label." } }
</contract>
<template><div class="root"><slot /></div></template>
`,
    })
    await run(root, 'manifest')
    const elements = JSON.parse(read(root, '.tessera/custom-elements.json'))
    const tag = elements.modules.find((m: { path: string }) => m.path.endsWith('Tag.tess'))
      .declarations[0]
    expect(tag.attributes).toEqual([
      {
        name: 'tone',
        type: { text: '"info" | "warn"' },
        default: '"info"',
        description: 'One of info, warn.',
      },
    ])
    expect(tag.cssParts.map((p: { name: string }) => p.name)).toEqual(['root', 'label'])
    expect(tag.slots).toEqual([{ name: '', description: 'The label.' }])
  })
})

describe('tessera agent-files', () => {
  it('writes AGENTS.md and llms.txt from the project, and is idempotent', async () => {
    const root = project(files())
    const first = await run(root, 'agent-files')
    expect(first.code).toBe(0)
    expect(first.out).toContain('Wrote AGENTS.md')
    expect(first.out).toContain('Wrote llms.txt')
    const agents = read(root, 'AGENTS.md')
    expect(agents).toContain('`Card`')
    expect(agents).toContain('npx tessera check')
    expect(agents).toContain('.tessera/manifest.json')
    expect(read(root, 'llms.txt')).toContain('Card:')
    expect(existsSync(join(root, '.tessera', 'manifest.json'))).toBe(true)
    const second = await run(root, 'agent-files')
    expect(second.out).toContain('Up to date: AGENTS.md')
  })

  it('lists the APIs, and how to call them, when the project has any', async () => {
    const plain = project(files())
    await run(plain, 'agent-files')
    expect(read(plain, 'AGENTS.md')).not.toContain('## APIs')
    const root = project({
      ...files(),
      'app/apis/pets.ts': 'export default {}\n',
      'app/apis/pets.api.json': JSON.stringify({
        paths: { '/pets': { get: { returns: 'string[]' } } },
      }),
    })
    await run(root, 'agent-files')
    const agents = read(root, 'AGENTS.md')
    expect(agents).toContain('## APIs')
    expect(agents).toContain('`pets`: GET /pets')
    expect(agents).toContain('get_endpoint')
    expect(read(root, 'llms.txt')).toContain('## APIs')
    expect(read(root, 'llms.txt')).toContain('pets: GET /pets')
  })

  it('lists the shared state, and the rule that only its file changes it, when the project has any', async () => {
    const plain = project(files())
    await run(plain, 'agent-files')
    expect(read(plain, 'AGENTS.md')).not.toContain('## Shared state')
    const root = project({
      ...files(),
      'app/state/cart.ts':
        "import { state } from '@pixelscriptio/tessera/core'\nexport const items = state([])\nexport function clear() { items.value = [] }\n",
    })
    await run(root, 'agent-files')
    const agents = read(root, 'AGENTS.md')
    expect(agents).toContain('## Shared state')
    expect(agents).toContain('`cart`: items, clear()')
    expect(agents).toContain('read-only outside its file')
    expect(agents).toContain('get_state')
    expect(read(root, 'llms.txt')).toContain('## Shared state')
    expect(read(root, 'llms.txt')).toContain('cart: items, clear()')
  })

  it('does not overwrite a file the person wrote, unless told to', async () => {
    const root = project(files())
    write(root, 'AGENTS.md', '# My own rules\n')
    const kept = await run(root, 'agent-files')
    expect(kept.out).toContain('Left AGENTS.md alone')
    expect(read(root, 'AGENTS.md')).toBe('# My own rules\n')
    expect(read(root, 'llms.txt')).toContain('Card:')
    await run(root, 'agent-files', '--force')
    expect(read(root, 'AGENTS.md')).toContain('Working in this project')
  })
})

describe('tessera mcp', () => {
  it('serves the protocol on the streams it is given until input ends', async () => {
    const root = project(files())
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let out = ''
    let err = ''
    stdout.on('data', (d) => (out += d))
    stdin.write(
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_components","arguments":{}}}\n',
    )
    stdin.end()
    const code = await main(['mcp'], {
      cwd: root,
      stdin,
      stdout,
      out: () => {},
      err: (t) => void (err += t),
    })
    expect(code).toBe(0)
    const reply = JSON.parse(out.trim())
    expect(JSON.parse(reply.result.content[0].text).map((c: { name: string }) => c.name)).toContain(
      'Card',
    )
    // Nothing but protocol on stdout; the banner went to stderr.
    expect(err).toContain('read-only')
  })
})
