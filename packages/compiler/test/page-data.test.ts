import { describe, expect, it } from 'vitest'
import { compile, readPageMeta, type CompileOptions } from '../src'
import { generateRoutesModule } from '../src/routes'

// A page can say what data it needs in its <page> block, so the router asks for it when the person navigates, and a
// prerender writes it into the page.

const template = '<template><main>x</main></template>'
const page = (block: string) => `<page>\n${block}\n</page>\n${template}`

const issues = (source: string, options: Partial<CompileOptions> = {}) =>
  compile(source, {
    file: 'posts/[id].tess',
    path: '/p/app/pages/posts/[id].tess',
    kind: 'page',
    ...options,
  }).diagnostics.map((d) => `${d.code} ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

const github = { name: 'github', file: '/p/app/apis/github.ts' }

describe('the data of a page: what is accepted', () => {
  it('takes a path on the default api, with the parameters of the route', () => {
    expect(issues(page('{ "data": ["/posts/:id", "/posts/:id/comments"] }'))).toEqual([])
  })

  it('takes an object with a query, and one that names an api of the project', () => {
    expect(
      issues(
        page(
          '{ "data": [{ "path": "/posts", "query": { "limit": 10, "draft": false, "sort": "new" } }, { "api": "github", "path": "/users/:id" }] }',
        ),
        { apis: [github] },
      ),
    ).toEqual([])
  })

  it('takes a full address', () => {
    expect(issues(page('{ "data": ["https://api.example.com/things"] }'))).toEqual([])
  })

  it('takes wait with true or false', () => {
    expect(issues(page('{ "data": ["/a"], "wait": true }'))).toEqual([])
    expect(issues(page('{ "wait": false }'))).toEqual([])
  })

  it('leaves the page module as it was: the title and the layout, not the data', () => {
    const result = compile(page('{ "title": "Post", "data": ["/posts/:id"], "wait": true }'), {
      file: 'posts/[id].tess',
      path: '/p/app/pages/posts/[id].tess',
      kind: 'page',
    })
    expect(result.code).toContain('export const page = {"title":"Post"}')
    expect(result.code).not.toContain('/posts/:id')
    expect(result.code).not.toContain('"wait"')
  })
})

describe('the data of a page: what is refused, and what is said', () => {
  it('says data is a list', () => {
    expect(issues(page('{ "data": "/posts/:id" }'))).toEqual([
      expect.stringContaining('T6005 "data" must be a list'),
    ])
  })

  it('says an entry is a path or an object', () => {
    expect(issues(page('{ "data": [7] }'))[0]).toMatch(/T6005 .*path.*object/)
  })

  it('suggests the field that was meant', () => {
    // It also says the read has no path: the misspelled one is the likely reason.
    expect(issues(page('{ "data": [{ "paths": "/a" }] }'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/T6005 .*"paths".*Did you mean "path"\?/)]),
    )
    expect(issues(page('{ "dat": [] }'))[0]).toMatch(/Did you mean "data"\?/)
  })

  it('needs a path in an object', () => {
    expect(issues(page('{ "data": [{ "query": {} }] }'))[0]).toMatch(/T6005 .*needs a "path"/)
  })

  it('wants a path that starts with / or is a full http address', () => {
    expect(issues(page('{ "data": ["posts"] }'))[0]).toMatch(/T6005 .*"posts".*starts with \//)
    expect(issues(page('{ "data": ["javascript:alert(1)"] }'))[0]).toMatch(/T6005/)
    expect(issues(page('{ "data": [""] }'))[0]).toMatch(/T6005/)
  })

  it('names the parameters the route has when a path asks for one it does not', () => {
    expect(issues(page('{ "data": ["/posts/:slug"] }'))).toEqual([
      expect.stringMatching(/T6005 .*":slug".*"id"/),
    ])
    // A page that is not a dynamic route has none to give.
    expect(
      issues(page('{ "data": ["/posts/:id"] }'), {
        path: '/p/app/pages/about.tess',
        file: 'about.tess',
      })[0],
    ).toMatch(/T6005 .*":id".*no parameters/)
  })

  it('says a query is an object of text, numbers and booleans', () => {
    expect(issues(page('{ "data": [{ "path": "/a", "query": [1] }] }'))[0]).toMatch(
      /T6005 .*"query" must be an object/,
    )
    expect(issues(page('{ "data": [{ "path": "/a", "query": { "x": { "y": 1 } } }] }'))[0]).toMatch(
      /T6005 .*"x"/,
    )
  })

  it('says wait is true or false', () => {
    expect(issues(page('{ "wait": "yes" }'))[0]).toMatch(/T6005 .*"wait" must be true or false/)
  })

  it('names an api that does not exist, and the one that was meant', () => {
    expect(
      issues(page('{ "data": [{ "api": "gihub", "path": "/a" }] }'), { apis: [github] }),
    ).toEqual([expect.stringMatching(/T5004 "gihub" is not an API.*Did you mean "github"\?/)])
    expect(issues(page('{ "data": [{ "api": "nope", "path": "/a" }] }'), { apis: [] })[0]).toMatch(
      /T5004 "nope"/,
    )
  })

  it('does not take more than a page could reasonably need', () => {
    const many = Array.from({ length: 21 }, (_, i) => `"/a${i}"`).join(',')
    expect(issues(page(`{ "data": [${many}] }`))[0]).toMatch(/T6005 .*20/)
  })

  it('is not allowed in a layout or a component, which have no <page> block at all', () => {
    expect(
      issues(page('{ "data": ["/a"] }'), {
        kind: 'layout',
        path: '/p/app/layouts/x.tess',
        file: 'x.tess',
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringMatching(/T4013 A layout cannot have a <page> block/)]),
    )
  })
})

describe('readPageMeta: the <page> block of a source, for a host that builds the routes', () => {
  it('gives the title, the layout, the data and wait', () => {
    expect(
      readPageMeta(
        page(
          '{ "title": "Post", "layout": "wide", "data": ["/posts/:id", { "api": "github", "path": "/u", "query": { "a": 1 } }], "wait": true }',
        ),
      ),
    ).toEqual({
      title: 'Post',
      layout: 'wide',
      data: [{ path: '/posts/:id' }, { api: 'github', path: '/u', query: { a: 1 } }],
      wait: true,
    })
  })

  it('gives nothing for a page with no block, and what it can for one that is wrong', () => {
    expect(readPageMeta(template)).toEqual({})
    expect(readPageMeta(page('{ "title": "T", "data": 5 }'))).toEqual({ title: 'T' })
    expect(readPageMeta(page('not json'))).toEqual({})
  })
})

describe('the routes module', () => {
  const manifest = {
    routes: [
      { path: '/posts/:id', file: 'posts/[id].tess', params: ['id'] },
      { path: '/about', file: 'about.tess', params: [] },
    ],
    diagnostics: [],
  } as never

  it('is as it was for pages that declare nothing', () => {
    const text = generateRoutesModule(manifest, '/app/pages')
    expect(text).toContain(
      '  { path: "/posts/:id", load: () => import("/app/pages/posts/[id].tess") },',
    )
    expect(text).not.toContain('prefetch')
    expect(text).not.toContain('@pixelscriptio/tessera/core')
  })

  it('starts what a page declared when the person navigates, with only the parameters its path names', () => {
    const text = generateRoutesModule(manifest, '/app/pages', [], '/app/layouts', {
      pages: new Map([
        [
          'posts/[id].tess',
          {
            data: [{ path: '/posts/:id' }, { path: '/posts', query: { limit: 10, tag: "it's" } }],
            wait: true,
          },
        ],
      ]),
    })
    expect(text).toContain(
      "import { prefetch as __tessera_prefetch } from '@pixelscriptio/tessera/core'",
    )
    expect(text).toContain('wait: true')
    expect(text).toContain('__tessera_prefetch("/posts/:id", { "id": params["id"] })')
    // The id is not given to a path that has no :id, where it would become part of the query and the answer would not be shared.
    expect(text).toContain('__tessera_prefetch("/posts", {"limit":10,"tag":"it\'s"})')
  })

  it('uses the api of the project that a page names, imported once, and the default api when the project has one', () => {
    const text = generateRoutesModule(manifest, '/app/pages', [], '/app/layouts', {
      pages: new Map([
        [
          'posts/[id].tess',
          { data: [{ api: 'github', path: '/a' }, { api: 'github', path: '/b' }, { path: '/c' }] },
        ],
      ]),
      apis: [
        { name: 'github', importPath: '/app/apis/github.ts' },
        { name: 'default', importPath: '/app/apis/default.ts' },
      ],
    })
    expect(text.match(/import __tessera_api_github from "\/app\/apis\/github.ts"/g)).toHaveLength(1)
    expect(text).toContain('import __tessera_api_default from "/app/apis/default.ts"')
    expect(text).toContain('__tessera_api_github.prefetch("/a", {})')
    expect(text).toContain('__tessera_api_default.prefetch("/c", {})')
    expect(text).not.toContain('__tessera_prefetch(')
  })

  it('writes a name that cannot end a string, whatever a page says', () => {
    const text = generateRoutesModule(manifest, '/app/pages', [], '/app/layouts', {
      pages: new Map([['about.tess', { data: [{ path: '/a"; alert(1); "' }] }]]),
    })
    expect(text).toContain('"/a\\"; alert(1); \\""')
    expect(text).not.toContain('/a"; alert')
  })

  it('has a page that needs a parameter it does not have asked for nothing', () => {
    const text = generateRoutesModule(manifest, '/app/pages', [], '/app/layouts', {
      pages: new Map([['about.tess', { data: [{ path: '/posts/:id' }] }]]),
    })
    expect(text).toContain('__tessera_prefetch("/posts/:id", { "id": params["id"] })')
    // The router gives it no params for this route, so the read has nothing to ask for (the page's own read says why).
    expect(text).toContain('path: "/about"')
  })
})
