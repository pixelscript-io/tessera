import { describe, expect, it } from 'vitest'
import {
  buildRouteManifest,
  matchRoute,
  pagePaths,
  parsePattern,
  splitTarget,
} from '../src/manifest'

const paths = (files: string[]) => buildRouteManifest(files).routes.map((r) => r.path)

describe('buildRouteManifest: files become routes', () => {
  it('maps the table in the spec', () => {
    const manifest = buildRouteManifest([
      'index.tess',
      'about.tess',
      'blog/index.tess',
      'blog/[slug].tess',
      '404.tess',
    ])
    expect(manifest.diagnostics).toEqual([])
    expect(manifest.routes.map((r) => [r.file, r.path, r.params])).toEqual([
      ['index.tess', '/', []],
      ['about.tess', '/about', []],
      ['blog/index.tess', '/blog', []],
      ['blog/[slug].tess', '/blog/:slug', ['slug']],
    ])
    expect(manifest.notFound).toEqual({ file: '404.tess' })
  })

  it('supports nested folders and several parameters', () => {
    expect(paths(['shop/[category]/[id].tess', 'shop/index.tess', 'a/b/c.tess'])).toEqual([
      '/shop',
      '/a/b/c',
      '/shop/:category/:id',
    ])
  })

  it('orders routes so static segments beat parameters', () => {
    expect(paths(['blog/[slug].tess', 'blog/new.tess', '[page].tess', 'about.tess'])).toEqual([
      '/about',
      '/blog/new',
      '/blog/:slug',
      '/:page',
    ])
    const { routes } = buildRouteManifest(['blog/[slug].tess', 'blog/new.tess'])
    expect(matchRoute(routes, '/blog/new')!.route.file).toBe('blog/new.tess')
    expect(matchRoute(routes, '/blog/other')!.route.file).toBe('blog/[slug].tess')
  })

  it('ignores files that are not pages', () => {
    expect(paths(['index.tess', 'notes.md', 'logo.png'])).toEqual(['/'])
  })
})

describe('buildRouteManifest: conflicts and bad names', () => {
  it('reports two files that map to the same route, naming both', () => {
    const manifest = buildRouteManifest(['blog.tess', 'blog/index.tess', 'about.tess'])
    expect(manifest.diagnostics).toEqual([
      {
        code: 'T6001',
        message: 'Route conflict: blog.tess and blog/index.tess both map to "/blog".',
        hint: 'Keep one of them. A folder default is index.tess, so blog.tess and blog/index.tess clash.',
        files: ['blog.tess', 'blog/index.tess'],
      },
    ])
    // Neither side of the conflict is routed, so it cannot silently pick one.
    expect(manifest.routes.map((r) => r.path)).toEqual(['/about'])
  })

  it('treats differently named parameters in the same position as a conflict', () => {
    const [d] = buildRouteManifest(['blog/[id].tess', 'blog/[slug].tess']).diagnostics
    expect(d).toMatchObject({
      code: 'T6001',
      message: 'Route conflict: blog/[id].tess and blog/[slug].tess both map to "/blog/:id".',
    })
  })

  it('names every file in a group of three', () => {
    const [d] = buildRouteManifest(['a.tess', 'a/index.tess', 'a/index/index.tess']).diagnostics
    expect(d!.files).toEqual(['a.tess', 'a/index.tess'])
  })

  it('rejects catch-all routes, invalid names, repeated parameters and nested 404 pages', () => {
    expect(buildRouteManifest(['[...rest].tess']).diagnostics[0]).toMatchObject({
      code: 'T6002',
      message: '[...rest].tess: "[...rest]" is a catch-all route, which is not supported yet.',
    })
    expect(buildRouteManifest(['my page.tess']).diagnostics[0]).toMatchObject({
      message: 'my page.tess: "my page" is not a valid route segment.',
      hint: 'Use letters, numbers, "-" and "_", or [name] for a parameter.',
    })
    expect(buildRouteManifest(['a/[x]/[x].tess']).diagnostics[0]!.message).toBe(
      'a/[x]/[x].tess: The parameter "x" appears twice in this path.',
    )
    expect(buildRouteManifest(['blog/404.tess']).diagnostics[0]).toMatchObject({
      message: 'blog/404.tess: 404.tess is only used at the top of the pages folder.',
      hint: 'Move it to pages/404.tess.',
    })
    expect(buildRouteManifest(['post-[id].tess']).diagnostics[0]!.code).toBe('T6002')
  })

  it('has no not-found page unless 404.tess exists', () => {
    expect(buildRouteManifest(['index.tess']).notFound).toBeUndefined()
  })
})

describe('matchRoute', () => {
  const { routes } = buildRouteManifest([
    'index.tess',
    'about.tess',
    'blog/index.tess',
    'blog/[slug].tess',
    'shop/[a]/[b].tess',
  ])

  it('matches static routes, the home page, and a trailing slash', () => {
    expect(matchRoute(routes, '/')!.route.file).toBe('index.tess')
    expect(matchRoute(routes, '')!.route.file).toBe('index.tess')
    expect(matchRoute(routes, '/about')!.route.file).toBe('about.tess')
    expect(matchRoute(routes, '/about/')!.route.file).toBe('about.tess')
    expect(matchRoute(routes, '/blog')!.route.file).toBe('blog/index.tess')
  })

  it('captures and decodes parameters', () => {
    expect(matchRoute(routes, '/blog/hello-world')!.params).toEqual({ slug: 'hello-world' })
    expect(matchRoute(routes, '/blog/a%20b%2Fc')!.params).toEqual({ slug: 'a b/c' })
    expect(matchRoute(routes, '/shop/shoes/42')!.params).toEqual({ a: 'shoes', b: '42' })
  })

  it('returns undefined for no match, a path that is too long, and a malformed escape', () => {
    expect(matchRoute(routes, '/nope')).toBeUndefined()
    expect(matchRoute(routes, '/blog/a/b')).toBeUndefined()
    expect(matchRoute(routes, '/blog/%E0%A4%A')).toBeUndefined()
    expect(matchRoute([], '/')).toBeUndefined()
  })

  it('is case sensitive', () => {
    expect(matchRoute(routes, '/About')).toBeUndefined()
  })
})

describe('helpers', () => {
  it('parses a pattern back into segments', () => {
    expect(parsePattern('/blog/:slug')).toEqual([
      { kind: 'static', value: 'blog' },
      { kind: 'param', name: 'slug' },
    ])
    expect(parsePattern('/')).toEqual([])
  })

  it('turns glob keys into page paths', () => {
    expect(
      pagePaths(
        ['./pages/index.tess', './pages/blog/[slug].tess', './components/X.tess'],
        './pages',
      ),
    ).toEqual(['index.tess', 'blog/[slug].tess'])
  })

  it('splits a link target', () => {
    expect(splitTarget('/blog/a?draft=1#top')).toEqual({
      path: '/blog/a',
      query: '?draft=1',
      hash: '#top',
    })
    expect(splitTarget('/x#y')).toEqual({ path: '/x', query: '', hash: '#y' })
    expect(splitTarget('/x')).toEqual({ path: '/x', query: '', hash: '' })
  })
})
