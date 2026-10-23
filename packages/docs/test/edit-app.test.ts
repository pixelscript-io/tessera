import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, describe, expect, it } from 'vitest'
import { exportTokens } from '@tessera/tokens'
import { loadTokenDir } from '@tessera/tokens/node'
import { serveDocs } from '../src'

// The system manager in a real browser, against throwaway projects inside the kitchen-sink folder (so the runtime
// resolves as it does for a real project). Each has its own copy of the tokens, so nothing here can touch the
// repository's design system.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-edit')
mkdirSync(scratch, { recursive: true })
const axeSource = readFileSync(
  createRequire(join(repo, 'website/package.json')).resolve('axe-core'),
  'utf8',
)

let browser: Browser | undefined
const closers: Array<() => Promise<void> | void> = []
afterAll(async () => {
  await browser?.close()
  for (const close of closers) await close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})

const TAG = [
  '<contract>',
  '{',
  '  "name": "Tag", // a small label',
  '  "role": "group",',
  '  "description": "A small label.",',
  '  "parts": ["root"],',
  '  "variants": {',
  '    "tone": ["calm", "loud"], // first value is the default',
  '    "size": ["sm", "md"]',
  '  },',
  '  "slots": { "default": "the text" }',
  '}',
  '</contract>',
  '<template><span class="root"><slot /></span></template>',
  '<style>',
  '.root { padding: $space.2; }',
  '</style>',
  '',
].join('\n')
const PAGE = '<template><main><Tag tone="loud">Beta</Tag></main></template>\n'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    stdio: 'pipe',
  })
    .toString()
    .trim()

interface Project {
  root: string
  url: string
  read(file: string): string
}

/** A project with the kitchen-sink app, a Tag component and a page that uses it, its own tokens, and git. */
async function start(edit = true): Promise<Project> {
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'p-')).replaceAll('\\', '/')
  cpSync(join(repo, 'examples/kitchen-sink/app'), join(root, 'app'), {
    recursive: true,
    filter: (src) => !/(\.browser\.test\.ts|__screenshots__|seeded|\.d\.ts)/.test(src),
  })
  cpSync(join(repo, 'system/tokens'), join(root, 'system/tokens'), { recursive: true })
  writeFileSync(join(root, 'app/components/Tag.tess'), TAG)
  writeFileSync(join(root, 'app/pages/tags.tess'), PAGE)
  writeFileSync(join(root, 'package.json'), '{ "name": "scratch-manager" }\n')
  git(root, 'init', '-b', 'main', '-q')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'start')
  const server = await serveDocs(root, { edit, port: 0 })
  closers.push(() => server.close())
  const url = edit ? server.editUrl! : server.resolvedUrls!.local[0]!
  return { root, url, read: (f) => readFileSync(join(root, f), 'utf8') }
}

async function open(p: Project, hash = '#/'): Promise<Page> {
  browser ??= await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  ;(page as Page & { errors: string[] }).errors = errors
  const [base, query = ''] = p.url.split('?')
  await page.goto(`${base}${query ? '?' + query : ''}${hash}`)
  // Generous: the whole suite runs at once, and a new project compiles on its first load.
  await page.waitForSelector('.docs-nav a', { timeout: 75_000 })
  // The first load of a new project can make Vite optimize dependencies and reload: wait for that to settle.
  await page.waitForLoadState('networkidle')
  return page
}

const fieldset = (page: Page, legend: string) =>
  page.locator('fieldset', { has: page.locator('legend', { hasText: legend }) })

async function axe(page: Page): Promise<string[]> {
  await page.evaluate(axeSource)
  const violations = (await page.evaluate(() =>
    (window as any).axe.run(document, { resultTypes: ['violations'] }).then((r: any) =>
      r.violations
        .filter((v: any) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v: any) =>
            `${v.id} (${v.impact}): ${v.nodes
              .map((n: any) => n.target.join(' '))
              .slice(0, 3)
              .join(', ')}`,
        ),
    ),
  )) as string[]
  return violations
}

