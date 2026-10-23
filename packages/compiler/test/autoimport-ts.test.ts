import { describe, expect, it } from 'vitest'
import { checkPlainScriptAutoImports, formatDiagnostic } from '../src'

const check = (source: string, file = 'app/utils/nav.ts') =>
  checkPlainScriptAutoImports(source, file)

describe('auto-imports used in a plain .ts file', () => {
  it('names the import to add, in the compiler format, at the call', () => {
    const [d] = check(
      'export function here() {\n  const route = useRoute()\n  return route.path\n}',
    )
    expect(formatDiagnostic(d!)).toBe(
      [
        'ERROR  T5002  app/utils/nav.ts:2:17',
        '  Unresolved identifier "useRoute" in app/utils/nav.ts. Auto-imports only apply inside .tess files; import it from "@pixelscriptio/tessera/router".',
        '  Run `tessera explain T5002` for details.',
      ].join('\n'),
    )
  })

  it('covers every auto-imported name and names the right package for each', () => {
    const source =
      'state(0)\nderived(() => 1)\neffect(() => {})\nonCleanup(() => {})\nonMount(() => {})\nnavigate("/")\nuseRoute()'
    expect(check(source).map((d) => d.message.match(/"[^"]+"/g)!.join(' '))).toEqual([
      '"state" "@pixelscriptio/tessera/core"',
      '"derived" "@pixelscriptio/tessera/core"',
      '"effect" "@pixelscriptio/tessera/core"',
      '"onCleanup" "@pixelscriptio/tessera/core"',
      '"onMount" "@pixelscriptio/tessera/core"',
      '"navigate" "@pixelscriptio/tessera/router"',
      '"useRoute" "@pixelscriptio/tessera/router"',
    ])
  })

  it('reports each name once, at its first call', () => {
    expect(check('state(1)\nstate(2)\nstate(3)')).toHaveLength(1)
    expect(check('state(1)\nstate(2)')[0]).toMatchObject({ line: 1, column: 1 })
  })

  it('is fine when the file imports the name, including renamed and type-only forms', () => {
    expect(
      check("import { state, derived } from '@tessera/core'\nstate(0)\nderived(() => 1)"),
    ).toEqual([])
    expect(check("import { state as s } from '@tessera/core'\ns(0)")).toEqual([])
    expect(check("import * as core from '@tessera/core'\ncore.state(0)")).toEqual([])
  })

  it('is fine when the name is declared or taken as a parameter in the file', () => {
    expect(check('function state() {}\nstate()')).toEqual([])
    expect(check('const derived = (x: number) => x\nderived(1)')).toEqual([])
    expect(check('export function run(effect: () => void) { effect() }')).toEqual([])
    expect(check('const { navigate } = router\nnavigate("/")')).toEqual([])
    expect(check('items.forEach((onMount, i) => onMount(i))')).toEqual([])
  })

  it('ignores method calls, other names, and mentions that are not calls', () => {
    expect(check('store.state(0)\nthing.useRoute()')).toEqual([])
    expect(check('const x = 1\nstateful(0)\nconst label = "state(0)"\n// useRoute()')).toEqual([])
    expect(check('const a = state')).toEqual([])
  })

  it('reports nothing for an empty or garbled file, and never throws', () => {
    expect(check('')).toEqual([])
    expect(() => check('<<<>>> {{{ `')).not.toThrow()
  })
})
