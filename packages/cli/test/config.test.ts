import { join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { tessera } from '@tessera/compiler/vite'
import { component, page, project, write } from './helpers'

/** Build a throwaway project through the Vite plugin, with no options passed to it. */
async function bundle(root: string): Promise<void> {
  write(root, 'app/entry.ts', "import './components/Old.tess'\n")
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [tessera()],
    build: {
      write: false,
      minify: false,
      lib: { entry: join(root, 'app/entry.ts'), formats: ['es'], cssFileName: 'style' },
      rollupOptions: { external: [/^@tessera\//] },
    },
  })
}

const old = {
  'app/components/Old.tess': component('Old', '.root { padding: 13px; }'),
  'app/pages/index.tess': page(),
}

describe('tessera.config.ts', () => {
  it('is read by the Vite plugin, so a build and `tessera check` agree', async () => {
    const failing = project(old)
    await expect(bundle(failing)).rejects.toThrow(/T2102/)

    const exempt = project(
      old,
      `severity: [{ files: 'app/**', rules: 'T2102', level: 'warn', reason: 'legacy spacing' }]`,
    )
    await expect(bundle(exempt)).resolves.toBeUndefined()
  })

  it('rejects an exemption with no reason, in both the build and check', async () => {
    const root = project(old, `severity: [{ files: 'app/**', rules: 'T2102', level: 'off' }]`)
    await expect(bundle(root)).rejects.toThrow(/T2112/)
  })

  it('lets options passed to the plugin win over the file', async () => {
    const root = project(
      old,
      `severity: [{ files: 'app/**', rules: 'T2102', level: 'warn', reason: 'legacy spacing' }]`,
    )
    write(root, 'app/entry.ts', "import './components/Old.tess'\n")
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [tessera({ config: {} })],
        build: {
          write: false,
          lib: { entry: join(root, 'app/entry.ts'), formats: ['es'], cssFileName: 'style' },
          rollupOptions: { external: [/^@tessera\//] },
        },
      }),
    ).rejects.toThrow(/T2102/)
  })
})
