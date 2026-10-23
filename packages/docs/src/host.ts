import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tessera } from '@tessera/compiler/vite'
import { build, createServer, type InlineConfig, type ViteDevServer } from 'vite'
import { DOCS_DIR, docsHtml, docsPlugin, type DocsOptions } from './plugin'

/** Vite's config for the docs app. It does not use the project's own `vite.config`: the docs are not the app. */
function config(root: string, options: DocsOptions): InlineConfig {
  return { root, configFile: false, plugins: [tessera(), docsPlugin(options)] }
}

function projectName(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string }
    return pkg.name ?? 'Design system'
  } catch {
    return 'Design system'
  }
}

/** Run the docs app in dev: it reads the project's components and tokens live. */
export async function serveDocs(
  root: string,
  options: DocsOptions & { port?: number } = {},
): Promise<ViteDevServer> {
  const base = config(root, options)
  const server = await createServer({
    ...base,
    ...(options.port !== undefined ? { server: { port: options.port } } : {}),
  })
  await server.listen()
  return server
}

/**
 * Export the docs as static files that any file server can host. The app is built as one ES module with the
 * components it previews in chunks beside it, and an `index.html` that loads it with relative URLs, so the
 * folder works wherever it is put. `report.json` is the coverage report.
 */
export async function exportDocs(
  root: string,
  out: string,
  options: DocsOptions = {},
): Promise<{ files: string[] }> {
  const outDir = resolve(root, out)
  rmSync(outDir, { recursive: true, force: true })
  const base = config(root, options)
  // The generated entry exists once the plugin has read the project; building it needs the same file the dev server serves.
  await build({
    ...base,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      lib: {
        cssFileName: 'docs',
        entry: join(root, ...DOCS_DIR, 'main.ts'),
        formats: ['es'],
        fileName: () => 'docs.js',
      },
      // Plain `.js` everywhere: with no "type": "module" in the project's package.json Vite would write `.mjs`, which not every file server types as JavaScript.
      rollupOptions: { output: { entryFileNames: 'docs.js', chunkFileNames: '[name]-[hash].js' } },
    },
  })
  const css = existsSync(join(outDir, 'docs.css')) ? './docs.css' : undefined
  writeFileSync(join(outDir, 'index.html'), docsHtml(`${projectName(root)} docs`, './docs.js', css))
  const files = ['index.html', 'docs.js', ...(css ? ['docs.css'] : [])]
  return { files }
}
