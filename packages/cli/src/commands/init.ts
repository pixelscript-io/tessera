import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Args } from '../args'
import { flag } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import BUTTON from '../../../../system/components/Button.tess?raw'
import BASE_TOKENS from '../../../../system/tokens/base.tokens.json?raw'
import DARK_TOKENS from '../../../../system/tokens/themes/dark.tokens.json?raw'
import COMPACT_TOKENS from '../../../../system/tokens/themes/compact.tokens.json?raw'

const PACKAGES = ['core', 'behavior', 'router', 'tokens'] as const
const DEV_PACKAGES = ['cli', 'compiler'] as const

/** The tessera checkout this CLI runs from, if it is one: packages are not published yet, so projects link to it. */
export function findCheckout(from = dirname(fileURLToPath(import.meta.url))): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    if (
      existsSync(join(dir, 'pnpm-workspace.yaml')) &&
      existsSync(join(dir, 'packages', 'core', 'package.json'))
    ) {
      return dir
    }
    if (dirname(dir) === dir) return undefined
  }
}

const PAGE = `<page>
{ "title": "Welcome" }
</page>

<script>
const count = state(0)

function inc() {
  count.value++
}
</script>

<template>
  <main>
    <h1>Welcome to Tessera</h1>
    <p>Edit app/pages/index.tess and save: the page updates without a reload.</p>
    <Button tone="primary" @press="inc">Clicked {count} times</Button>
  </main>
</template>
`

const LAYOUT = `<template>
  <div class="root">
    <p class="brand">My Tessera app</p>
    <slot />
  </div>
</template>

<style>
.root {
  padding: $space.4;
  color: $color.text.default;
  font-family: system-ui, sans-serif;
}

.brand {
  margin: 0;
}
</style>
`

const MAIN = `import 'virtual:tessera/tokens.css'
import { createApp } from '@tessera/router/app'

createApp().mount('#app')
`

const TYPES = `declare module '*.tess' {
  import type { Component } from '@tessera/core'
  const component: Component
  export default component
}

declare module 'virtual:tessera/tokens.css'
`

const CONFIG = `// Style rules, severity exemptions and options for Tessera. See the docs for every field.
// export default { severity: [{ files: 'app/legacy/**', rules: '*', level: 'warn', reason: 'old screens', expires: '2027-01-01' }] }
export default {}
`

const VITE = `import { defineConfig } from 'vite'
import { tessera } from '@tessera/compiler/vite'

export default defineConfig({ plugins: [tessera()] })
`

const HTML = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/app/main.ts"></script>
  </body>
</html>
`

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "strict": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["app", "system", ".tessera"]
}
`

const GITIGNORE = `node_modules
dist
.tessera
`

/**
 * `tessera init [folder]`: a project that runs: a Vite config, base tokens with light, dark and compact themes,
 * one Button, and an `app/` with `main.ts`, a default layout and the index page. Packages are not published
 * yet, so dependencies link to the checkout this CLI came from (`--link <path>` names another).
 */
export async function init(args: Args, io: Io): Promise<number> {
  const target = resolve(io.cwd, args.positional[0] ?? '.')
  const name =
    basename(target)
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .toLowerCase() || 'tessera-app'

  if (existsSync(target) && readdirSync(target).some((f) => f !== '.git')) {
    const clash = ['package.json', 'app', 'system', 'vite.config.ts'].filter((f) =>
      existsSync(join(target, f)),
    )
    if (clash.length) {
      throw new CliError(
        `${args.positional[0] ?? 'This folder'} already has ${clash.join(', ')}.`,
        'Run tessera init in an empty folder, or give it a new folder name.',
      )
    }
  }

  const given = flag(args, 'link')
  const checkout = typeof given === 'string' ? resolve(io.cwd, given) : findCheckout()
  const dependency = (pkg: string) =>
    checkout
      ? `link:${relative(target, join(checkout, 'packages', pkg)).replaceAll('\\', '/')}`
      : '^0.1.0'

  const manifest = {
    name,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', check: 'tessera check' },
    dependencies: Object.fromEntries(PACKAGES.map((p) => [`@tessera/${p}`, dependency(p)])),
    devDependencies: {
      ...Object.fromEntries(DEV_PACKAGES.map((p) => [`@tessera/${p}`, dependency(p)])),
      typescript: '^5.7.0',
      vite: '^7.3.0',
    },
  }

  const files: Record<string, string> = {
    'package.json': JSON.stringify(manifest, null, 2) + '\n',
    'vite.config.ts': VITE,
    'tessera.config.ts': CONFIG,
    'tsconfig.json': TSCONFIG,
    'index.html': HTML(name),
    '.gitignore': GITIGNORE,
    'system/tokens/base.tokens.json': BASE_TOKENS,
    'system/tokens/themes/dark.tokens.json': DARK_TOKENS,
    'system/tokens/themes/compact.tokens.json': COMPACT_TOKENS,
    'system/components/Button.tess': BUTTON,
    'app/main.ts': MAIN,
    'app/tess.d.ts': TYPES,
    'app/layouts/default.tess': LAYOUT,
    'app/pages/index.tess': PAGE,
  }
  for (const [file, content] of Object.entries(files)) {
    const path = join(target, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }

  const where = args.positional[0]
  io.out(`Created a Tessera project in ${where ?? 'the current folder'}.`)
  if (!checkout) {
    io.out(
      'Note: Tessera is not published yet and no local checkout was found, so the dependency versions are placeholders.',
    )
  }
  io.out('')
  io.out('Next:')
  if (where) io.out(`  cd ${where}`)
  io.out('  pnpm install')
  io.out('  pnpm dev')
  return 0
}
