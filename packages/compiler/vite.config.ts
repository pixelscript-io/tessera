import { defineConfig } from 'vite'

// Builds only the Node entry (the Vite plugin) to plain JavaScript, so a vite.config.ts or vitest.config.ts
// can load it natively. The browser-safe core (`src/index.ts`) is consumed from source by Vite itself.
export default defineConfig({
  build: {
    lib: {
      entry: { vite: 'src/vite.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    rollupOptions: {
      // @tessera/contract is bundled in until packages are published.
      external: ['vite', 'acorn', /^node:/],
    },
  },
})
