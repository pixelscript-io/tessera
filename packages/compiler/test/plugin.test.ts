import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Baseline } from '../src/accountability'
import type { TesseraConfig } from '../src/config'
import { tessera } from '../src/vite'

const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '')

interface Context {
  errors: string[]
  warnings: string[]
}

/** Run the plugin's hooks the way Vite does, without a server. */
async function transform(
  source: string,
  path: string,
  options: Parameters<typeof tessera>[0] = {},
): Promise<{
  result: { code: string } | null | undefined
  ctx: Context
  plugin: ReturnType<typeof tessera>
}> {
  const plugin = tessera({ today: '2026-10-22', ...options })
  ;(plugin.configResolved as (c: unknown) => void)({ root, command: 'build' })
  const ctx: Context = { errors: [], warnings: [] }
  const hooks = {
    error(e: string | { message: string }) {
      ctx.errors.push(typeof e === 'string' ? e : e.message)
      throw new Error(typeof e === 'string' ? e : e.message)
    },
    warn(w: string | { message: string }) {
      ctx.warnings.push(typeof w === 'string' ? w : w.message)
    },
    addWatchFile() {},
  }
  let result
  try {
    result = await (
      plugin.transform as (
        this: unknown,
        code: string,
        id: string,
      ) => Promise<{ code: string } | null | undefined>
    ).call(hooks, source, path)
  } catch {
    result = undefined
  }
  return { result, ctx, plugin }
}

const page = (css: string) =>
  `<template><div class="a"></div></template>\n<style>\n${css}\n</style>`
const file = `${root}/app/pages/legacy/Old.tess`

