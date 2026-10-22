import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import type { Rollup } from 'vite'
import { tessera } from '../src/vite'

const root = fileURLToPath(new URL('./fixtures/autoimport-app', import.meta.url)).replaceAll(
  '\\',
  '/',
)

async function bundle(options: Parameters<typeof tessera>[0] = {}): Promise<string> {
  const result = (await build({
    root,
    logLevel: 'silent',
    plugins: [tessera(options)],
    build: {
      write: false,
      minify: false,
      lib: { entry: `${root}/app/entry.ts`, formats: ['es'], fileName: 'out' },
      rollupOptions: { external: [/^@tessera\//] },
    },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[]
  const outputs = Array.isArray(result) ? result : [result]
  return outputs
    .flatMap((o) => o.output)
    .map((chunk) => ('code' in chunk ? chunk.code : ''))
    .join('\n')
}

describe('a production build of an app that uses auto-imports', () => {
  it('bundles the components the app uses, and not the ones it does not', async () => {
    const code = await bundle()
    expect(code).toContain('USED_MARKER_8f3a')
    expect(code).not.toContain('UNUSED_MARKER_91cb')
  })

  it('has real imports in the output, with no runtime registry', async () => {
    const code = await bundle()
    // The component is a plain bundled function; nothing looks names up at runtime.
    expect(code).not.toMatch(/registry/i)
    expect(code).not.toContain('resolveComponent')
    expect(code).toContain('defineComponent')
  })

  it('writes .tessera/components.d.ts listing every component, used or not', async () => {
    await bundle()
    const dts = readFileSync(`${root}/.tessera/components.d.ts`, 'utf8')
    expect(existsSync(`${root}/.tessera/components.d.ts`)).toBe(true)
    for (const name of ['Used', 'Unused', 'Page'])
      expect(dts).toContain(`${name}: { props: ${name}Props`)
    expect(dts).toContain("declare module '*/Unused.tess'")
  })

  it('fails the build with autoImports off, naming the import to add', async () => {
    await expect(bundle({ config: { autoImports: false } })).rejects.toThrow(
      /T4007[\s\S]*Unknown component <Used>[\s\S]*Auto-imports are off, so import it: import Used from "\.\/Used\.tess"/,
    )
  })
})
