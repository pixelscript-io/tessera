import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import type { Rollup } from 'vite'
import { tessera } from '@tessera/compiler/vite'

const root = fileURLToPath(new URL('..', import.meta.url))
  .replaceAll('\\', '/')
  .replace(/\/$/, '')

describe('a production build of the kitchen sink', () => {
  it('puts every page in its own lazy chunk', async () => {
    const result = (await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [tessera()],
      build: { write: false, minify: false },
    })) as Rollup.RollupOutput | Rollup.RollupOutput[]
    const chunks = (Array.isArray(result) ? result : [result]).flatMap((o) =>
      o.output.filter((c): c is Rollup.OutputChunk => c.type === 'chunk'),
    )

    const pages = ['index', 'about', '404', 'blog/index', 'blog/[slug]']
    const pageChunks = pages.map((page) => {
      const chunk = chunks.find((c) =>
        c.facadeModuleId?.replaceAll('\\', '/').endsWith(`/app/pages/${page}.tess`),
      )
      expect(chunk, `a chunk for pages/${page}.tess`).toBeDefined()
      return chunk!
    })
    expect(new Set(pageChunks.map((c) => c.fileName)).size).toBe(pages.length)

    // The entry chunk loads them by dynamic import, not statically, so a visit fetches only its own page.
    const entry = chunks.find((c) => c.isEntry)!
    for (const chunk of pageChunks) {
      expect(chunk.isDynamicEntry).toBe(true)
      expect(entry.imports).not.toContain(chunk.fileName)
      expect(entry.dynamicImports).toContain(chunk.fileName)
    }
    // A page's own code is in its chunk and nowhere else.
    const about = pageChunks[1]!
    expect(about.code).toContain('This app exercises every part of the framework.')
    expect(entry.code).not.toContain('This app exercises every part of the framework.')
  })
})
