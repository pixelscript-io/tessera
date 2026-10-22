import { defineConfig } from 'vitest/config'
import { tessera } from './packages/compiler/dist/vite.js'

// Unit tests run in node/jsdom. `*.browser.test.ts` runs in a real browser (the installed Edge, so
// no browser download is needed) for things jsdom cannot do: computed styles from custom properties,
// and running `.tess` components compiled by the Vite plugin. The kitchen-sink app has its own project
// rooted in its folder, because its pages and components resolve against its own `app/` folder.
const browser = () => ({
  enabled: true,
  headless: true,
  provider: 'playwright' as const,
  instances: [{ browser: 'chromium' as const, launch: { channel: 'msedge' } }],
})

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
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
