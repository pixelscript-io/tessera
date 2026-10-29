import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
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
    expect(imported.out).toContain('outside the root')
    const doc = JSON.parse(read(dir, 'system/design/tokens/globals.tokens.json'))
    expect(doc.color.brand['600'].$type).toBe('color')
    expect(doc.space['4'].$value).toEqual({ value: 1, unit: 'rem' })
    expect(doc.brand.hover.$value).toBe('{color.brand.600}')
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
