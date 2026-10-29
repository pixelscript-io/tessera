import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import { VITEST_CONFIG } from '../src/commands/a11y'
import { presetFiles } from '../src/commands/init'
import type { Io } from '../src/io'

// The test `tessera figma import` writes, run for real: the Button of the Untitled UI kit is imported into a project,
// and the test that comes with it is run in a browser. Every one of the 380 variants must have the design's boxes, and
// the 47 that Figma made pictures of must look like their pictures.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const fixtures = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures/figma/button',
).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-figma-fidelity')
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }))

describe('the imported Button against the design, in a browser', () => {
  it('has the design’s boxes in all 380 variants, and looks like Figma’s pictures of 47 of them', async () => {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    mkdirSync(scratch, { recursive: true })
    writeFileSync(join(scratch, 'package.json'), '{ "name": "figma", "type": "module" }\n')
    for (const [name, content] of Object.entries(presetFiles('tailwind'))) {
      mkdirSync(dirname(join(scratch, name)), { recursive: true })
      writeFileSync(join(scratch, name), content)
    }
    // The map, with the design's font next to it.
    const map = JSON.parse(readFileSync(`${fixtures}/figma.map.json`, 'utf8'))
    map.fidelity.fonts = [{ family: 'Inter', file: `${fixtures}/fonts/Inter.woff2` }]
    writeFileSync(join(scratch, 'figma.map.json'), JSON.stringify(map, null, 2))

    const out: string[] = []
    const io: Io = { cwd: scratch, out: (t) => void out.push(t), err: (t) => void out.push(t) }
    const code = await main(
      [
        'figma',
        'import',
        '--map',
        'figma.map.json',
        '--from-json',
        `${fixtures}/button-set.json`,
        '--replace',
      ],
      io,
    )
    expect(out.join('\n')).not.toContain('F0')
    expect(code).toBe(0)
    // Figma's pictures: the command fetches them from Figma, so here they are put where it would have put them.
    cpSync(`${fixtures}/images`, join(scratch, 'system/components/figma/Button/images'), {
      recursive: true,
    })
    expect(existsSync(join(scratch, 'system/components/Button.figma.browser.test.ts'))).toBe(true)

    // The browser setup `tessera a11y` writes, with this repository's compiler and the browser that is installed.
    writeFileSync(
      join(scratch, 'vitest.config.ts'),
      VITEST_CONFIG.replace('process.env.TESSERA_A11Y_CHANNEL || undefined', "'msedge'").replace(
        "'@pixelscriptio/tessera/vite'",
        JSON.stringify(`file:///${repo}/packages/compiler/dist/vite.js`),
      ),
    )
    const report = join(scratch, 'report.json')
    const run = spawnSync(
      'npx',
      ['vitest', 'run', '--root', scratch, '--reporter=json', `--outputFile=${report}`],
      { encoding: 'utf8', shell: true, timeout: 270_000, cwd: repo },
    )
    expect(existsSync(report), run.stdout + run.stderr).toBe(true)
    const result = JSON.parse(readFileSync(report, 'utf8')) as {
      numTotalTests: number
      numPassedTests: number
      testResults: Array<{
        assertionResults: Array<{ status: string; title: string; failureMessages: string[] }>
      }>
    }
    const failed = result.testResults
      .flatMap((r) => r.assertionResults)
      .filter((a) => a.status !== 'passed')
      .map((a) => `${a.title}: ${(a.failureMessages[0] ?? '').split('\n')[0]}`)
    expect(failed).toEqual([])
    // 380 for the boxes and 47 for the pictures.
    expect(result.numTotalTests).toBe(427)
    expect(result.numPassedTests).toBe(427)
  }, 290_000)
})
