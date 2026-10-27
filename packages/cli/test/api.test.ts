import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { parse } from 'acorn'
import { describe, expect, it } from 'vitest'
import { project, read, run, write } from './helpers'

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const json = (schema: unknown) => ({ content: { 'application/json': { schema } } })

const PETS = {
  openapi: '3.1.0',
  info: { title: 'Swagger Petstore', description: 'A pet shop' },
  servers: [{ url: 'https://petstore.example.com/v1' }],
  paths: {
    '/pets': {
      get: {
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'The pets', ...json({ type: 'array', items: ref('Pet') }) },
        },
      },
      post: {
        requestBody: { required: true, ...json(ref('NewPet')) },
        responses: { '201': { description: 'Made', ...json(ref('Pet')) } },
      },
    },
    '/pets/{petId}': {
      parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { responses: { '200': json(ref('Pet')), '404': { description: 'No such pet' } } },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'integer' }, name: { type: 'string' }, tag: { type: 'string' } },
      },
      NewPet: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, tag: { type: 'string' } },
      },
    },
  },
}

const app = () => project({ 'app/pages/index.tess': '<template><main>Hi</main></template>\n' })
const spec = (root: string, name = 'pets.openapi.json', document: unknown = PETS) => {
  write(root, name, JSON.stringify(document))
  return name
}

