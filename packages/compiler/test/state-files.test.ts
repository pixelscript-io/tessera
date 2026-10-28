import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readStateFile } from '../src/shared-state'
import { tessera } from '../src/vite'

// What the build does to a file in app/state, and what the compiler knows about what it exports. Persisted and url
// state are signals, and a state file marks its body so that what it makes is shared state (see core's shared.ts).
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '')

interface Context {
  errors: string[]
}

/** Run the plugin's transform the way Vite does, without a server. */
async function transform(
  source: string,
  path: string,
): Promise<{ result: { code: string } | null | undefined; ctx: Context }> {
  const plugin = tessera({ today: '2026-10-22' })
  ;(plugin.configResolved as (c: unknown) => void)({ root, command: 'build' })
  const ctx: Context = { errors: [] }
  const hooks = {
    error(e: string | { message: string }) {
      ctx.errors.push(typeof e === 'string' ? e : e.message)
      throw new Error(typeof e === 'string' ? e : e.message)
    },
    warn() {},
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
  return { result, ctx }
}

describe('what a state file exports', () => {
  it('knows that persisted and urlState make signals, as state does', () => {
    expect(
      readStateFile(
        "export const items = persisted('items', [])\nexport const page = urlState('page', 1)\nexport const plain = state(0)\nexport const label = 'x'",
      ),
    ).toEqual({ items: 'signal', page: 'signal', plain: 'signal', label: 'value' })
  })

  it('reads them with a type argument and options', () => {
    expect(
      readStateFile(
        "export const prefs = persisted<Prefs>('prefs', {}, { version: 2 })\nexport const q = urlState<string>('q', '')",
      ),
    ).toEqual({ prefs: 'signal', q: 'signal' })
  })
})

describe('the Vite plugin: state files', () => {
  const source = "import { state } from '@pixelscriptio/tessera/core'\nexport const n = state(0)\n"

  it('puts the call that marks a state file first, so what its body makes is shared state', async () => {
    const out = await transform(source, `${root}/app/state/cart.ts`)
    expect(out.ctx.errors).toEqual([])
    expect(out.result!.code).toBe(
      "import { __beginStateFile } from '@pixelscriptio/tessera/core'\n" +
        '__beginStateFile("app/state/cart.ts", import.meta.hot)\n' +
        source,
    )
  })

  it('does it for a file in a folder of the state folder, and names it as the project shows it', async () => {
    const out = await transform(source, `${root}/app/state/cart/items.ts`)
    expect(out.result!.code).toContain(
      '__beginStateFile("app/state/cart/items.ts", import.meta.hot)',
    )
  })

  it('writes a name that cannot end the string, whatever the file is called', async () => {
    const out = await transform(source, `${root}/app/state/we"ird.ts`)
    expect(out.result!.code).toContain('__beginStateFile("app/state/we\\"ird.ts", import.meta.hot)')
  })

  it('leaves alone a file that is not state: elsewhere, a declaration, a test, a query', async () => {
    for (const path of [
      `${root}/app/utils/cart.ts`,
      `${root}/app/state/cart.d.ts`,
      `${root}/app/state/cart.test.ts`,
      `${root}/app/state/cart.spec.ts`,
      `${root}/app/state/notes.md`,
    ]) {
      const out = await transform(source, path)
      expect(out.result, path).toBeFalsy()
    }
    expect((await transform(source, `${root}/app/state/cart.ts?raw`)).result).toBeFalsy()
  })

  it('still says what to import in a state file that uses state without importing it', async () => {
    const out = await transform('export const n = state(0)\n', `${root}/app/state/cart.ts`)
    expect(out.ctx.errors.join('\n')).toContain('state')
    expect(out.result).toBeFalsy()
  })
})
