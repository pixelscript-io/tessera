import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import type { Io } from '../src/io'
import { read, run } from './helpers'

const made: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-loose-'))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const CSS = `:root { --color-brand-600: #1d4ed8; --space-4: 1rem; --radius-md: 6px; --brand-hover: var(--color-brand-600); }
.dark { --color-brand-600: #93c5fd; }`

describe('tessera tokens import: a CSS file into the blank slate', () => {
  it('imports the custom properties under their own names, reports the dark block, and the project checks clean', async () => {
    const dir = scratch()
    await run(dir, 'init', '--tokens', 'none')
    writeFileSync(join(dir, 'globals.css'), CSS)
    const imported = await run(dir, 'tokens', 'import', 'globals.css')
    expect(imported.code).toBe(0)
    expect(imported.out).toContain('1 theme')
    const doc = JSON.parse(read(dir, 'system/design/tokens/globals.tokens.json'))
    expect(doc.color.brand['600'].$type).toBe('color')
    expect(doc.space['4'].$value).toEqual({ value: 1, unit: 'rem' })
    expect(doc.brand.hover.$value).toBe('{color.brand.600}')
    const dark = JSON.parse(read(dir, 'system/design/tokens/themes/dark.tokens.json'))
    expect(dark.$extends).toBe('base')
    expect(dark.color.brand['600'].$value.colorSpace).toBe('srgb')
    expect((await run(dir, 'check')).code).toBe(0)
  })

  it('reads the CSS files of a folder', async () => {
    const dir = scratch()
    await run(dir, 'init', '--tokens', 'none')
    mkdirSync(join(dir, 'styles'))
    writeFileSync(join(dir, 'styles', 'a.css'), ':root { --gap-2: 8px }')
    writeFileSync(join(dir, 'styles', 'b.css'), ':root { --gap-3: 12px }')
    const imported = await run(dir, 'tokens', 'import', 'styles')
    expect(imported.code).toBe(0)
    expect(read(dir, 'system/design/tokens/a.tokens.json')).toContain('"gap"')
    expect(read(dir, 'system/design/tokens/b.tokens.json')).toContain('"gap"')
  })
})

describe('tessera tokens import: token names that are not Tessera’s', () => {
  const CSS_OWN = `:root {
  --spacing-4: 1rem;
  --spacing-8: 2rem;
  --rounded-md: 6px;
  --text-sm: 0.875rem;
  --brand-600: #1d4ed8;
  --brand-fg: #ffffff;
}`

  const PAGE = `<template>
  <p class="p">Hello</p>
</template>
<style>
.p {
  padding: $spacing.4;
  border-radius: $rounded.md;
  font-size: $text.sm;
  background: $brand.600;
  color: $brand.fg;
}
</style>
`

  it('sets tokenGroups so styles may use them, and the project checks clean', async () => {
    const dir = scratch()
    await run(dir, 'init', '--tokens', 'none')
    writeFileSync(join(dir, 'own.css'), CSS_OWN)
    writeFileSync(
      join(
        dir,
        'app/components/Note.tess'.replace('/components', '/pages').replace('Note', 'index'),
      ),
      PAGE,
    )
    const imported = await run(dir, 'tokens', 'import', 'own.css')
    expect(imported.code).toBe(0)
    expect(imported.out).toContain('spacing: spacing (2 tokens)')
    expect(imported.out).toContain('radii: rounded (1 token)')
    expect(imported.out).toContain(
      "tokenGroups: { space: ['spacing'], radius: ['rounded'], fontSize: ['text'], color: false }",
    )
    expect(read(dir, 'tessera.config.ts')).toContain('tokenGroups:')
    const checked = await run(dir, 'check')
    expect(checked.err + checked.out).not.toContain('T2103')
    expect(checked.code).toBe(0)
  })

  it('without tokenGroups the same page is refused, which is what the setting is for', async () => {
    const dir = scratch()
    await run(dir, 'init', '--tokens', 'none')
    writeFileSync(join(dir, 'own.css'), CSS_OWN)
    writeFileSync(join(dir, 'app/pages/index.tess'), PAGE)
    await run(dir, 'tokens', 'import', 'own.css', '--out', 'system/design/tokens')
    const checked = await run(dir, 'check')
    expect(checked.code).toBe(1)
    expect(checked.err + checked.out).toContain('T2103')
  })
})

describe('tessera init --tokens none: the first import', () => {
  const CSS_FIRST = ':root { --brand-600: #1d4ed8; --spacing-4: 1rem }'

  it('imports a source given with --import, into a new folder, before the files for AI tools are written', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'globals.css'), CSS_FIRST)
    const made = await run(dir, 'init', 'my-app', '--tokens', 'none', '--import', 'globals.css')
    expect(made.code).toBe(0)
    expect(made.out).toContain('Imported 1 token file')
    expect(made.out).not.toContain('No design tokens yet')
    expect(read(join(dir, 'my-app'), 'system/design/tokens/globals.tokens.json')).toContain('brand')
    expect(read(join(dir, 'my-app'), '.tessera/manifest.json')).toContain('brand')
    expect(read(join(dir, 'my-app'), 'tessera.config.ts')).toContain('tokenGroups')
    expect((await run(join(dir, 'my-app'), 'check')).code).toBe(0)
  })

  it('takes more than one --import', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'a.css'), ':root { --gap-2: 8px }')
    writeFileSync(join(dir, 'b.css'), ':root { --gap-3: 12px }')
    const made = await run(
      dir,
      'init',
      '--tokens',
      'none',
      '--import',
      'a.css',
      '--import',
      'b.css',
    )
    expect(made.code).toBe(0)
    expect(made.out).toContain('Imported 2 token files')
  })

  it('refuses --import for tokens that are not the blank slate, before writing anything', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'a.css'), CSS_FIRST)
    const made = await run(dir, 'init', '--tokens', 'tailwind', '--import', 'a.css')
    expect(made.code).toBe(1)
    expect(made.err).toContain('--import is for the blank slate')
    expect(existsSync(join(dir, 'package.json'))).toBe(false)
  })

  it('keeps the project and says how to try again when the source cannot be read', async () => {
    const dir = scratch()
    const made = await run(dir, 'init', '--tokens', 'none', '--import', 'nope.css')
    expect(made.code).toBe(1)
    expect(made.err).toContain('There is no file or folder "nope.css"')
    expect(made.err).toContain('tokens import <source>')
    expect(existsSync(join(dir, 'package.json'))).toBe(true)
    expect(existsSync(join(dir, 'system/design/tokens/README.md'))).toBe(true)
  })

  it('asks for a source in a terminal, and Enter skips', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'globals.css'), CSS_FIRST)
    const asked: string[] = []
    const io = (answer: string): Io => ({
      cwd: dir,
      out: () => {},
      err: () => {},
      async choose() {
        return 'none'
      },
      async ask(question) {
        asked.push(question)
        return answer
      },
    })
    expect(await main(['init', 'a'], io('"globals.css"'))).toBe(0)
    expect(asked[0]).toContain('Import your design tokens now?')
    expect(existsSync(join(dir, 'a/system/design/tokens/globals.tokens.json'))).toBe(true)
    expect(await main(['init', 'b'], io(''))).toBe(0)
    expect(existsSync(join(dir, 'b/system/design/tokens/globals.tokens.json'))).toBe(false)
  })

  it('without a terminal and without --import it says how to bring tokens in', async () => {
    const dir = scratch()
    const made = await run(dir, 'init', '--tokens', 'none')
    expect(made.out).toContain('No design tokens yet. Bring in yours')
  })
})

