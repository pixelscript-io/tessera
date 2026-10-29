import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSources, isRemoteSource, type Fetch } from '../src/remote'
import { read, run } from './helpers'

const CSS = ':root { --brand-600: #1d4ed8; --spacing-4: 1rem }'

/** A fetch that answers from a table of address to body (or to a Response), and records what it was asked. */
function server(routes: Record<string, string | Response>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const fetcher: Fetch = async (url, init) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const hit = routes[url]
    if (hit === undefined) return new Response('not found', { status: 404 })
    return typeof hit === 'string' ? new Response(hit) : hit.clone()
  }
  return { fetcher, calls }
}

describe('isRemoteSource', () => {
  it('takes addresses and GitHub paths, not files on disk', () => {
    expect(isRemoteSource('https://example.com/a.css')).toBe(true)
    expect(isRemoteSource('http://example.com/a.css')).toBe(true)
    expect(isRemoteSource('github.com/o/r/blob/main/a.css')).toBe(true)
    expect(isRemoteSource('raw.githubusercontent.com/o/r/main/a.css')).toBe(true)
    for (const local of [
      'a.css',
      './tokens',
      'C:\\tokens\\a.json',
      '/home/me/tokens.json',
      'github.css',
    ]) {
      expect(isRemoteSource(local)).toBe(false)
    }
  })
})

describe('fetchSources', () => {
  it('reads a file at an https address, named by its address', async () => {
    const { fetcher } = server({ 'https://example.com/design/globals.css': CSS })
    const got = await fetchSources(['https://example.com/design/globals.css'], { fetcher })
    expect(got.files).toEqual([{ path: 'globals.css', content: CSS }])
    expect(got.summary).toBe('Read 1 file from 1 address.')
  })

  it('names an address with no extension by what is in it', async () => {
    const { fetcher } = server({
      'https://example.com/api/tokens': '{"a":{"$type":"color","$value":"#fff"}}',
      'https://example.com/api/theme': CSS,
    })
    const got = await fetchSources(
      ['https://example.com/api/tokens', 'https://example.com/api/theme'],
      { fetcher },
    )
    expect(got.files.map((f) => f.path)).toEqual(['tokens.json', 'theme.css'])
  })

  it('turns the address of a GitHub file page into its raw address', async () => {
    const { fetcher, calls } = server({
      'https://raw.githubusercontent.com/acme/design/main/src/globals.css': CSS,
    })
    const got = await fetchSources(['https://github.com/acme/design/blob/main/src/globals.css'], {
      fetcher,
    })
    expect(got.files[0]!.content).toBe(CSS)
    expect(calls[0]!.url).toBe('https://raw.githubusercontent.com/acme/design/main/src/globals.css')
    // A path without https:// is a GitHub path too.
    const bare = await fetchSources(['github.com/acme/design/blob/main/src/globals.css'], {
      fetcher,
    })
    expect(bare.files).toHaveLength(1)
  })

  it('lists a GitHub folder, keeps the .json and .css files, and leaves package.json and node_modules', async () => {
    const listing = (entries: unknown) => JSON.stringify(entries)
    const { fetcher, calls } = server({
      'https://api.github.com/repos/acme/design/contents/tokens?ref=main': listing([
        { type: 'file', name: 'colors.json', path: 'tokens/colors.json' },
        { type: 'file', name: 'package.json', path: 'tokens/package.json' },
        { type: 'file', name: 'README.md', path: 'tokens/README.md' },
        { type: 'dir', name: 'themes', path: 'tokens/themes' },
        { type: 'dir', name: 'node_modules', path: 'tokens/node_modules' },
      ]),
      'https://api.github.com/repos/acme/design/contents/tokens/themes?ref=main': listing([
        { type: 'file', name: 'dark.css', path: 'tokens/themes/dark.css' },
      ]),
      'https://raw.githubusercontent.com/acme/design/main/tokens/colors.json':
        '{"a":{"$type":"color","$value":"#fff"}}',
      'https://raw.githubusercontent.com/acme/design/main/tokens/themes/dark.css': CSS,
    })
    const got = await fetchSources(['https://github.com/acme/design/tree/main/tokens'], { fetcher })
    expect(got.files.map((f) => f.path).sort()).toEqual(['colors.json', 'themes/dark.css'])
    expect(calls.some((c) => c.url.includes('package.json'))).toBe(false)
    expect(calls.some((c) => c.url.includes('node_modules'))).toBe(false)
  })

  it('asks for a file or folder when given a whole repository', async () => {
    const { fetcher, calls } = server({})
    await expect(fetchSources(['https://github.com/acme/design'], { fetcher })).rejects.toThrow(
      'is a repository',
    )
    await expect(
      fetchSources(['https://github.com/acme/design/blob/main'], { fetcher }),
    ).rejects.toThrow('does not name a file or folder')
    expect(calls).toEqual([])
  })

  it('fetches the files a Resolver names that are beside it, and no others', async () => {
    const resolver = JSON.stringify({
      version: '2025.10',
      sets: { base: { sources: [{ $ref: 'base.tokens.json' }, { $ref: '../elsewhere.json' }] } },
      resolutionOrder: [{ $ref: '#/sets/base' }],
    })
    const { fetcher, calls } = server({
      'https://example.com/ds/tokens.resolver.json': resolver,
      'https://example.com/ds/base.tokens.json': '{"a":{"$type":"color","$value":"#fff"}}',
      'https://example.com/elsewhere.json': '{}',
    })
    const got = await fetchSources(['https://example.com/ds/tokens.resolver.json'], { fetcher })
    expect(got.files.map((f) => f.path)).toEqual(['tokens.resolver.json', 'base.tokens.json'])
    expect(calls.some((c) => c.url.endsWith('/elsewhere.json'))).toBe(false)
  })

  it('keeps two files with the same name from different places', async () => {
    const { fetcher } = server({
      'https://a.example.com/tokens.json': '{"a":{"$type":"color","$value":"#fff"}}',
      'https://b.example.com/tokens.json': '{"b":{"$type":"color","$value":"#000"}}',
    })
    const got = await fetchSources(
      ['https://a.example.com/tokens.json', 'https://b.example.com/tokens.json'],
      { fetcher },
    )
    expect(got.files.map((f) => f.path)).toEqual(['tokens.json', '2-tokens.json'])
  })
})

