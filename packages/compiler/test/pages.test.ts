import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compile, extractContract, type CompileOptions, type ComponentResolver } from '../src'

const link = readFileSync(
  fileURLToPath(new URL('../../router/components/Link.tess', import.meta.url)),
  'utf8',
)
const linkInfo = { contract: extractContract(link, 'Link.tess')!, importPath: '@x/Link.tess' }
const resolver: ComponentResolver = {
  resolve: (tag) => (tag === 'Link' ? linkInfo : undefined),
  names: () => ['Link'],
}

const routes = ['/', '/about', '/blog', '/blog/:slug']

const page = (template: string, extra = '') =>
  `${extra}<template><main>${template}</main></template>`

const issues = (source: string, options: Partial<CompileOptions> = {}) =>
  compile(source, {
    file: 'about.tess',
    path: '/app/pages/about.tess',
    kind: 'page',
    ...options,
  }).diagnostics.map(
    (d) => `${d.code} ${d.line}:${d.column} ${d.message}${d.hint ? ` | ${d.hint}` : ''}`,
  )

describe('<page> block', () => {
  it('exports the title as page metadata', () => {
    const result = compile(page('Hi', '<page>{ "title": "About us" }</page>\n'), {
      file: 'about.tess',
      path: '/app/pages/about.tess',
      kind: 'page',
    })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('export const page = {"title":"About us"}')
  })

  it('exports empty metadata when there is no block, so every page module has the same shape', () => {
    const result = compile(page('Hi'), {
      file: 'about.tess',
      path: '/app/pages/about.tess',
      kind: 'page',
    })
    expect(result.code).toContain('export const page = {}')
  })

  it('accepts comments in the block', () => {
    expect(
      issues(page('Hi', '<page>\n{ // shown in the tab\n  "title": "A" }\n</page>\n')),
    ).toEqual([])
  })

  it('exports the layout a page picks, or false for none', () => {
    const opts = {
      file: 'a.tess',
      path: '/app/pages/a.tess',
      kind: 'page' as const,
      layouts: ['default', 'docs'],
    }
    expect(compile(page('Hi', '<page>{ "layout": "docs" }</page>\n'), opts).code).toContain(
      'export const page = {"layout":"docs"}',
    )
    expect(compile(page('Hi', '<page>{ "layout": false }</page>\n'), opts).code).toContain(
      'export const page = {"layout":false}',
    )
  })

  it('reports an unknown layout, suggesting the nearest', () => {
    const layouts = ['default', 'docs']
    expect(issues(page('Hi', '<page>{ "layout": "defualt" }</page>\n'), { layouts })).toEqual([
      'T6003 1:19 Unknown layout "defualt". | Did you mean "default"?',
    ])
    expect(issues(page('Hi', '<page>{ "layout": "zzzzzzzz" }</page>\n'), { layouts })).toEqual([
      'T6003 1:19 Unknown layout "zzzzzzzz". | Layouts: "default", "docs".',
    ])
    expect(issues(page('Hi', '<page>{ "layout": "x" }</page>\n'), { layouts: [] })).toEqual([
      'T6003 1:19 Unknown layout "x". | There are no layouts yet. Add app/layouts/x.tess.',
    ])
  })

  it('does not check the layout name when the host gave no layout list', () => {
    expect(issues(page('Hi', '<page>{ "layout": "anything" }</page>\n'))).toEqual([])
  })

  it('rejects a layout that is not a string or false', () => {
    expect(issues(page('Hi', '<page>{ "layout": 3 }</page>\n'))).toEqual([
      'T6005 1:19 "layout" must be the name of a layout, or false for none.',
    ])
    expect(issues(page('Hi', '<page>{ "layout": true }</page>\n'))[0]).toContain('T6005')
  })

  it('reports an unknown field with a suggestion', () => {
    expect(issues(page('Hi', '<page>{ "titel": "A" }</page>\n'))).toEqual([
      'T6005 1:9 The <page> block has no field "titel". | Did you mean "title"?',
    ])
  })

  it('reports a title that is not a string, a block that is not an object, and bad JSON', () => {
    expect(issues(page('Hi', '<page>{ "title": 3 }</page>\n'))[0]).toContain(
      'T6005 1:18 "title" must be a string.',
    )
    expect(issues(page('Hi', '<page>[1]</page>\n'))[0]).toContain(
      'T6005 1:7 The <page> block must be an object',
    )
    expect(issues(page('Hi', '<page>{ title }</page>\n'))[0]).toMatch(
      /^T6005 1:\d+ The <page> block is not valid JSON/,
    )
  })

  it('is not allowed in a component', () => {
    const source = `<contract>{ "name": "Card", "role": "group", "parts": ["root"] }</contract>
<page>{ "title": "x" }</page>
<template><div class="root"></div></template>`
    expect(compile(source, { file: 'Card.tess' }).diagnostics.map((d) => d.message)).toContain(
      'A component cannot have a <page> block. That block is for files in the pages folder.',
    )
  })
})