describe('tessera tokens import: one tier of tokens', () => {
  const PAGE =
    '<template><p class="p">Hi</p></template>\n<style>\n.p { background: $brand.600; }\n</style>\n'

  it('turns the primitive warning off when every token is a plain value, so using one does not warn', async () => {
    const dir = scratch()
    await run(dir, 'init', '--tokens', 'none')
    writeFileSync(join(dir, 'app/pages/index.tess'), PAGE)
    writeFileSync(join(dir, 'a.css'), ':root { --brand-600: #1d4ed8; --brand-700: #1e40af }')
    const imported = await run(dir, 'tokens', 'import', 'a.css')
    expect(imported.out).toContain('all plain values')
    expect(read(dir, 'tessera.config.ts')).toContain("primitives: 'off'")
    const checked = await run(dir, 'check')
    expect(checked.code).toBe(0)
    expect(checked.out + checked.err).not.toContain('T2105')
  })

  it('keeps the warning when there are aliases, because there is a second tier to prefer', async () => {
    const dir = scratch()
    await run(dir, 'init', '--tokens', 'none')
    writeFileSync(
      join(dir, 'a.css'),
      ':root { --brand-600: #1d4ed8; --action-bg: var(--brand-600) }',
    )
    const imported = await run(dir, 'tokens', 'import', 'a.css')
    expect(imported.out).not.toContain('all plain values')
    expect(read(dir, 'tessera.config.ts')).not.toContain('primitives')
  })

  it('leaves a primitives setting the person already made, and says nothing about it', async () => {
    const dir = scratch()
    await run(dir, 'init', '--tokens', 'none')
    const config = read(dir, 'tessera.config.ts').replace(
      'export default {',
      "export default {\n  primitives: 'error',",
    )
    writeFileSync(join(dir, 'tessera.config.ts'), config)
    writeFileSync(join(dir, 'a.css'), ':root { --brand-600: #1d4ed8 }')
    const imported = await run(dir, 'tokens', 'import', 'a.css')
    expect(imported.out).not.toContain('primitives')
    expect(read(dir, 'tessera.config.ts')).toContain("primitives: 'error'")
    expect(read(dir, 'tessera.config.ts')).not.toContain("primitives: 'off'")
  })
})
