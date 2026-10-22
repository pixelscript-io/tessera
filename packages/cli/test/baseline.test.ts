import { describe, expect, it } from 'vitest'
import { component, page, project, read, run, write } from './helpers'

/** A legacy app: components and pages full of hand-written values that Tessera would reject. */
const legacy = () =>
  project({
    'app/components/OldCard.tess': component(
      'OldCard',
      '.root { padding: 13px; margin: 9px; color: #ff0000; }',
    ),
    'app/components/OldNav.tess': component('OldNav', '.root { padding: 7px; }'),
    'app/pages/index.tess': page(),
  })

describe('adopting Tessera with tessera baseline', () => {
  it('has errors before the baseline, and zero after', async () => {
    const root = legacy()
    const before = await run(root, 'check')
    expect(before.code).toBe(1)
    expect(before.out).toContain('4 errors')

    const made = await run(root, 'baseline')
    expect(made.code).toBe(0)
    expect(made.out).toContain(
      'Recorded 4 existing violations in 2 files in tessera.baseline.json.',
    )

    const after = await run(root, 'check')
    expect(after.code).toBe(0)
    expect(after.out).toContain('0 errors, 0 warnings')
    expect(after.out).toContain('4 existing violations are covered by the baseline.')
  })

  it('writes a committed, sorted file of per-file, per-rule counts', async () => {
    const root = legacy()
    await run(root, 'baseline')
    expect(JSON.parse(read(root, 'tessera.baseline.json'))).toEqual({
      version: 1,
      files: {
        'app/components/OldCard.tess': { T2101: 1, T2102: 2 },
        'app/components/OldNav.tess': { T2102: 1 },
      },
    })
  })

  it('fails on one new violation, wherever it is', async () => {
    const root = legacy()
    await run(root, 'baseline')

    // One more in a file that already has some.
    write(
      root,
      'app/components/OldNav.tess',
      component('OldNav', '.root { padding: 7px; margin: 5px; }'),
    )
    const worse = await run(root, 'check')
    expect(worse.code).toBe(1)
    expect(worse.out).toContain('1 error,')

    // And in a file that had none.
    write(root, 'app/components/OldNav.tess', component('OldNav', '.root { padding: 7px; }'))
    write(root, 'app/components/Fresh.tess', component('Fresh', '.root { padding: 5px; }'))
    const fresh = await run(root, 'check')
    expect(fresh.code).toBe(1)
    expect(fresh.out).toContain('app/components/Fresh.tess')
  })

  it('never baselines contract errors', async () => {
    const root = project({
      'app/components/NoContract.tess': '<template><div></div></template>',
      'app/pages/index.tess': page(),
    })
    await run(root, 'baseline')
    const { code, out } = await run(root, 'check')
    expect(code).toBe(1)
    expect(out).toContain('T4013')
  })

  it('only lets counts go down: fixing a violation leaves room that --prune takes back', async () => {
    const root = legacy()
    await run(root, 'baseline')
    write(root, 'app/components/OldNav.tess', component('OldNav', '.root { padding: $space.2; }'))

    const noted = await run(root, 'check')
    expect(noted.code).toBe(0)
    expect(noted.out).toContain('The baseline can be lowered: run `tessera baseline --prune`.')

    const pruned = await run(root, 'baseline', '--prune')
    expect(pruned.out).toContain('Pruned the baseline from 4 to 3 violations.')
    expect(JSON.parse(read(root, 'tessera.baseline.json')).files).not.toHaveProperty(
      'app/components/OldNav.tess',
    )

    // Pruned: a violation added back in OldNav now fails.
    write(root, 'app/components/OldNav.tess', component('OldNav', '.root { padding: 7px; }'))
    expect((await run(root, 'check')).code).toBe(1)
  })

  it('does not raise counts when pruning', async () => {
    const root = legacy()
    await run(root, 'baseline')
    write(
      root,
      'app/components/OldNav.tess',
      component('OldNav', '.root { padding: 7px; margin: 5px; }'),
    )
    await run(root, 'baseline', '--prune')
    expect(
      JSON.parse(read(root, 'tessera.baseline.json')).files['app/components/OldNav.tess'],
    ).toEqual({
      T2102: 1,
    })
  })

  it('says what to do when there is nothing to prune', async () => {
    const root = legacy()
    const { code, err } = await run(root, 'baseline', '--prune')
    expect(code).toBe(1)
    expect(err).toContain('There is no baseline to prune.')
  })

  it('does not record what a reasoned exemption already covers', async () => {
    const root = project(
      { 'app/components/OldCard.tess': component('OldCard', '.root { padding: 13px; }') },
      `severity: [{ files: 'app/**', rules: 'T2102', level: 'warn', reason: 'legacy' }]`,
    )
    const { out } = await run(root, 'baseline')
    expect(out).toContain('Recorded 0 existing violations in 0 files')
  })
})
