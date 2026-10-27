import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { tessera } from './packages/compiler/dist/vite.js'

// Unit tests run in node/jsdom. `*.browser.test.ts` runs in a real browser (the installed Edge, so
// no browser download is needed) for things jsdom cannot do: computed styles from custom properties,
// and running `.tess` components compiled by the Vite plugin. The kitchen-sink app has its own project
// rooted in its folder, because its pages and components resolve against its own `app/` folder.
const browser = () => ({
  enabled: true,
  headless: true,
  provider: playwright({ launchOptions: { channel: 'msedge' } }),
  instances: [{ browser: 'chromium' as const }],
})

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          // Several tests start real dev servers and browsers; under a full parallel run the default 5s is too tight.
          testTimeout: 30_000,
          include: [
            'packages/*/{src,test}/**/*.test.ts',
            'examples/*/{src,app}/**/*.test.ts',
            'website/test/**/*.test.ts',
          ],
          exclude: ['**/*.browser.test.ts', '**/node_modules/**'],
        },
      },
      {
        plugins: [tessera()],
        test: {
          name: 'browser',
          include: [
            'packages/*/{src,test}/**/*.browser.test.ts',
            'system/**/*.browser.test.ts',
            'packages/*/components/**/*.browser.test.ts',
          ],
          browser: browser(),
        },
      },
      {
        // The landing page is a Tessera app too: its own tokens, and its own components in `app/`.
        root: 'landing',
        plugins: [tessera()],
        optimizeDeps: { include: ['axe-core'] },
        test: {
          name: 'landing',
          include: ['app/**/*.browser.test.ts'],
          // A computer's width: the page has a phone layout below 720px, and the tests that need it set their own.
          browser: { ...browser(), viewport: { width: 1280, height: 900 } },
        },
      },
      {
        root: 'examples/kitchen-sink',
        plugins: [tessera()],
        test: {
          name: 'kitchen-sink',
          include: ['app/**/*.browser.test.ts'],
          browser: browser(),
        },
      },
    ],
  },
})
