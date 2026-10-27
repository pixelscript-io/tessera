import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
// Inside this repository the plugin is the built workspace package; a project of your own imports it from '@pixelscriptio/tessera/vite'.
import { tessera } from '@tessera/compiler/vite'

// The generated accessibility tests run in a real browser (Vitest browser mode, with Playwright).
// Install a browser once with `npx playwright install chromium`, or set TESSERA_A11Y_CHANNEL=msedge (or chrome)
// to use one that is already installed.
export default defineConfig({
  plugins: [tessera()],
  // axe-core is not an ES module, so the browser needs Vite to convert it first.
  optimizeDeps: { include: ['axe-core'] },
  test: {
    include: ['{app,system}/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      viewport: { width: 1280, height: 900 },
      provider: playwright({
        launchOptions: { channel: process.env.TESSERA_A11Y_CHANNEL || undefined },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
