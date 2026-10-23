import { defineConfig } from 'vite'

// Builds the CLI to plain JavaScript that `bin/tessera.js` imports. The workspace packages it uses are
// bundled in until packages are published; Vite and Acorn stay external.
export default defineConfig({
  build: {
    lib: { entry: { index: 'src/index.ts' }, formats: ['es'] },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    rollupOptions: { external: ['vite', 'acorn', 'prettier', /^prettier\//, /^node:/] },
  },
})
