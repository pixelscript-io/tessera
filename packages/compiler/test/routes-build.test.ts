import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'
import type { Rollup } from 'vite'
import { tessera } from '../src/vite'

const base = fileURLToPath(new URL('./fixtures', import.meta.url))
const tokens = join(base, '..', '..', '..', '..', 'system', 'tokens')
const created: string[] = []

const page = (heading: string, body: string) =>
  `<page>{ "title": "${heading}" }</page>\n<template><main><h1>${heading}</h1>${body}</main></template>`

/** A throwaway app inside the test fixtures (so `@tessera/router` resolves), with these files. */
function app(files: Record<string, string>, entry = "import './app/pages/about.tess'\n"): string {
  const root = mkdtempSync(join(base, 'routing-'))
  created.push(root)
  writeFileSync(join(root, 'app-entry.ts'), entry)
  for (const [name, content] of Object.entries({
    'app/pages/about.tess': page('About', ''),
    ...files,
  })) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return root.replaceAll('\\', '/')
}

async function bundle(root: string): Promise<Rollup.OutputChunk[]> {
  const result = (await build({
    root,
    logLevel: 'silent',
    plugins: [tessera({ tokens })],
    build: {
      write: false,
      minify: false,
      lib: { entry: `${root}/app-entry.ts`, formats: ['es'], fileName: 'out' },
      rollupOptions: { external: [/^@tessera\//] },
    },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[]
  return (Array.isArray(result) ? result : [result])
    .flatMap((o) => o.output)
    .filter((c): c is Rollup.OutputChunk => c.type === 'chunk')
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

describe('route conflicts', () => {
  it('fail the build, naming both files and the route', async () => {
    const root = app({
      'app/pages/blog.tess': page('Blog', ''),
      'app/pages/blog/index.tess': page('Blog index', ''),
    })
    await expect(bundle(root)).rejects.toThrow(
      /ERROR {2}T6001 {2}app\/pages\/blog\.tess:1:1\n {2}Route conflict: blog\.tess and blog\/index\.tess both map to "\/blog"\./,
    )
  })

  it('fail the build for a page file that cannot be a route', async () => {
    const root = app({ 'app/pages/my page.tess': page('Bad', '') })
    await expect(bundle(root)).rejects.toThrow(/T6002[\s\S]*"my page" is not a valid route segment/)
  })
})

describe('typed links', () => {
  it('fail the build for <Link to="/abuot">, suggesting the right route', async () => {
    const root = app({
      'app/pages/about.tess': page('About', '<Link to="/abuot">About</Link>'),
    })
    await expect(bundle(root)).rejects.toThrow(
      /ERROR {2}T6004 {2}app\/pages\/about\.tess:2:\d+\n {2}Unknown route "\/abuot"\.\n {2}Did you mean "\/about"\?/,
    )
  })

  it('build when every literal link is a route, including a parameter route', async () => {
    const root = app({
      'app/pages/about.tess': page(
        'About',
        '<Link to="/about">A</Link><Link to="/blog/first">B</Link>',
      ),
      'app/pages/blog/[slug].tess': page('Post', ''),
    })
    await expect(bundle(root)).resolves.toBeDefined()
  })

  it('write .tessera/routes.d.ts with every route and its parameters', async () => {
    const root = app({
      'app/pages/index.tess': page('Home', ''),
      'app/pages/blog/[slug].tess': page('Post', ''),
      'app/pages/404.tess': page('Missing', ''),
    })
    await bundle(root)
    const path = `${root}/.tessera/routes.d.ts`
    expect(existsSync(path)).toBe(true)
    const dts = readFileSync(path, 'utf8')
    expect(dts).toContain("declare module '@tessera/router'")
    expect(dts).toContain('"/": {  }')
    expect(dts).toContain('"/about": {  }')
    expect(dts).toContain('"/blog/:slug": { slug: string }')
    expect(dts).not.toContain('404')
  })
})

describe('the virtual routes module', () => {
  it('lists each page behind a dynamic import', async () => {
    const root = app(
      { 'app/pages/blog/[slug].tess': page('Post', ''), 'app/pages/404.tess': page('Missing', '') },
      "import { routes, notFound } from 'virtual:tessera/routes'\nexport { routes, notFound }\n",
    )
    const entry = (await bundle(root)).find((c) => c.isEntry)!
    expect(entry.dynamicImports.length).toBe(3)
    expect(entry.code).toContain('path: "/about"')
    expect(entry.code).toContain('path: "/blog/:slug"')
    expect(entry.code).toMatch(/notFound = \(\) => import\(/)
  })
})

describe('layouts in a build', () => {
  const layout = '<template><div><slot /></div></template>'

  it('fail the build for an unknown layout name, with a suggestion', async () => {
    const root = app({
      'app/layouts/default.tess': layout,
      'app/pages/about.tess': page('About', '').replace(
        '{ "title": "About" }',
        '{ "layout": "defualt" }',
      ),
    })
    await expect(bundle(root)).rejects.toThrow(
      /ERROR {2}T6003 {2}app\/pages\/about\.tess:1:\d+\n {2}Unknown layout "defualt"\.\n {2}Did you mean "default"\?/,
    )
  })

  it('build with a named layout, with none, and list layouts in the routes module', async () => {
    const root = app(
      {
        'app/layouts/default.tess': layout,
        'app/layouts/docs.tess': layout,
        'app/pages/about.tess': page('About', '').replace(
          '{ "title": "About" }',
          '{ "layout": "docs" }',
        ),
        'app/pages/bare.tess': page('Bare', '').replace(
          '{ "title": "Bare" }',
          '{ "layout": false }',
        ),
      },
      "import { layouts } from 'virtual:tessera/routes'\nexport { layouts }\n",
    )
    const entry = (await bundle(root)).find((c) => c.isEntry)!
    expect(entry.code).toContain('"default": () => import(')
    expect(entry.code).toContain('"docs": () => import(')
  })
})
