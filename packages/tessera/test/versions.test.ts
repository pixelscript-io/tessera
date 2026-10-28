import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../../cli/src/version'

// The versioning rules (SPEC.md, "Versioning"): the framework and the project starter share one number, the component
// catalogue is not a package and has none, and the number is 0.MINOR.PATCH with a minor that may pass 9.
const read = (path: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')) as {
    version: string
    peerDependencies?: Record<string, string>
  }

const tessera = read('../package.json')
const ui = read('../../ui/package.json') as { version: string; private?: boolean }
const create = read('../../create-tessera/package.json')

describe('versions', () => {
  it('are one number for the framework and the project starter', () => {
    expect(create.version).toBe(tessera.version)
  })

  it('are the number the command line reports', () => {
    expect(VERSION).toBe(tessera.version)
  })

  it('are the number the Releases page and the home page name, and the page has a Breaking entry for its minor', () => {
    const page = (path: string) =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    const releases = page('../../../website/content/releases/index.md')
    expect(releases).toContain(`The current release is ${tessera.version};`)
    // The release that began this minor says what broke; a patch after it has an entry of its own.
    const minor = tessera.version.replace(/\.\d+$/, '.0').replaceAll('.', '\\.')
    expect(releases).toMatch(new RegExp(`\\*\\*${minor}: [^\\n]*\\n\\n  \\*\\*Breaking:\\*\\*`))
    expect(releases).toContain(`- **${tessera.version}: `)
    const home = page('../../../website/content/index.md')
    expect(home).toContain(`\`@pixelscriptio/tessera\` ${tessera.version} is on npm`)
  })

  it('say that two packages share the number, since the catalogue is not a package', () => {
    const releases = readFileSync(
      fileURLToPath(new URL('../../../website/content/releases/index.md', import.meta.url)),
      'utf8',
    )
    const rule = releases.slice(releases.indexOf('## Versioning'))
    expect(rule).toContain('The two packages move together')
    expect(rule).not.toContain('`@pixelscriptio/tessera-ui` and')
  })

  it('are 0.MINOR.PATCH: Tessera has not declared 1.0, and a minor may be 10 or more', () => {
    expect(tessera.version).toMatch(/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  })

  it('leave the component catalogue out: it is private, so it cannot be published or take part', () => {
    expect(ui.private).toBe(true)
  })

  it('cannot reach 1.0 by publishing: every published package checks its version first, and 1.0.0 fails the check', () => {
    for (const path of ['../package.json', '../../create-tessera/package.json']) {
      const scripts = (read(path) as { scripts?: Record<string, string> }).scripts
      expect(scripts?.prepublishOnly).toBe('node ../../scripts/check-version.mjs')
    }
    const script = fileURLToPath(new URL('../../../scripts/check-version.mjs', import.meta.url))
    const run = (version: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'tessera-version-'))
      try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version }))
        return spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    for (const ok of ['0.9.0', '0.10.0', '0.100.3']) expect(run(ok).status).toBe(0)
    for (const bad of ['1.0.0', '1.0.0-rc.1', '2.1.0', '0.9', '00.1.0']) {
      const result = run(bad)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('until the author declares 1.0')
    }
  })

  it('cannot be published with npm while a dependency is a workspace: range, which only pnpm rewrites', () => {
    const script = fileURLToPath(new URL('../../../scripts/check-version.mjs', import.meta.url))
    const run = (agent: string, dependencies: Record<string, string>) => {
      const dir = mkdtempSync(join(tmpdir(), 'tessera-workspace-'))
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({ name: 'x', version: '0.9.1', dependencies }),
        )
        return spawnSync(process.execPath, [script], {
          cwd: dir,
          encoding: 'utf8',
          // Without the user agent of whatever started this test, in any letter case (Windows has no case in names).
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(([key]) => !/^npm_config_user_agent$/i.test(key)),
            ),
            npm_config_user_agent: agent,
          },
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    const npm = 'npm/10.9.0 node/v24.22.0 win32 x64 workspaces/false'
    const pnpm = 'pnpm/10.34.7 npm/? node/v24.22.0 win32 x64'
    const refused = run(npm, { '@pixelscriptio/tessera': 'workspace:*' })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('pnpm publish')
    expect(run(pnpm, { '@pixelscriptio/tessera': 'workspace:*' }).status).toBe(0)
    expect(run(npm, { acorn: '^8.14.0' }).status).toBe(0)
  })

  it('compare as numbers: 0.10.0 is after 0.9.0', () => {
    const order = ['0.9.0', '0.10.0', '0.2.0', '0.1.0'].sort((a, b) => {
      const [x, y] = [a, b].map((v) => v.split('.').map(Number))
      return x![0]! - y![0]! || x![1]! - y![1]! || x![2]! - y![2]!
    })
    expect(order).toEqual(['0.1.0', '0.2.0', '0.9.0', '0.10.0'])
  })
})
