import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { McpServer } from '../src'

const root = fileURLToPath(new URL('../../../examples/kitchen-sink', import.meta.url))
const server = new McpServer(new Project(root, { today: '2026-10-22' }))

let nextId = 1
/** Call a tool and parse the JSON text it returns. */
function call(name: string, args: Record<string, unknown> = {}) {
  const response = server.handle({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'tools/call',
    params: { name, arguments: args },
  }) as { result: { isError?: boolean; content: Array<{ text: string }> } }
  const text = response.result.content[0]!.text
  return {
    isError: !!response.result.isError,
    text,
    json: response.result.isError ? undefined : JSON.parse(text),
  }
}

describe('the MCP protocol', () => {
  it('answers initialize with the tools capability', () => {
    const r = server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) as {
      result: { protocolVersion: string; capabilities: object; serverInfo: { name: string } }
    }
    expect(r.result.serverInfo.name).toBe('tessera')
    expect(r.result.capabilities).toEqual({ tools: {} })
  })

  it('lists tools with schemas, and none of them can write', () => {
    const r = server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) as {
      result: { tools: Array<{ name: string; inputSchema: { type: string } }> }
    }
    expect(r.result.tools.map((t) => t.name)).toEqual([
      'list_components',
      'search_components',
      'get_component',
      'list_tokens',
      'resolve_value',
      'validate_snippet',
      'list_routes',
      'list_apis',
      'get_endpoint',
      'list_state',
      'get_state',
      'get_rules',
      'explain_error',
    ])
    expect(r.result.tools.every((t) => t.inputSchema.type === 'object')).toBe(true)
  })

  it('does not answer notifications, and rejects unknown methods and tools', () => {
    expect(server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined()
    expect(server.handle({ jsonrpc: '2.0', id: 3, method: 'nope' })).toMatchObject({
      error: { code: -32601 },
    })
    expect(
      server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }),
    ).toMatchObject({ error: { code: -32602 } })
    expect(server.handle({ hello: 1 })).toMatchObject({ error: { code: -32600 } })
  })

  it('serves newline-delimited JSON over streams and ends with its input', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let out = ''
    output.on('data', (d) => (out += d))
    const done = server.serve(input, output)
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\nnot json\n')
    input.end('{"jsonrpc":"2.0","id":2,"method":"ping"}')
    await done
    const lines = out
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(lines).toEqual([
      { jsonrpc: '2.0', id: 1, result: {} },
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Could not parse the message as JSON.' },
      },
      { jsonrpc: '2.0', id: 2, result: {} },
    ])
  })
})

describe('components', () => {
  it('lists every component', () => {
    const names = (call('list_components').json as Array<{ name: string }>).map((c) => c.name)
    expect(names).toEqual([
      'Accordion',
      'AccordionItem',
      'Alert',
      'Avatar',
      'Button',
      'CartAdd',
      'CartCount',
      'Checkbox',
      'Combobox',
      'ConfirmBar',
      'Counter',
      'Dialog',
      'Form',
      'FormField',
      'Icon',
      'Kbd',
      'Link',
      'Progress',
      'Quote',
      'RadioGroup',
      'Select',
      'Separator',
      'SiteNav',
      'Skeleton',
      'Spinner',
      'Switch',
      'TaskList',
      'Textarea',
      'TextField',
    ])
  })

  it('finds components by what they do', () => {
    const found = call('search_components', { query: 'press button' }).json as Array<{
      name: string
    }>
    expect(found[0]!.name).toBe('Button')
    expect(call('search_components', { query: 'zzzzzz' }).json).toEqual([])
  })

  it('returns a contract with usage and the source', () => {
    const button = call('get_component', { name: 'Button' }).json
    expect(button.variants[0]).toEqual({
      name: 'tone',
      values: ['primary', 'neutral', 'danger'],
      default: 'primary',
    })
    expect(button.usage[0]).toBe(
      ['<Button>', '  Save changes', '  <Icon slot="icon" name="plus" />', '</Button>'].join('\n'),
    )
    expect(button.source).toContain('<contract>')
  })

  it('says what to use when a component does not exist', () => {
    const r = call('get_component', { name: 'Buton' })
    expect(r.isError).toBe(true)
    expect(r.text).toBe(
      'There is no component named Buton. Components: Accordion, AccordionItem, Alert, Avatar, Button, CartAdd, CartCount, Checkbox, Combobox, ConfirmBar, Counter, Dialog, Form, FormField, Icon, Kbd, Link, Progress, Quote, RadioGroup, Select, Separator, SiteNav, Skeleton, Spinner, Switch, TaskList, Textarea, TextField.',
    )
    expect(call('get_component', { name: 'Conf' }).text).toContain('Did you mean ConfirmBar?')
    expect(call('get_component', {}).text).toBe('"name" is required and must be a string.')
  })
})