describe('what is refused', () => {
  const never = server({}).fetcher
  it.each([
    ['http://example.com/a.css', 'Only https'],
    ['https://localhost/a.css', 'not a public host'],
    ['https://127.0.0.1/a.css', 'not a public host'],
    ['https://169.254.169.254/latest/meta-data', 'not a public host'],
    ['https://[::1]/a.css', 'not a public host'],
    ['https://printer.local/a.css', 'not a public host'],
    ['https://intranet/a.css', 'not a public host'],
    ['https://user:pass@example.com/a.css', 'user name or password'],
  ])('%s', async (address, why) => {
    const { fetcher, calls } = server({})
    await expect(fetchSources([address], { fetcher })).rejects.toThrow(why)
    expect(calls).toEqual([])
    void never
  })

  it('does not follow a redirect to a private host or to http', async () => {
    for (const location of [
      'https://localhost/a.css',
      'http://example.com/a.css',
      'https://10.0.0.1/a.css',
    ]) {
      const { fetcher } = server({
        'https://example.com/a.css': new Response(null, { status: 302, headers: { location } }),
      })
      await expect(fetchSources(['https://example.com/a.css'], { fetcher })).rejects.toThrow(
        'not read',
      )
    }
  })

  it('follows a redirect to a public https address, a few times', async () => {
    const { fetcher } = server({
      'https://example.com/a.css': new Response(null, {
        status: 301,
        headers: { location: 'https://cdn.example.com/a.css' },
      }),
      'https://cdn.example.com/a.css': CSS,
    })
    expect((await fetchSources(['https://example.com/a.css'], { fetcher })).files).toHaveLength(1)
    const loop = server({
      'https://example.com/a.css': new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/a.css' },
      }),
    })
    await expect(
      fetchSources(['https://example.com/a.css'], { fetcher: loop.fetcher }),
    ).rejects.toThrow('redirects too many times')
  })

  it('stops a file that is too large, by its declared size and by what arrives', async () => {
    const declared = server({
      'https://example.com/a.css': new Response('x', { headers: { 'content-length': '5000000' } }),
    })
    await expect(
      fetchSources(['https://example.com/a.css'], { fetcher: declared.fetcher }),
    ).rejects.toThrow('larger than 2 MB')
    const streamed = server({ 'https://example.com/b.css': 'x'.repeat(2_100_000) })
    await expect(
      fetchSources(['https://example.com/b.css'], { fetcher: streamed.fetcher }),
    ).rejects.toThrow('larger than 2 MB')
  })

  it('says a web page is not a token file, and what a missing address is', async () => {
    const { fetcher } = server({ 'https://example.com/page': '<!DOCTYPE html><html></html>' })
    await expect(fetchSources(['https://example.com/page'], { fetcher })).rejects.toThrow(
      'is a web page',
    )
    await expect(fetchSources(['https://example.com/missing.css'], { fetcher })).rejects.toThrow(
      'was not found',
    )
  })

  it('says when a host cannot be reached', async () => {
    const fetcher: Fetch = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(fetchSources(['https://example.com/a.css'], { fetcher })).rejects.toThrow(
      'example.com could not be reached',
    )
  })
})