describe('the Vite plugin: styles and accountability', () => {
  it('turns a style block into a scoped CSS import served by its own request', async () => {
    const { result, plugin } = await transform(
      page('.a { padding: $space.4; color: $color.text.default }'),
      `${root}/app/pages/Index.tess`,
    )
    expect(result!.code.split('\n')[0]).toContain('./Index.tess?tess&type=style&lang.css')
    const css = await (plugin.load as (this: unknown, id: string) => unknown).call(
      {},
      `${root}/app/pages/Index.tess?tess&type=style&lang.css`,
    )
    expect(css).toContain('@layer tessera.components {')
    expect(css).toContain(
      '.t-page-Index__a { padding: var(--t-space-4); color: var(--t-color-text-default) }',
    )
  })

  it('serves the token CSS as virtual:tessera/tokens.css', async () => {
    const plugin = tessera()
    ;(plugin.configResolved as (c: unknown) => void)({ root, command: 'build' })
    const id = (plugin.resolveId as (id: string) => string | null)('virtual:tessera/tokens.css')
    expect(id).toBe('\0virtual:tessera/tokens.css')
    const css = await (plugin.load as (this: unknown, id: string) => unknown).call(
      {
        addWatchFile() {},
        error: (m: string) => {
          throw new Error(m)
        },
      },
      id!,
    )
    expect(css).toContain(':where(:root) {')
    expect(css).toContain('--t-space-4: 16px;')
  })

  it('fails the build on a style violation, with the compiler message', async () => {
    const { result, ctx } = await transform(page('.a { padding: 13px }'), file)
    expect(result).toBeUndefined()
    expect(ctx.errors[0]).toContain('ERROR  T2102  app/pages/legacy/Old.tess:3:15')
    expect(ctx.errors[0]).toContain('Did you mean "$space.3" (12px)?')
  })

  it('lets a baseline absorb existing violations, and fails beyond it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tessera-'))
    const baselinePath = join(dir, 'tessera.baseline.json')
    const baseline: Baseline = { version: 1, files: { 'app/pages/legacy/Old.tess': { T2102: 1 } } }
    writeFileSync(baselinePath, JSON.stringify(baseline))

    const covered = await transform(page('.a { padding: 13px }'), file, { baseline: baselinePath })
    expect(covered.ctx.errors).toEqual([])
    expect(covered.result!.code).toContain('t-page-legacy-Old__a')
    expect(covered.result!.code).toContain('./Old.tess?tess&type=style&lang.css')

    const worse = await transform(page('.a { padding: 13px; margin: 9px }'), file, {
      baseline: baselinePath,
    })
    expect(worse.result).toBeUndefined()
    expect(worse.ctx.errors).toHaveLength(1)
    expect(worse.ctx.errors[0]).toContain('"9px" in "margin"')
    expect(worse.ctx.errors[0]).not.toContain('"13px"')
  })

  it('applies severity exemptions with a reason, and turns them back to errors after expiry', async () => {
    const config: TesseraConfig = {
      severity: [
        {
          files: 'app/pages/legacy/**',
          rules: '*',
          level: 'warn',
          reason: 'migrating',
          expires: '2027-03-01',
        },
      ],
    }
    const during = await transform(page('.a { padding: 13px }'), file, {
      config,
      today: '2027-01-01',
    })
    expect(during.ctx.errors).toEqual([])
    expect(during.ctx.warnings[0]).toContain('WARNING  T2102')

    const after = await transform(page('.a { padding: 13px }'), file, {
      config,
      today: '2027-03-02',
    })
    expect(after.result).toBeUndefined()
    expect(after.ctx.errors[0]).toContain('expired on 2027-03-01: "migrating"')
  })

  it('rejects an exemption with no reason when the config loads', async () => {
    const plugin = tessera({ config: { severity: [{ files: 'a/**', rules: '*', level: 'off' }] } })
    await expect(
      (plugin.configResolved as (c: unknown) => Promise<void>)({ root, command: 'build' }),
    ).rejects.toThrow(/T2112.*without a reason/s)
  })

  it('does not let a baseline hide an error that stops code generation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tessera-'))
    const baselinePath = join(dir, 'b.json')
    writeFileSync(
      baselinePath,
      JSON.stringify({ version: 1, files: { 'app/pages/legacy/Old.tess': { T2102: 5 } } }),
    )
    const { result, ctx } = await transform('<template><div></template>', file, {
      baseline: baselinePath,
    })
    expect(result).toBeUndefined()
    expect(ctx.errors[0]).toContain('T4003')
  })

  it('compiles a file with raw() and warns about it, without failing', async () => {
    const { result, ctx } = await transform(
      page('.a { padding: raw(13px, "legacy modal", "2027-03-01") }'),
      file,
    )
    expect(ctx.errors).toEqual([])
    expect(result).toBeTruthy()
    expect(ctx.warnings[0]).toContain('T2111')
  })
})

describe('the Vite plugin: auto-imports in plain .ts files', () => {
  it('fails with the import to add, in the compiler format', async () => {
    const { result, ctx } = await transform(
      'export function here() {\n  const route = useRoute()\n  return route.path\n}',
      `${root}/app/utils/nav.ts`,
    )
    expect(result).toBeUndefined()
    expect(ctx.errors[0]).toBe(
      [
        'ERROR  T5002  app/utils/nav.ts:2:17',
        '  Unresolved identifier "useRoute" in app/utils/nav.ts. Auto-imports only apply inside .tess files; import it from "@tessera/router".',
        '  Run `tessera explain T5002` for details.',
      ].join('\n'),
    )
  })

  it('leaves a .ts file that imports what it uses, and files outside the project, alone', async () => {
    const ok = await transform(
      "import { state } from '@tessera/core'\nexport const n = state(0)",
      `${root}/app/utils/ok.ts`,
    )
    expect(ok.ctx.errors).toEqual([])
    const outside = await transform('state(0)', '/elsewhere/lib/thing.ts')
    expect(outside.ctx.errors).toEqual([])
    const nodeModules = await transform('state(0)', `${root}/node_modules/pkg/index.ts`)
    expect(nodeModules.ctx.errors).toEqual([])
  })

  it('does not look at declaration files or query imports', async () => {
    expect(
      (await transform('declare function state(): void\nstate()', `${root}/app/x.d.ts`)).ctx.errors,
    ).toEqual([])
    expect((await transform('state(0)', `${root}/app/x.ts?raw`)).ctx.errors).toEqual([])
  })
})