describe('tessera api import', () => {
  it('writes the description beside a new api, and the api file to put its base and headers in', async () => {
    const root = app()
    const { code, out } = await run(root, 'api', 'import', spec(root), '--name', 'pets')
    expect(code).toBe(0)
    const description = JSON.parse(read(root, 'app/apis/pets.api.json')) as Record<string, any>
    expect(description.base).toBe('https://petstore.example.com/v1')
    expect(description.types.Pet).toEqual({ id: 'number', name: 'string', tag: 'string?' })
    expect(description.paths['/pets'].get).toMatchObject({
      query: { limit: 'number?' },
      returns: 'Pet[]',
    })
    expect(description.paths['/pets/:petId'].get.errors).toEqual({ '404': 'No such pet' })
    expect(read(root, 'app/apis/pets.ts')).toContain(
      "import { createApi } from '@pixelscriptio/tessera/core'",
    )
    expect(read(root, 'app/apis/pets.ts')).toContain("base: 'https://petstore.example.com/v1'")
    expect(out).toContain('Imported 3 endpoints and 2 types into app/apis/pets.api.json.')
    expect(out).toContain('Wrote app/apis/pets.ts: set its base URL and headers there.')
    expect(out).toContain('Use it in a .tess script as pets.get(')
  })

  it('makes a description that the project then checks calls against', async () => {
    const root = app()
    await run(root, 'api', 'import', spec(root), '--name', 'pets')
    write(
      root,
      'app/pages/pets.tess',
      "<script>\nconst list = pets.get('/pet')\n</script>\n<template><main>{list.data}</main></template>\n",
    )
    const { code, out } = await run(root, 'check')
    expect(code).toBe(1)
    expect(out).toContain('T5006')
    expect(out).toContain('The description of "pets" has no GET /pet.')
    expect(out).toContain('Did you mean "/pets"?')
  })

  it('names the api from the title of the file when it is not told', async () => {
    const root = app()
    const { out } = await run(root, 'api', 'import', spec(root))
    expect(existsSync(join(root, 'app/apis/swaggerPetstore.api.json'))).toBe(true)
    expect(out).toContain('The API is called swaggerPetstore. Use --name to choose another.')
  })

  it('keeps an api file that is already there, and does not overwrite a description without --force', async () => {
    const root = app()
    write(root, 'app/apis/pets.ts', "export default 'mine'\n")
    await run(root, 'api', 'import', spec(root), '--name', 'pets')
    expect(read(root, 'app/apis/pets.ts')).toBe("export default 'mine'\n")
    // The same file again is nothing to do.
    const same = await run(root, 'api', 'import', spec(root), '--name', 'pets')
    expect(same.code).toBe(0)
    expect(same.out).toContain('app/apis/pets.api.json is already up to date.')
    // A different one is not written over what is there.
    const changed = { ...PETS, paths: { '/pets': PETS.paths['/pets'] } }
    spec(root, 'newer.json', changed)
    const again = await run(root, 'api', 'import', 'newer.json', '--name', 'pets')
    expect(again.code).toBe(1)
    expect(again.err).toContain('Not importing: app/apis/pets.api.json already exists.')
    expect(again.err).toContain('replace it with --force')
  })

  it('says what a new import changes, and replaces the description with --force', async () => {
    const root = app()
    await run(root, 'api', 'import', spec(root), '--name', 'pets')
    const changed = structuredClone(PETS) as any
    delete changed.paths['/pets'].post
    changed.paths['/pets'].get.parameters.push({
      name: 'sort',
      in: 'query',
      required: true,
      schema: { type: 'string' },
    })
    changed.paths['/owners'] = {
      get: { responses: { '200': json({ type: 'array', items: { type: 'string' } }) } },
    }
    spec(root, 'pets2.openapi.json', changed)
    const kept = await run(root, 'api', 'import', 'pets2.openapi.json', '--name', 'pets')
    expect(kept.err).toContain('breaking  POST /pets was removed')
    expect(kept.err).toContain('breaking  GET /pets now needs "sort"')
    expect(kept.err).toContain('additive  GET /owners is new')
    const forced = await run(
      root,
      'api',
      'import',
      'pets2.openapi.json',
      '--name',
      'pets',
      '--force',
    )
    expect(forced.code).toBe(0)
    expect(forced.out).toContain('breaking  POST /pets was removed')
    expect(JSON.parse(read(root, 'app/apis/pets.api.json')).paths['/pets'].post).toBeUndefined()
  })

  it('says what it could not read, and still writes', async () => {
    const root = app()
    const odd = {
      openapi: '3.1.0',
      info: { title: 'x' },
      paths: {
        '/a': {
          get: {
            operationId: 'getA',
            responses: { '200': json({ oneOf: [{ type: 'string' }, { type: 'number' }] }) },
          },
        },
      },
    }
    const { code, out } = await run(
      root,
      'api',
      'import',
      spec(root, 'odd.json', odd),
      '--name',
      'odd',
    )
    expect(code).toBe(0)
    expect(out).toContain('1 thing was not read:')
    expect(out).toContain('GET /a: oneOf is not read, so it is unknown.')
    expect(JSON.parse(read(root, 'app/apis/odd.api.json')).paths['/a'].get.returns).toBe('unknown')
  })

  it('reads a description from a web address', async () => {
    const server: Server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(PETS))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/openapi.json`
      const root = app()
      const { code } = await run(root, 'api', 'import', url, '--name', 'web')
      expect(code).toBe(0)
      expect(existsSync(join(root, 'app/apis/web.api.json'))).toBe(true)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('writes a server address that is not a plain URL as a string, whatever is in it', async () => {
    const root = app()
    const hostile = "https://a.example.com/v1\n', evil: 1, x: '\\\u2028\"end"
    const document = { ...PETS, servers: [{ url: hostile }] }
    await run(root, 'api', 'import', spec(root, 'hostile.json', document), '--name', 'pets')
    const text = read(root, 'app/apis/pets.ts')
    // It is a module that reads, and it holds the address exactly, with nothing else added.
    const tree = parse(text, { ecmaVersion: 'latest', sourceType: 'module' }) as any
    const declaration = tree.body.find(
      (n: any) => n.type === 'ExportDefaultDeclaration',
    ).declaration
    const properties = declaration.arguments[0].properties
    expect(properties.map((p: any) => p.key.name)).toEqual(['base'])
    expect(properties[0].value.value).toBe(hostile)
  })

  it('does not read a description larger than 10 MB from a web address', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 120)
    const server: Server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(big)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/openapi.json`
      const { code, err } = await run(app(), 'api', 'import', url, '--name', 'big')
      expect(code).toBe(1)
      expect(err).toContain('is larger than 10 MB')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('says what is wrong with what it was given', async () => {
    const root = app()
    expect((await run(root, 'api', 'import')).err).toContain(
      'Say which OpenAPI file or web address to import.',
    )
    expect((await run(root, 'api', 'import', 'missing.json', '--name', 'x')).err).toContain(
      'There is no file "missing.json".',
    )
    write(root, 'api.yaml', 'openapi: 3.0.0\n')
    expect((await run(root, 'api', 'import', 'api.yaml', '--name', 'x')).err).toContain(
      'is not JSON',
    )
    expect((await run(root, 'api', 'import', 'api.yaml', '--name', 'x')).err).toContain(
      'YAML is not read',
    )
    write(root, 'swagger.json', JSON.stringify({ swagger: '2.0', paths: {} }))
    expect((await run(root, 'api', 'import', 'swagger.json', '--name', 'x')).err).toContain(
      'This is Swagger 2.0.',
    )
    expect((await run(root, 'api', 'import', spec(root), '--name', 'my-api')).err).toContain(
      '"my-api" cannot be the name of an api',
    )
    expect((await run(root, 'api', 'nope')).err).toContain('Unknown api command "nope".')
  })

  it('is in the help, with the other ways to see what it does', async () => {
    const root = app()
    const help = await run(root, 'api', 'import', '--help')
    expect(help.out).toContain('tessera api import <file or web address>')
    expect(help.out).toContain('--force')
    expect((await run(root, 'help')).out).toContain('api import')
  })
})