describe('GITHUB_TOKEN', () => {
  const SECRET = 'ghp_SECRET_VALUE_1234567890'

  it('goes only to GitHub hosts', async () => {
    const { fetcher, calls } = server({
      'https://raw.githubusercontent.com/acme/design/main/a.css': new Response(null, {
        status: 302,
        headers: { location: 'https://objects.example.com/a.css' },
      }),
      'https://objects.example.com/a.css': CSS,
      'https://example.com/b.css': CSS,
    })
    await fetchSources(
      ['https://github.com/acme/design/blob/main/a.css', 'https://example.com/b.css'],
      {
        fetcher,
        githubToken: SECRET,
      },
    )
    for (const call of calls) {
      const host = new URL(call.url).hostname
      const sent = call.headers.Authorization !== undefined
      expect(sent).toBe(host === 'raw.githubusercontent.com' || host === 'api.github.com')
    }
  })

  describe('through the command', () => {
    const made: string[] = []
    afterAll(() => {
      for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
    })
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    })

    it('imports an address into the blank slate, and the token is never printed or written', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tessera-remote-'))
      made.push(dir)
      await run(dir, 'init', '--tokens', 'none')
      vi.stubEnv('GITHUB_TOKEN', SECRET)
      vi.stubGlobal('fetch', async (url: string) =>
        url === 'https://raw.githubusercontent.com/acme/design/main/globals.css'
          ? new Response(CSS)
          : new Response('no', { status: 404 }),
      )
      const imported = await run(
        dir,
        'tokens',
        'import',
        'https://github.com/acme/design/blob/main/globals.css',
      )
      expect(imported.code).toBe(0)
      expect(imported.out).toContain('Read 1 file from 1 address.')
      expect(imported.out + imported.err).not.toContain(SECRET)
      expect(read(dir, 'system/design/tokens/globals.tokens.json')).toContain('brand')
      expect(read(dir, 'system/design/tokens/globals.tokens.json')).not.toContain(SECRET)
      expect((await run(dir, 'check')).code).toBe(0)
    })

    it('reports an address that is not there and writes nothing', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tessera-remote-'))
      made.push(dir)
      await run(dir, 'init', '--tokens', 'none')
      vi.stubGlobal('fetch', async () => new Response('no', { status: 404 }))
      const imported = await run(dir, 'tokens', 'import', 'https://example.com/missing.css')
      expect(imported.code).toBe(1)
      expect(imported.err).toContain('was not found')
    })
  })
})