describe('layout files', () => {
  const layout = (template: string, extra = '') =>
    compile(`${extra}<template>${template}</template>`, {
      file: 'default.tess',
      path: '/app/layouts/default.tess',
      kind: 'layout',
    })

  it('compile with a default slot and need no contract', () => {
    const result = layout(
      '<div class="root"><slot /></div>',
      '<style>.root { padding: $space.2 }</style>',
    )
    expect(result.diagnostics).toEqual([])
    expect(result.code).toContain('$ctx.slot("default")')
    expect(result.code).toContain('t-layout-default__root')
  })

  it('must have a slot for the page', () => {
    expect(
      layout('<div class="root"></div>').diagnostics.map(
        (d) => `${d.code} ${d.message} | ${d.hint}`,
      ),
    ).toEqual([
      'T6006 This layout has no <slot />, so pages would have nowhere to render. | Add <slot /> where the page should appear.',
    ])
    // A slot nested in other elements or a condition counts; a named slot alone does not.
    expect(layout('<div><section><slot /></section></div>').diagnostics).toEqual([])
    expect(layout('<div><slot name="x" /></div>').diagnostics.map((d) => d.code)).toContain('T6006')
  })

  it('cannot have a <contract> or a <page> block', () => {
    const codes = layout('<div><slot /></div>', '<page>{ "title": "x" }</page>\n').diagnostics.map(
      (d) => d.message,
    )
    expect(codes).toEqual([
      'A layout cannot have a <page> block. That block is for files in the pages folder.',
    ])
  })
})

describe('page class prefix', () => {
  it('comes from the path, so two index pages do not share class names', () => {
    const style = '<style>.title { color: red; }</style>'
    const compileAt = (path: string) =>
      compile(`<template><main class="title">Hi</main></template>${style}`, {
        file: 'index.tess',
        path,
        kind: 'page',
      })
    expect(compileAt('/app/pages/index.tess').code).toContain('t-page-index__title')
    expect(compileAt('/app/pages/blog/index.tess').code).toContain('t-page-blog-index__title')
    expect(compileAt('/app/pages/blog/[slug].tess').code).toContain('t-page-blog-slug__title')
  })
})

describe('<Link to> is checked against the routes', () => {
  const opts = { components: resolver, routes }

  it('accepts known routes, parameter routes, a query and a hash', () => {
    expect(issues(page('<Link to="/about">About</Link>'), opts)).toEqual([])
    expect(issues(page('<Link to="/blog/hello-world">Post</Link>'), opts)).toEqual([])
    expect(issues(page('<Link to="/about?x=1#top">About</Link>'), opts)).toEqual([])
    expect(issues(page('<Link to="/">Home</Link>'), opts)).toEqual([])
  })

  it('fails the compile for an unknown literal path, with a suggestion', () => {
    const source = page('<Link to="/abuot">About</Link>')
    const result = compile(source, { file: 'about.tess', kind: 'page', ...opts })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('')
    expect(issues(source, opts)).toEqual([
      'T6004 1:27 Unknown route "/abuot". | Did you mean "/about"?',
    ])
  })

  it('lists the routes when nothing is close', () => {
    expect(issues(page('<Link to="/zzzzzzzz">x</Link>'), opts)[0]).toContain(
      'Known routes: "/", "/about", "/blog", "/blog/:slug".',
    )
  })

  it('does not check a dynamic target, an outside link, or a build with no route list', () => {
    expect(
      issues(
        page('<Link :to="target">x</Link>', '<script>const target = "/nope"</script>\n'),
        opts,
      ),
    ).toEqual([])
    expect(issues(page('<Link to="https://example.com">x</Link>'), opts)).toEqual([])
    expect(issues(page('<Link to="/abuot">x</Link>'), { components: resolver })).toEqual([])
  })
})

describe('router script APIs', () => {
  const src = (script: string) =>
    `<script>${script}</script><template><main><button @click="go">x</button></main></template>`

  it('imports navigate and useRoute from the router package when used', () => {
    const result = compile(src('const route = useRoute()\nfunction go() { navigate("/about") }'), {
      file: 'about.tess',
      kind: 'page',
    })
    expect(result.ok).toBe(true)
    expect(result.code).toContain(
      'import { navigate, useRoute } from "@pixelscriptio/tessera/router"',
    )
    expect(result.code).not.toContain('navigate as')
  })

  it('names the right package when auto-imports are off', () => {
    const result = compile(src('function go() { navigate("/about") }'), {
      file: 'about.tess',
      kind: 'page',
      autoImports: false,
    })
    expect(result.diagnostics.map((d) => `${d.code} ${d.message} | ${d.hint}`)).toContain(
      'T5003 "navigate" is not defined. Auto-imports are off, so it must be imported. | Add: import { navigate } from "@pixelscriptio/tessera/router"',
    )
  })
})
