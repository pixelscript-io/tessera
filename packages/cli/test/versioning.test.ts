import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import { REPO_TOKENS } from './helpers'

const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const made: string[] = []
afterAll(() =>
  made.forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })),
)

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-versioning-')).replaceAll('\\', '/')
  made.push(dir)
  return dir
}

const write = (root: string, file: string, content: string) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), content)
}
const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')

async function run(cwd: string, ...argv: string[]) {
  let out = ''
  let err = ''
  const code = await main(argv, {
    cwd,
    out: (t) => void (out += t + '\n'),
    err: (t) => void (err += t + '\n'),
  })
  return { code, out, err }
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    stdio: 'pipe',
  }).toString()

const button = (tones: string, extra = '') => `<contract>
{
  "name": "Button",
  "role": "button",
  "parts": ["root"],
  "variants": { "tone": ${tones}, "size": ["sm", "md"] },
  "states": ["disabled"],
  "slots": { "default": "label" },
  "events": { "press": "pressed" }${extra}
}
</contract>
<template><button class="root"><slot /></button></template>
<style>
.root { padding: $space.2; }
</style>
`

const config = `export default { tokens: ${JSON.stringify(REPO_TOKENS)} }\n`

describe('tessera diff', () => {
  /** A git repository with a design system committed on main, then changed in the working tree. */
  function repoWithChange() {
    const root = scratch()
    git(root, 'init', '-b', 'main', '-q')
    write(root, 'tessera.config.ts', config)
    write(root, 'app/components/Button.tess', button('["primary", "danger"]'))
    write(root, 'app/pages/index.tess', '<template><main><Button /></main></template>\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'v1')
    return root
  }

  it('reports a removed variant value as breaking, and an added one as additive', async () => {
    const root = repoWithChange()
    write(root, 'app/components/Button.tess', button('["primary", "ghost"]'))
    const { code, out, err } = await run(root, 'diff', 'main')
    expect(code, err).toBe(0)
    expect(out).toContain('Comparing main with the working tree.')
    expect(out).toContain('BREAKING (1)')
    expect(out).toContain('  Button.tone lost the value "danger".')
    expect(out).toContain('ADDITIVE (1)')
    expect(out).toContain('  Button.tone gained the value "ghost".')
    expect(out).toContain('1 breaking, 1 additive, 0 cosmetic.')
  })

  it('compares two refs, and --fail-on-breaking makes breaking changes fail', async () => {
    const root = repoWithChange()
    write(root, 'app/components/Button.tess', button('["primary"]'))
    git(root, 'commit', '-q', '-am', 'v2')
    const clean = await run(root, 'diff', 'main', '--to', 'main')
    expect(clean.out).toContain('No changes to the design system.')
    const changed = await run(root, 'diff', 'HEAD~1', '--to', 'HEAD', '--fail-on-breaking')
    expect(changed.code).toBe(1)
    expect(changed.out).toContain('Button.tone lost the value "danger".')
  })

  it('does not touch the working tree or the index', async () => {
    const root = repoWithChange()
    write(root, 'app/components/Button.tess', button('["primary"]'))
    const before = git(root, 'status', '--porcelain')
    await run(root, 'diff', 'main')
    expect(git(root, 'status', '--porcelain')).toBe(before)
  })

  it('prints a changelog section, and JSON', async () => {
    const root = repoWithChange()
    write(root, 'app/components/Button.tess', button('["primary", "ghost"]'))
    const log = await run(root, 'diff', 'main', '--changelog', '--version', '1.1.0')
    expect(log.out).toMatch(
      /^## 1\.1\.0 \(\d{4}-\d\d-\d\d\)\n\n### Breaking changes\n\n- Button\.tone lost the value "danger"\./,
    )
    expect(log.out).toContain('### Added')
    const json = JSON.parse((await run(root, 'diff', 'main', '--json')).out)
    expect(json).toMatchObject({ from: 'main', breaking: 1, additive: 1 })
    expect(json.changes[0]).toMatchObject({ kind: 'breaking', name: 'Button.tone' })
  })

  it('flips on a token change that fails contrast', async () => {
    const root = scratch()
    const tokens = (surface: string) =>
      JSON.stringify({
        color: {
          $type: 'color',
          text: { default: { $value: { colorSpace: 'srgb', components: [0, 0, 0] } } },
          surface: {
            default: {
              $value: {
                colorSpace: 'srgb',
                components: surface === 'white' ? [1, 1, 1] : [0, 0, 0.2],
              },
            },
          },
        },
      })
    git(root, 'init', '-b', 'main', '-q')
    write(
      root,
      'tessera.config.ts',
      `export default { tokens: ${JSON.stringify(join(root, 'system/tokens'))} }\n`,
    )
    write(root, 'system/tokens/base.tokens.json', tokens('white'))
    write(root, 'app/pages/index.tess', '<template><main>Hi</main></template>\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'v1')
    write(root, 'system/tokens/base.tokens.json', tokens('navy'))
    const { out } = await run(root, 'diff', 'main')
    expect(out).toContain('BREAKING (1)')
    expect(out).toMatch(
      /Contrast of \$color\.text\.default on \$color\.surface\.default in the default theme fell from 21:1 to [\d.]+:1, below the 4\.5:1 minimum\./,
    )
  })

  it('says what to do with no ref, an unknown ref, or outside a repository', async () => {
    const root = repoWithChange()
    expect((await run(root, 'diff')).err).toContain('Say which git ref to compare with.')
    expect((await run(root, 'diff', 'nope')).err).toContain('Git does not know the ref "nope".')
    const loose = scratch()
    write(loose, 'tessera.config.ts', config)
    write(loose, 'app/pages/index.tess', '<template><main>Hi</main></template>\n')
    expect((await run(loose, 'diff', 'main')).code).toBe(1)
  })
})

describe('tessera codemod: the kitchen-sink app', () => {
  /**
   * The kitchen-sink app, with its Button renamed Action by the design system: the contract says
   * `renamedFrom: "Button"` and renames the tone value "danger" to "destructive", and the system author has not yet
   * updated the component's own styles or any use.
   */
  function renamedProject() {
    const root = scratch()
    write(root, 'tessera.config.ts', config)
    cpSync(join(repo, 'examples/kitchen-sink/app'), join(root, 'app'), {
      recursive: true,
      filter: (src) => !/(\.browser\.test\.ts|__screenshots__|seeded|\.d\.ts)/.test(src),
    })
    const original = readFileSync(join(repo, 'packages/ui/components/Button.tess'), 'utf8')
    const action = original
      .replace(
        '"name": "Button"',
        '"name": "Action",\n  "renamedFrom": "Button",\n  "renamedValues": { "tone": { "danger": "destructive" } }',
      )
      .replace(
        '"tone": ["primary", "neutral", "danger"]',
        '"tone": ["primary", "neutral", "destructive"]',
      )
    write(root, 'app/components/Action.tess', action)
    return root
  }

  it('is told by the compiler what happened, before the codemod runs', async () => {
    const root = renamedProject()
    const { out } = await run(root, 'check')
    expect(out).toContain(
      '<Button> was renamed to <Action>. Run `tessera codemod` to update every use.',
    )
    // The styles of Action itself still say danger, which is no longer a value.
    expect(out).toContain('T2114')
  })

  it('lists what it would change, and changes nothing without --write', async () => {
    const root = renamedProject()
    const before = read(root, 'app/components/ConfirmBar.tess')
    const { code, out } = await run(root, 'codemod')
    expect(code).toBe(0)
    expect(out).toContain('app/components/ConfirmBar.tess:26  component  <Button> → <Action>')
    expect(out).toContain(
      'app/components/ConfirmBar.tess:26  variant value  Action.tone="danger" → Action.tone="destructive"',
    )
    expect(out).toContain(
      'app/components/Action.tess:84  variant value  [data-tone=danger] → [data-tone=destructive]',
    )
    expect(out).toContain('Would update')
    expect(out).toContain('Run it again with --write to apply.')
    expect(read(root, 'app/components/ConfirmBar.tess')).toBe(before)
  })

  it('--write updates every use, and the project then checks clean', async () => {
    const root = renamedProject()
    const { code, out } = await run(root, 'codemod', '--write')
    expect(code).toBe(0)
    expect(out).toContain('Updated')
    const confirm = read(root, 'app/components/ConfirmBar.tess')
    expect(confirm).toContain('<Action tone="destructive" @press="confirm">Delete</Action>')
    expect(confirm).toContain(
      '<Action tone="neutral" emphasis="outline" @press="cancel">Cancel</Action>',
    )
    expect(confirm).not.toContain('Button')
    expect(read(root, 'app/components/SiteNav.tess')).toContain('<Action tone="neutral"')
    // Action's own styles follow its renamed value.
    const styles = read(root, 'app/components/Action.tess')
    expect(styles).toContain("&[data-tone='destructive']")
    expect(styles).not.toContain("[data-tone='danger']")
    // The contract that declares the rename is left alone.
    expect(styles).toContain('"renamedFrom": "Button"')

    const check = await run(root, 'check')
    expect(check.out).not.toContain('ERROR')
    expect(check.code).toBe(0)
    // Running it again has nothing to do.
    expect((await run(root, 'codemod', '--write')).out).toContain(
      'Every use is already up to date.',
    )
  })

  it('renames tokens in styles and in other token files', async () => {
    const root = scratch()
    const tokens = (extra: object) =>
      JSON.stringify({
        space: {
          $type: 'dimension',
          '2': { $value: { value: 8, unit: 'px' }, ...extra },
          big: { $value: '{space.medium}' },
        },
      })
    write(
      root,
      'tessera.config.ts',
      `export default { tokens: ${JSON.stringify(join(root, 'system/tokens'))} }\n`,
    )
    write(
      root,
      'system/tokens/base.tokens.json',
      tokens({ $extensions: { tessera: { renamedFrom: 'space.medium' } } }),
    )
    write(
      root,
      'app/components/Box.tess',
      '<contract>\n{ "name": "Box", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root"></div></template>\n<style>\n.root { padding: $space.medium; margin: $space.medium-large; }\n</style>\n',
    )
    const { out } = await run(root, 'codemod', '--write')
    expect(out).toContain('app/components/Box.tess:6  token  $space.medium → $space.2')
    expect(out).toContain('system/tokens/base.tokens.json:1  token  space.medium → space.2')
    expect(read(root, 'app/components/Box.tess')).toContain(
      'padding: $space.2; margin: $space.medium-large;',
    )
    expect(read(root, 'system/tokens/base.tokens.json')).toContain('"{space.2}"')
  })

  it('says when there is nothing to do', async () => {
    const root = scratch()
    write(root, 'tessera.config.ts', config)
    write(root, 'app/components/Box.tess', button('["a"]').replace('Button', 'Box'))
    expect((await run(root, 'codemod')).out).toContain('Nothing to do')
  })
})

describe('tessera report: what still depends on a deprecated or renamed thing', () => {
  function deprecatedProject() {
    const root = scratch()
    write(
      root,
      'tessera.config.ts',
      `export default { tokens: ${JSON.stringify(join(root, 'system/tokens'))} }\n`,
    )
    write(
      root,
      'system/tokens/base.tokens.json',
      JSON.stringify({
        space: {
          $type: 'dimension',
          '1': {
            $value: { value: 4, unit: 'px' },
            $extensions: { tessera: { deprecated: 'Use $space.2.' } },
          },
          '2': {
            $value: { value: 8, unit: 'px' },
            $extensions: { tessera: { renamedFrom: 'space.medium' } },
          },
        },
      }),
    )
    write(
      root,
      'app/components/Card.tess',
      `<contract>
{
  "name": "Card",
  "role": "group",
  "parts": ["root"],
  "variants": { "tone": ["calm", "loud", "bold"] },
  "deprecatedValues": { "tone": { "loud": "Use bold." } },
  "renamedValues": { "tone": { "shouty": "bold" } }
}
</contract>
<template><div class="root"></div></template>
<style>
.root { padding: $space.1; margin: $space.medium; }
</style>
`,
    )
    write(
      root,
      'app/pages/index.tess',
      '<template><main><Card tone="loud" /><Card tone="loud" /><Card tone="shouty" /></main></template>\n<style>\nmain { padding: $space.1; }\n</style>\n',
    )
    return root
  }

  it('lists remaining uses of deprecated variant values and tokens, and renames not applied yet', async () => {
    const root = deprecatedProject()
    const json = JSON.parse((await run(root, 'report', '--json')).out)
    expect(json.deprecatedValues).toEqual([
      {
        component: 'Card',
        variant: 'tone',
        value: 'loud',
        message: 'Use bold.',
        usages: [{ file: 'app/pages/index.tess', count: 2 }],
      },
    ])
    expect(json.deprecatedTokens).toEqual([
      {
        token: 'space.1',
        message: 'Use $space.2.',
        usages: [
          { file: 'app/components/Card.tess', count: 1 },
          { file: 'app/pages/index.tess', count: 1 },
        ],
      },
    ])
    expect(json.pendingRenames).toEqual([
      {
        kind: 'value',
        from: 'Card.tone="shouty"',
        to: 'Card.tone="bold"',
        usages: [{ file: 'app/pages/index.tess', count: 1 }],
      },
      {
        kind: 'token',
        from: 'space.medium',
        to: 'space.2',
        usages: [{ file: 'app/components/Card.tess', count: 1 }],
      },
    ])
  })

  it('prints them for a person', async () => {
    const root = deprecatedProject()
    const { out } = await run(root, 'report')
    expect(out).toContain('Deprecated variant values: 1')
    expect(out).toContain('  Card.tone "loud": Use bold.')
    expect(out).toContain('Deprecated tokens: 1')
    expect(out).toContain('  $space.1: Use $space.2.')
    expect(out).toContain('Renames not applied yet: 2 (run tessera codemod --write)')
  })

  it('the compiler warns at each use, and the codemod clears the renames', async () => {
    const root = deprecatedProject()
    const check = await run(root, 'check')
    expect(check.out).toContain('Card.tone "loud" is deprecated: Use bold.')
    expect(check.out).toContain('"$space.1" is deprecated: Use $space.2.')
    await run(root, 'codemod', '--write')
    const after = JSON.parse((await run(root, 'report', '--json')).out)
    expect(after.pendingRenames).toEqual([])
  })
})

describe('tessera codemod: a contract that does not validate', () => {
  it('says its renames were not read, instead of "nothing to do"', async () => {
    const root = scratch()
    write(root, 'tessera.config.ts', config)
    // The contract says Label, the file says Badge: T3004, so the component is not loaded.
    write(
      root,
      'app/components/Badge.tess',
      '<contract>\n{ "name": "Label", "renamedFrom": "Badge", "role": "generic", "parts": ["root"] }\n</contract>\n<template><span class="root"></span></template>\n',
    )
    write(root, 'app/pages/index.tess', '<template><main><Badge /></main></template>\n')
    const { code, out } = await run(root, 'codemod')
    expect(code).toBe(1)
    expect(out).toContain(
      'app/components/Badge.tess  SKIPPED  its contract is not valid, so the renames it declares were not read. Run `tessera check` to see why.',
    )
    expect(out).toContain('Nothing could be applied.')
    expect(out).not.toContain('Nothing to do')
    // Once the file is named for the component, the rename is found.
    mkdirSync(join(root, 'app/components'), { recursive: true })
    writeFileSync(join(root, 'app/components/Label.tess'), read(root, 'app/components/Badge.tess'))
    rmSync(join(root, 'app/components/Badge.tess'))
    const fixed = await run(root, 'codemod')
    expect(fixed.code).toBe(0)
    expect(fixed.out).toContain('app/pages/index.tess:1  component  <Badge> → <Label>')
  })
})
