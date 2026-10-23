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

/** A project with the kitchen-sink app, its own tokens, and git. */
async function start(edit = true): Promise<Project> {
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'p-')).replaceAll('\\', '/')
  cpSync(join(repo, 'examples/kitchen-sink/app'), join(root, 'app'), {
    recursive: true,
    filter: (src) => !/(\.browser\.test\.ts|__screenshots__|seeded|\.d\.ts)/.test(src),
  })
  cpSync(join(repo, 'system/tokens'), join(root, 'system/tokens'), { recursive: true })
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

/** A DTCG export of the project's tokens as one flat folder (what a file picker gives without folders), written outside the project so writing it does not look like a change to its token files. */
function uploadFolder(p: Project): string[] {
  const files = exportTokens(loadTokenDir(join(p.root, 'system/tokens')), 'dtcg').files
  const flat = (path: string) => path.split('/').pop()!
  const dir = mkdtempSync(join(tmpdir(), 'tessera-upload-'))
  for (const f of files) {
    let content = f.content
    if (f.path === 'tessera.resolver.json') {
      content = content.replace(/"\$ref": "(?:sets|modifiers\/\w+)\/([^"]+)"/g, '"$ref": "$1"')
    }
    if (f.path === 'sets/base.tokens.json') {
      const doc = JSON.parse(content)
      doc.color.blue['300'].$value.components = [0.6137, 0.78, 0.99]
      content = JSON.stringify(doc, null, 2)
    }
    writeFileSync(join(dir, flat(f.path)), content)
  }
  return files.map((f) => join(dir, flat(f.path)))
}

describe('the system manager', () => {
  it('has no editor at all without --edit, and every write route answers 404', async () => {
    const p = await start(false)
    const page = await open(p, '#/')
    expect(await page.locator('.docs-editbar').count()).toBe(0)
    expect(await page.locator('text=Bring in tokens').count()).toBe(0)
    // The import page does not exist without write mode: the overview shows instead.
    await page.goto(page.url().split('#')[0] + '#/import')
    expect(await page.locator('text=Bring in a token export').count()).toBe(0)
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

  it('shows no import without the key, and refuses a request with a wrong key, from another origin or another host', async () => {
    const p = await start()
    const base = p.url.split('?')[0]!
    const page = await open({ ...p, url: base }, '#/import')
    expect(await page.locator('text=Bring in a token export').count()).toBe(0)
    const key = p.url.split('key=')[1]!
    const call = (headers: Record<string, string>) =>
      page.request.get(`${base}__tessera/state`, { headers }).then((r) => r.status())
    expect(await call({})).toBe(401)
    expect(await call({ 'x-tessera-key': 'nope' })).toBe(401)
    expect(await call({ 'x-tessera-key': key })).toBe(200)
    expect(await call({ 'x-tessera-key': key, origin: 'https://evil.example' })).toBe(403)
    expect(await call({ 'x-tessera-key': key, host: 'evil.example' })).toBe(403)
    // The key is not left in the address bar.
    const withKey = await open(p, '#/import')
    expect(withKey.url()).not.toContain('key=')
    expect(await withKey.locator('text=Bring in a token export').count()).toBe(1)
  }, 120_000)

  it('offers token import and export and nothing else to change: no component editor, no new-component form', async () => {
    const p = await start()
    const page = await open(p, '#/components/Button')
    expect(await page.locator('text=Edit this component').count()).toBe(0)
    expect(await page.locator('text=Add a component').count()).toBe(0)
    const nav = await page.locator('.docs-nav a').allTextContents()
    expect(nav).toContain('Bring in tokens')
    expect(nav).toContain('Export')
  }, 120_000)

  it('brings in a token export: preview, classification and notes, then save; a bad export is refused', async () => {
    const p = await start()
    const page = await open(p, '#/import')
    const paths = uploadFolder(p)
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
    // Previewing wrote nothing.
    expect(p.read('system/tokens/base.tokens.json')).not.toContain('0.6137')
    await panel.getByRole('button', { name: 'Save this change' }).click()
    await page.waitForFunction(() =>
      document.body.textContent?.includes('Last saved: Bring in the token export'),
    )
    expect(p.read('system/tokens/base.tokens.json')).toContain('0.6137')

    // A file that is not an export is refused with the importer's message, and nothing can be saved.
    const bad = join(paths[0]!, '..', 'bad.json')
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

  it('takes the last import back with Undo', async () => {
    const p = await start()
    const before = p.read('system/tokens/base.tokens.json')
    const page = await open(p, '#/import')
    await page.getByLabel('Files (choose all of them)').setInputFiles(uploadFolder(p))
    await page.getByRole('button', { name: 'Preview the import' }).click()
    await page.locator('.docs-plan').getByRole('button', { name: 'Save this change' }).click()
    await page.waitForFunction(() => document.body.textContent?.includes('Last saved'))
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.waitForFunction(
      () => !document.querySelector('.docs-editbar')?.textContent?.includes('Last saved'),
    )
    expect(p.read('system/tokens/base.tokens.json')).toBe(before)
  }, 120_000)

  it('proposes the import as a branch and a commit, and says nothing was pushed', async () => {
    const p = await start()
    const page = await open(p, '#/import')
    await page.getByLabel('Files (choose all of them)').setInputFiles(uploadFolder(p))
    await page.getByRole('button', { name: 'Preview the import' }).click()
    await page.locator('.docs-plan').getByRole('button', { name: 'Save this change' }).click()
    await page.waitForFunction(() => document.body.textContent?.includes('Last saved'))
    await page.goto(page.url().split('#')[0] + '#/changes')
    await page.getByLabel('Message for the change').fill('New blue from design')
    await page.getByRole('button', { name: /Propose this change/ }).click()
    await page.locator('[role=status]', { hasText: 'Nothing was pushed.' }).waitFor()
    expect(git(p.root, 'rev-parse', '--abbrev-ref', 'HEAD')).toMatch(
      /^tessera\/new-blue-from-design-\d{8}$/,
    )
    expect(
      git(p.root, 'show', '--name-only', '--format=%s', 'HEAD').split('\n').filter(Boolean),
    ).toEqual(['New blue from design', 'system/tokens/base.tokens.json'])
  }, 120_000)

  it('is accessible: the import page with a change panel, the changes page and the export page, in light and dark', async () => {
    const p = await start()
    const page = await open(p, '#/import')
    await page.getByLabel('Files (choose all of them)').setInputFiles(uploadFolder(p))
    await page.getByRole('button', { name: 'Preview the import' }).click()
    await page.locator('.docs-plan').waitFor()
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      expect(await axe(page), `import page, ${scheme}`).toEqual([])
      for (const hash of ['#/changes', '#/export', '#/']) {
        await page.goto(page.url().split('#')[0] + hash)
        await page.waitForSelector('.docs-main h1')
        expect(await axe(page), `${hash}, ${scheme}`).toEqual([])
        await page.goBack()
      }
    }
  }, 120_000)
})