describe('the system manager', () => {
  it('has no editor at all without --edit, and every write route answers 404', async () => {
    const p = await start(false)
    const page = await open(p, '#/components/Tag')
    expect(await page.locator('text=Edit this component').count()).toBe(0)
    expect(await page.locator('.docs-editbar').count()).toBe(0)
    const status = await page.evaluate(async () => (await fetch('/__tessera/state')).status)
    expect(status).toBe(404)
    const post = await page.evaluate(
      async () =>
        (
          await fetch('/__tessera/apply', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
    )
    expect(post).toBe(404)
  }, 120_000)

  it('shows no editor without the key, and refuses a request with a wrong key, from another origin or another host', async () => {
    const p = await start()
    const base = p.url.split('?')[0]!
    const page = await open({ ...p, url: base }, '#/components/Tag')
    expect(await page.locator('text=Edit this component').count()).toBe(0)
    const key = p.url.split('key=')[1]!
    const call = (headers: Record<string, string>) =>
      page.request.get(`${base}__tessera/state`, { headers }).then((r) => r.status())
    expect(await call({})).toBe(401)
    expect(await call({ 'x-tessera-key': 'nope' })).toBe(401)
    expect(await call({ 'x-tessera-key': key })).toBe(200)
    expect(await call({ 'x-tessera-key': key, origin: 'https://evil.example' })).toBe(403)
    expect(await call({ 'x-tessera-key': key, host: 'evil.example' })).toBe(403)
    // The key is not left in the address bar.
    const withKey = await open(p, '#/components/Tag')
    expect(withKey.url()).not.toContain('key=')
    expect(await withKey.locator('text=Edit this component').count()).toBe(1)
  }, 120_000)

  it('changes a description: preview shows the diff, save changes only the contract block, the page shows it', async () => {
    const p = await start()
    const page = await open(p, '#/components/Tag')
    const before = p.read('app/components/Tag.tess')
    const about = fieldset(page, 'About this component')
    await about.getByLabel('Description').fill('A label for a status.')
    await about.getByRole('button', { name: 'Preview description change' }).click()
    const panel = page.locator('.docs-plan')
    await panel.waitFor()
    expect(await panel.locator('h3').textContent()).toBe('Change the description of Tag')
    expect(await panel.locator('.docs-diff-add').first().textContent()).toContain(
      '"description": "A label for a status."',
    )
    expect(await panel.locator('.docs-diff-del').first().textContent()).toContain(
      '"description": "A small label."',
    )
    // Previewing wrote nothing.
    expect(p.read('app/components/Tag.tess')).toBe(before)
    await panel.getByRole('button', { name: 'Save this change' }).click()
    await page.waitForFunction(
      () => document.querySelector('.docs-lead')?.textContent === 'A label for a status.',
    )
    expect(p.read('app/components/Tag.tess')).toBe(
      before.replace('"A small label."', '"A label for a status."'),
    )
    expect(await page.locator('.docs-editbar').textContent()).toContain(
      'Last saved: Change the description of Tag',
    )
  }, 120_000)

  it('refuses a change that would break a use: the reason is shown and Save is disabled', async () => {
    const p = await start()
    const page = await open(p, '#/components/Tag')
    const tone = fieldset(page, 'Variant: tone')
    await tone.getByLabel('Value', { exact: true }).selectOption('loud')
    await tone.getByLabel('Do this').selectOption('remove')
    await tone.getByRole('button', { name: 'Preview change to tone' }).click()
    const panel = page.locator('.docs-plan')
    await panel.waitFor()
    expect(await panel.locator('[role=alert]').textContent()).toContain(
      'This change cannot be saved, because it would break the project',
    )
    expect(await panel.locator('[role=alert]').textContent()).toContain(
      'app/pages/tags.tess: Tag.tone has no value "loud".',
    )
    // It is also shown as breaking, so the person sees both.
    expect(await panel.locator('.docs-plan-breaking').textContent()).toContain(
      'Tag.tone lost the value "loud".',
    )
    expect(await panel.getByRole('button', { name: 'Save this change' }).isDisabled()).toBe(true)
    expect(p.read('app/components/Tag.tess')).toBe(TAG)
  }, 120_000)

  it('renames a value: the codemod updates the page in the same save, and undo puts everything back', async () => {
    const p = await start()
    const page = await open(p, '#/components/Tag')
    const tone = fieldset(page, 'Variant: tone')
    await tone.getByLabel('Value', { exact: true }).selectOption('loud')
    await tone.getByLabel('Do this').selectOption('rename')
    await tone.getByLabel('Name or message (for Rename and Deprecate)').fill('bold')
    await tone.getByRole('button', { name: 'Preview change to tone' }).click()
    const panel = page.locator('.docs-plan')
    await panel.waitFor()
    expect(await panel.textContent()).toContain('Saving also rewrites 1 use in 1 file.')
    expect(await panel.locator('summary').allTextContents()).toEqual([
      'app/components/Tag.tess',
      'app/pages/tags.tess',
    ])
    await panel.getByRole('button', { name: 'Save this change' }).click()
    await page.waitForFunction(() =>
      document.body.textContent?.includes('Last saved: Rename Tag.tone'),
    )
    expect(p.read('app/pages/tags.tess')).toContain('<Tag tone="bold">')
    expect(p.read('app/components/Tag.tess')).toContain(
      '"renamedValues": { "tone": { "loud": "bold" } }',
    )
    expect(p.read('app/components/Tag.tess')).toContain(
      '"tone": ["calm", "bold"], // first value is the default',
    )

    await page.getByRole('button', { name: 'Undo' }).click()
    await page.waitForFunction(
      () => !document.querySelector('.docs-editbar')?.textContent?.includes('Last saved'),
    )
    expect(p.read('app/pages/tags.tess')).toBe(PAGE)
    expect(p.read('app/components/Tag.tess')).toBe(TAG)
  }, 120_000)

  it('creates a component from the overview', async () => {
    const p = await start()
    const page = await open(p, '#/')
    const form = fieldset(page, 'Add a component')
    await form.getByLabel('Name (PascalCase)').fill('Panel')
    await form.getByLabel('Description').fill('A panel.')
    await form.getByRole('button', { name: 'Preview the new component' }).click()
    const panel = page.locator('.docs-plan')
    await panel.waitFor()
    expect(await panel.textContent()).toContain('Panel was added: A panel.')
    await panel.getByRole('button', { name: 'Save this change' }).click()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.docs-nav a')].some((a) => a.textContent === 'Panel'),
    )
    expect(p.read('app/components/Panel.tess')).toContain('"name": "Panel"')
  }, 120_000)

  it('brings in a token export: preview, classification and notes, then save; a bad export is refused', async () => {
    const p = await start()
    const page = await open(p, '#/import')
    // A DTCG export as one flat folder (what a file picker gives without folders): the resolver names its files plainly.
    const files = exportTokens(loadTokenDir(join(p.root, 'system/tokens')), 'dtcg').files
    const flat = (path: string) => path.split('/').pop()!
    const upload = files.map((f) => {
      let content = f.content
      if (f.path === 'tessera.resolver.json') {
        content = content.replace(/"\$ref": "(?:sets|modifiers\/\w+)\/([^"]+)"/g, '"$ref": "$1"')
      }
      if (f.path === 'sets/base.tokens.json') {
        const doc = JSON.parse(content)
        doc.color.blue['300'].$value.components = [0.6, 0.78, 0.99]
        content = JSON.stringify(doc, null, 2)
      }
      return { path: flat(f.path), content }
    })
    // Outside the project, so writing them does not look like a change to its token files.
    const dir = mkdtempSync(join(tmpdir(), 'tessera-upload-'))
    for (const f of upload) writeFileSync(join(dir, f.path), f.content)
    const paths = upload.map((f) => join(dir, f.path))
    await page.getByLabel('Files (choose all of them)').setInputFiles(paths)
    await page.getByRole('button', { name: 'Preview the import' }).click()
    const panel = page.locator('.docs-plan')
    await panel.waitFor()
    expect(await panel.locator('h3').textContent()).toBe('Bring in the token export')
    expect(await panel.innerText()).not.toContain('cannot be saved')
    expect(await panel.locator('.docs-plan-cosmetic').textContent()).toContain(
      '$color.blue.300 changed value',
    )
    expect(await panel.locator('summary').allTextContents()).toEqual([
      'system/tokens/base.tokens.json',
    ])
    await panel.getByRole('button', { name: 'Save this change' }).click()
    await page.waitForFunction(() =>
      document.body.textContent?.includes('Last saved: Bring in the token export'),
    )
    expect(p.read('system/tokens/base.tokens.json')).toContain('0.99')

    // A file that is not an export is refused with the importer's message, and nothing can be saved.
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ nope')
    await page.goto(page.url().split('#')[0] + '#/')
    await page.goto(page.url().split('#')[0] + '#/import')
    await page.getByRole('heading', { name: 'Bring in a token export' }).waitFor()
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Files (choose all of them)').setInputFiles([bad])
    await page.getByRole('button', { name: 'Preview the import' }).click()
    const refused = page.locator('.docs-plan [role=alert]')
    await refused.waitFor()
    expect(await refused.textContent()).toContain('Could not parse as JSON')
    expect(await page.getByRole('button', { name: 'Save this change' }).isDisabled()).toBe(true)
  }, 120_000)

  it('proposes the manager’s changes as a branch and a commit, and says nothing was pushed', async () => {
    const p = await start()
    const page = await open(p, '#/components/Tag')
    const about = fieldset(page, 'About this component')
    await about.getByLabel('Description').fill('Proposed wording.')
    await about.getByRole('button', { name: 'Preview description change' }).click()
    await page.locator('.docs-plan').getByRole('button', { name: 'Save this change' }).click()
    await page.waitForFunction(() => document.body.textContent?.includes('Last saved'))
    await page.goto(page.url().split('#')[0] + '#/changes')
    await page.getByLabel('Message for the change').fill('Reword the Tag')
    await page.getByRole('button', { name: /Propose this change/ }).click()
    await page.locator('[role=status]', { hasText: 'Nothing was pushed.' }).waitFor()
    expect(git(p.root, 'rev-parse', '--abbrev-ref', 'HEAD')).toMatch(
      /^tessera\/reword-the-tag-\d{8}$/,
    )
    expect(
      git(p.root, 'show', '--name-only', '--format=%s', 'HEAD').split('\n').filter(Boolean),
    ).toEqual(['Reword the Tag', 'app/components/Tag.tess'])
  }, 120_000)

  it('is accessible: the edit forms, the change panel, the import page and the changes page, in light and dark', async () => {
    const p = await start()
    const page = await open(p, '#/components/Tag')
    const about = fieldset(page, 'About this component')
    await about.getByLabel('Description').fill('Accessible wording.')
    await about.getByRole('button', { name: 'Preview description change' }).click()
    await page.locator('.docs-plan').waitFor()
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      expect(await axe(page), `component page, ${scheme}`).toEqual([])
      for (const hash of ['#/import', '#/changes', '#/']) {
        await page.goto(page.url().split('#')[0] + hash)
        await page.waitForSelector('.docs-main h1')
        expect(await axe(page), `${hash}, ${scheme}`).toEqual([])
        await page.goBack()
      }
    }
  }, 120_000)
})