describe('tokens', () => {
  it('filters by tier, prefix and words', () => {
    const r = call('list_tokens', { tier: 'semantic', prefix: 'color.action.primary' }).json
    expect(r.themes.sort()).toEqual(['compact', 'dark'])
    expect(
      r.tokens.every(
        (t: { use: string; tier: string }) =>
          t.tier === 'semantic' && t.use.startsWith('$color.action.primary'),
      ),
    ).toBe(true)
    expect(r.tokens.map((t: { use: string }) => t.use)).toContain('$color.action.primary.bg')
    expect(call('list_tokens', { query: 'zzzz' }).json.total).toBe(0)
    expect(call('list_tokens', { limit: 3 }).json.tokens).toHaveLength(3)
  })

  it("resolves a raw value to a token, with the compiler's own message", () => {
    const bad = call('resolve_value', { property: 'padding', value: '13px' }).json
    expect(bad.valid).toBe(false)
    expect(bad.code).toMatch(/^T21/)
    expect(bad.tokens.length).toBeGreaterThan(0)
    expect(bad.tokens.every((t: string) => t.startsWith('$space.'))).toBe(true)

    const good = call('resolve_value', { property: 'padding', value: '$space.4' }).json
    expect(good.valid).toBe(true)
  })
})

describe('validating code', () => {
  const bad = `<contract>
{ "name": "Card", "role": "group", "parts": ["root"] }
</contract>
<template><div class="root"><Buton>x</Buton></div></template>
<style>
.root { padding: 13px; }
</style>
`

  it("returns the compiler's errors, in the compiler's words", () => {
    const r = call('validate_snippet', { source: bad }).json
    expect(r.ok).toBe(false)
    const codes = r.diagnostics.map((d: { code: string }) => d.code)
    expect(codes.some((c: string) => c.startsWith('T21'))).toBe(true)
    // The same text `tessera check` prints.
    const first = r.diagnostics[0]
    expect(first.text).toContain(first.code)
    expect(first.text).toContain(first.message)
    expect(first.text).toContain(`tessera explain ${first.code}`)
  })

  it('agrees with the compiler: what the project compiles is what it reports', () => {
    const project = new Project(root, { today: '2026-10-22' })
    const direct = project.compileFile(`${root}/app/components/Card.tess`, bad, { baseline: null })
    const viaTool = call('validate_snippet', { source: bad }).json
    expect(
      viaTool.diagnostics.map((d: { code: string; message: string }) => [d.code, d.message]),
    ).toEqual(direct.raw.map((d) => [d.code, d.message]))
  })

  it('passes a valid component', () => {
    const ok = `<contract>
{ "name": "Card", "role": "group", "parts": ["root"], "slots": { "default": "The card content." } }
</contract>
<template><div class="root"><slot /></div></template>
<style>
.root { padding: $space.4; }
</style>
`
    const r = call('validate_snippet', { source: ok }).json
    expect(r.diagnostics.filter((d: { severity: string }) => d.severity === 'error')).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('rejects a kind it does not know, and never writes a file', () => {
    expect(call('validate_snippet', { source: 'x', kind: 'nope' }).text).toBe(
      '"kind" must be component, page or layout.',
    )
  })
})

describe('apis', () => {
  it('lists each api, whether it has a description, and its endpoints', () => {
    const apis = call('list_apis').json as Array<Record<string, unknown>>
    expect(apis.map((a) => a.name)).toEqual(['backend', 'default'])
    expect(apis[0]).toMatchObject({
      name: 'backend',
      file: 'app/apis/backend.ts',
      described: true,
      base: 'https://example.com/api',
      endpoints: ['GET /tasks', 'POST /tasks'],
    })
    expect(apis[1]).toMatchObject({ name: 'default', described: false, endpoints: [] })
  })

  it('gives an endpoint: what it takes, what it answers with, the types it uses and how to call it', () => {
    const read = call('get_endpoint', { api: 'backend', path: '/tasks' }).json
    expect(read).toMatchObject({
      api: 'backend',
      method: 'GET',
      path: '/tasks',
      returns: 'Task[]',
      description: 'Every task.',
      usage: "const { data, loading, error } = backend.get('/tasks')",
    })
    expect(read.types).toEqual({
      Task: '{ id: number; title: string }',
      NewTask: '{ title: string }',
    })
    const write = call('get_endpoint', { api: 'backend', path: '/tasks', method: 'POST' }).json
    expect(write).toMatchObject({ method: 'POST', body: 'NewTask', returns: 'Task' })
    expect(write.usage).toBe("const run = backend.post('/tasks')\nawait run({ title })")
  })

  it('finds an endpoint from a path with a value in it, and says what is wrong with a call', () => {
    expect(call('get_endpoint', { api: 'backend', path: '/tasks?x=1' }).json.path).toBe('/tasks')
    expect(call('get_endpoint', { api: 'backnd', path: '/tasks' }).text).toBe(
      'There is no API named "backnd". APIs: backend and default. Did you mean "backend"?',
    )
    expect(call('get_endpoint', { api: 'default', path: '/tasks' }).text).toBe(
      'The API "default" has no description (app/apis/default.api.json), so there are no endpoints to look up.',
    )
    expect(call('get_endpoint', { api: 'backend', path: '/task' }).text).toBe(
      'The description of "backend" has no GET /task. Did you mean "/tasks"?',
    )
    expect(call('get_endpoint', { api: 'backend', path: '/tasks', method: 'DELETE' }).text).toBe(
      'The description of "backend" has no DELETE /tasks. /tasks has GET and POST.',
    )
  })
})

describe('shared state', () => {
  it('lists each piece of state, its file and what its file exports', () => {
    const states = call('list_state').json as Array<Record<string, unknown>>
    expect(states).toEqual([
      {
        name: 'cart',
        file: 'app/state/cart.ts',
        members: ['items', 'count', 'add()', 'clear()'],
      },
    ])
  })

  it('gives one piece of state with what each member is and how to use it', () => {
    const cart = call('get_state', { name: 'cart' }).json
    expect(cart).toMatchObject({ name: 'cart', file: 'app/state/cart.ts' })
    expect(cart.members).toEqual([
      {
        name: 'items',
        kind: 'signal',
        usage: '{cart.items} in a template, cart.items.value in a script',
      },
      {
        name: 'count',
        kind: 'signal',
        usage: '{cart.count} in a template, cart.count.value in a script',
      },
      { name: 'add', kind: 'function', usage: 'cart.add()' },
      { name: 'clear', kind: 'function', usage: 'cart.clear()' },
    ])
    expect(cart.readOnly).toBe(
      'Only app/state/cart.ts changes cart: a component calls cart.add() or cart.clear().',
    )
  })

  it('says what is wrong with a name', () => {
    expect(call('get_state', { name: 'crt' }).text).toBe(
      'There is no shared state named "crt". State: cart. Did you mean "cart"?',
    )
  })
})

describe('routes, rules and errors', () => {
  it('lists routes and layouts', () => {
    const r = call('list_routes').json
    expect(r.routes.map((x: { path: string }) => x.path)).toEqual([
      '/',
      '/about',
      '/blog',
      '/blog/:slug',
    ])
    expect(r.layouts).toEqual(['default', 'focus'])
  })

  it('states the rules', () => {
    expect(call('get_rules').json.contrastMinimum).toBe(4.5)
  })

  it('explains an error code, and rejects an unknown one', () => {
    expect(call('explain_error', { code: 'T2102' }).json.explanation).toContain('T2102')
    expect(call('explain_error', { code: 'T0000' }).text).toBe(
      'There is no error or warning code "T0000".',
    )
  })
})

describe('a long session', () => {
  it('sees a component that appears after the server started', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tessera-mcp-'))
    try {
      mkdirSync(join(dir, 'app', 'components'), { recursive: true })
      const live = new McpServer(new Project(dir, { today: '2026-10-22' }))
      const names = () => {
        const r = live.handle({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_components', arguments: {} },
        }) as { result: { content: Array<{ text: string }> } }
        return (JSON.parse(r.result.content[0]!.text) as Array<{ name: string }>).map((c) => c.name)
      }
      expect(names()).not.toContain('Late')
      writeFileSync(
        join(dir, 'app', 'components', 'Late.tess'),
        '<contract>\n{ "name": "Late", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root"></div></template>\n',
      )
      expect(names()).toContain('Late')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
