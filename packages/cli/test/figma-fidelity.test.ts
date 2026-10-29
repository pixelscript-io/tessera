import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import { VITEST_CONFIG } from '../src/commands/a11y'
import { presetFiles } from '../src/commands/init'
import type { Io } from '../src/io'

// The test `tessera figma import` writes, run for real: a component of the Untitled UI kit is imported into a project,
// and the test that comes with it is run in a browser, with the accessibility tests generated from its contract.
//  - The Button: all 380 variants must have the design's boxes, and the 47 that Figma made pictures of must look like
//    their pictures.
//  - The Badge (a label in a row, not a button): all 144 variants of the part of the set kept as a fixture must have the
//    design's boxes.
// The design has one theme, so the generated accessibility tests fail in dark mode for the components with no fill. That
// is the only failure allowed.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/figma').replaceAll(
  '\\',
  '/',
)
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-figma-fidelity')
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }))

interface Result {
  fullName: string
  title: string
  status: string
  failureMessages: string[]
}

/** Imports a fixture into a new project and runs the project's browser tests; returns every test with its result. */
async function importAndRun(folder: string, withPictures: boolean): Promise<Result[]> {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  mkdirSync(scratch, { recursive: true })
  writeFileSync(join(scratch, 'package.json'), '{ "name": "figma", "type": "module" }\n')
  for (const [name, content] of Object.entries(presetFiles('tailwind'))) {
    mkdirSync(dirname(join(scratch, name)), { recursive: true })
    writeFileSync(join(scratch, name), content)
  }
  // The map the import would work out, with the design's font next to it (the design is set in Inter).
  const map = JSON.parse(readFileSync(`${fixtures}/${folder}/figma.map.json`, 'utf8'))
  map.fidelity.fonts = [{ family: 'Inter', file: `${fixtures}/button/fonts/Inter.woff2` }]
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
      `${fixtures}/${folder}/button-set.json`,
      '--replace',
    ],
    io,
  )
  expect(out.join('\n')).not.toContain('F0')
  expect(code).toBe(0)
  // Figma's pictures: the command fetches them from Figma, so here they are put where it would have put them.
  if (withPictures)
    cpSync(
      `${fixtures}/${folder}/images`,
      join(scratch, `system/components/figma/${map.name}/images`),
      { recursive: true },
    )
  expect(existsSync(join(scratch, `system/components/${map.name}.figma.browser.test.ts`))).toBe(
    true,
  )

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
    testResults: Array<{ assertionResults: Result[] }>
  }
  return result.testResults.flatMap((r) => r.assertionResults)
}

/** What fails in the accessibility suite: only dark mode, and only where the component has no fill of its own. */
const unexpected = (all: Result[], against: string, fillless: RegExp): string[] =>
  all
    .filter((a) => a.status !== 'passed' && !a.fullName.startsWith(against))
    .map((a) => a.fullName)
    .filter((name) => !(/ dark /.test(name) && fillless.test(name)))

describe('an imported component against the design, in a browser', () => {
  it('the Button has the design’s boxes in all 380 variants, and looks like Figma’s pictures of 47 of them', async () => {
    const all = await importAndRun('button', true)
    const design = all.filter((a) => a.fullName.startsWith('Button against the design'))
    expect(design).toHaveLength(427)
    expect(
      design.filter((a) => a.status !== 'passed').map((a) => `${a.title}: ${a.failureMessages[0]}`),
    ).toEqual([])
    // The four hierarchies with no fill (tertiary and link) fail contrast in dark mode: nothing else, nothing in light.
    expect(unexpected(all, 'Button against the design', /hierarchy=(tertiary|link)-/)).toEqual([])
    expect(all.filter((a) => a.status === 'passed').length).toBeGreaterThan(1000)
  }, 290_000)

  it('the Badge, a label in a row and not a button, has the design’s boxes in all 144 variants', async () => {
    const all = await importAndRun('badge', false)
    const design = all.filter((a) => a.fullName.startsWith('Badge against the design'))
    expect(design).toHaveLength(144)
    expect(
      design.filter((a) => a.status !== 'passed').map((a) => `${a.title}: ${a.failureMessages[0]}`),
    ).toEqual([])
    // The outline badges have no fill: their dark text sits on the page in dark mode.
    expect(unexpected(all, 'Badge against the design', /type=pill-outline/)).toEqual([])
    expect(all.filter((a) => a.status === 'passed').length).toBeGreaterThan(500)
  }, 290_000)
})
