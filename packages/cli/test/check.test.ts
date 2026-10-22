import { describe, expect, it } from 'vitest'
import { component, page, project, read, run, write } from './helpers'

const clean = () =>
  project({
    'app/components/Card.tess': component('Card', '.root { padding: $space.3; }'),
    'app/pages/index.tess': page(),
  })

describe('tessera check', () => {
  it('exits 0 on a clean project and says so', async () => {
    const root = clean()
    const { code, out } = await run(root, 'check')
    expect(out).toContain('0 errors, 0 warnings in 2 files.')
    expect(code).toBe(0)
  })

  it('exits 1 on seeded violations, printing each in the standard format', async () => {
    const root = project({
      'app/components/Card.tess': component('Card', '.root { padding: 13px; color: #ff0000; }'),
      'app/pages/index.tess': page(),
    })
    const { code, out } = await run(root, 'check')
    expect(code).toBe(1)
    expect(out).toMatch(/ERROR {2}T2102 {2}app\/components\/Card\.tess:\d+:\d+/)
    expect(out).toMatch(/ERROR {2}T2101 {2}app\/components\/Card\.tess/)
    expect(out).toContain('2 errors, 0 warnings in 2 files.')
  })

  it('runs the checks a build runs: contracts, route conflicts, links and layouts', async () => {
    const root = project({
      'app/components/NoContract.tess': '<template><div></div></template>',
      'app/pages/blog.tess': page(),
      'app/pages/blog/index.tess': page(),
      'app/pages/about.tess': page('<h1>About</h1>', '<page>{ "layout": "nope" }</page>\n'),
    })
    const { code, out } = await run(root, 'check')
    expect(code).toBe(1)
    expect(out).toContain('T4013')
    expect(out).toContain('Route conflict: blog.tess and blog/index.tess both map to "/blog".')
    expect(out).toContain('Unknown layout "nope".')
  })

  it('finds an auto-import used in a plain .ts file', async () => {
    const root = project({
      'app/pages/index.tess': page(),
      'app/utils/nav.ts': 'export const go = () => useRoute().path\n',
    })
    const { code, out } = await run(root, 'check')
    expect(code).toBe(1)
    expect(out).toContain('T5002')
    expect(out).toContain('app/utils/nav.ts')
  })

  it('reports tokens that do not build', async () => {
    const root = project({ 'app/pages/index.tess': page() })
    write(
      root,
      'system/tokens/base.tokens.json',
      '{ "color": { "a": { "$type": "color", "$value": "{nope}" } } }',
    )
    write(root, 'tessera.config.ts', 'export default { tokens: "system/tokens" }\n')
    const { code, out } = await run(root, 'check')
    expect(code).toBe(1)
    expect(out).toMatch(/ERROR/)
  })

  it('honors severity in tessera.config.ts: a reasoned warning does not fail', async () => {
    const root = project(
      { 'app/components/Card.tess': component('Card', '.root { padding: 13px; }') },
      `severity: [{ files: 'app/**', rules: 'T2102', level: 'warn', reason: 'legacy spacing' }]`,
    )
    const { code, out } = await run(root, 'check')
    expect(code).toBe(0)
    expect(out).toContain('0 errors, 1 warning in 1 files.')
  })

  it('prints JSON with --json', async () => {
    const root = project({
      'app/components/Card.tess': component('Card', '.root { padding: 13px; }'),
    })
    const { code, out } = await run(root, 'check', '--json')
    const json = JSON.parse(out)
    expect(code).toBe(1)
    expect(json.errors).toBe(1)
    expect(json.files[0].file).toBe('app/components/Card.tess')
    expect(json.files[0].diagnostics[0].code).toBe('T2102')
  })

  it('says so when it is not run in a project', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const empty = mkdtempSync(join(tmpdir(), 'tessera-empty-'))
    const { code, err } = await run(empty, 'check')
    expect(code).toBe(1)
    expect(err).toContain('This does not look like a Tessera project.')
  })
})

describe('tessera check --fix', () => {
  it('applies unambiguous fixes, and only those', async () => {
    const root = project({
      // 12px is exactly $space.3; 13px has no exact token, so it is suggested but not changed.
      'app/components/Card.tess': component('Card', '.root { padding: 12px; margin: 13px; }'),
    })
    const { code, out } = await run(root, 'check', '--fix')
    const source = read(root, 'app/components/Card.tess')
    expect(source).toContain('padding: $space.3;')
    expect(source).toContain('margin: 13px;')
    expect(out).toContain('Fixed 1 problem.')
    expect(code).toBe(1)
    expect(out).toContain('1 error, 0 warnings')
  })

  it('leaves a clean project untouched', async () => {
    const root = clean()
    const before = read(root, 'app/components/Card.tess')
    const { code } = await run(root, 'check', '--fix')
    expect(code).toBe(0)
    expect(read(root, 'app/components/Card.tess')).toBe(before)
  })
})

describe('the CLI itself', () => {
  it('prints help and exits non-zero for no command, zero for help', async () => {
    expect((await run('.', '')).code).toBe(1)
    const help = await run('.', 'help')
    expect(help.code).toBe(0)
    expect(help.out).toContain('check [--fix]')
  })

  it('rejects an unknown command', async () => {
    const { code, err } = await run('.', 'frobnicate')
    expect(code).toBe(1)
    expect(err).toContain('Unknown command "frobnicate".')
  })
})
