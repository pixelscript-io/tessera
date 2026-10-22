import { defineConfig } from 'vite'

// The VS Code extension host loads CommonJS, so the extension is bundled to one file with everything
// it needs. `vscode` is provided by the host.
export default defineConfig({
  build: {
    lib: {
      entry: { extension: 'src/extension.ts' },
      formats: ['cjs'],
      fileName: (_format, name) => `${name}.cjs`,
    },
    outDir: 'vscode/dist',
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    rollupOptions: { external: ['vscode', /^node:/] },
  },
})
