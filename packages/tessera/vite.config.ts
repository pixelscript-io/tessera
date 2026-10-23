import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const packages = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))

// Builds the published package: one ES module per entry, with the internal @tessera/* packages bundled in and
// shared code (the signals runtime, for one) in common chunks, so `core` and `router` use the same runtime.
// Vite and Acorn are real dependencies; the virtual modules belong to the user's own Vite.
export default defineConfig({
  resolve: {
    alias: [
      // The compiler's prebuilt Vite entry is its own bundle; build from source so chunks are shared.
      { find: '@tessera/compiler/vite', replacement: packages('compiler/src/vite.ts') },
    ],
  },
  build: {
    lib: {
      entry: {
        core: 'src/core.ts',
        router: 'src/router.ts',
        'router-app': 'src/router-app.ts',
        behavior: 'src/behavior.ts',
        tokens: 'src/tokens.ts',
        vite: 'src/vite.ts',
        cli: 'src/cli.ts',
      },
      formats: ['es'],
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    sourcemap: false,
    rollupOptions: {
      external: ['vite', 'acorn', /^node:/, /^virtual:/],
    },
  },
})
