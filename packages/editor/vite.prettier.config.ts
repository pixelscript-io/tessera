import { defineConfig } from 'vite'

// Prettier loads plugins natively, so the plugin is built to plain ESM. Prettier itself is a peer.
export default defineConfig({
  build: {
    lib: {
      entry: { 'prettier-plugin': 'src/prettier-plugin.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    rollupOptions: { external: ['prettier', /^node:/] },
  },
})
