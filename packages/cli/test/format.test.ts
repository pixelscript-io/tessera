import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import { REPO_TOKENS, project as tmpProject, run } from './helpers'

// A project inside the repository can find the repository's Prettier, as a real project finds its own.
const scratch = join(fileURLToPath(new URL('..', import.meta.url)), '.format-test')
mkdirSync(scratch, { recursive: true })
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }))

const MESSY = `<contract>
{"name":"Card","role":"group","parts":["root"]}
</contract>
<template>
      <div class="root">
<Button>Save</Button>
          </div>
</template>
<style>
.root{padding:$space.4;color:$color.text.default}
</style>
`

function project(files: Record<string, string>) {
  const root = mkdtempSync(join(scratch, 'p-')).replaceAll('\\', '/')
  const all = {
    'package.json': '{ "name": "scratch", "type": "module" }\n',
    'tessera.config.ts': `export default { tokens: ${JSON.stringify(REPO_TOKENS)} }\n`,
    ...files,
  }
  for (const [name, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return root
}

describe('tessera format', () => {
  it('--check lists files that are not formatted and exits 1, without changing them', async () => {
    const root = project({ 'app/components/Card.tess': MESSY })
    const { code, out } = await run(root, 'format', '--check')
    expect(code).toBe(1)
    expect(out).toContain('app/components/Card.tess')
    expect(out).toMatch(/\d+ files? (is|are) not formatted\. Run tessera format\./)
    expect(readFileSync(join(root, 'app/components/Card.tess'), 'utf8')).toBe(MESSY)
  })

  it('formats each block with the right tool, keeps component tags as written, and is idempotent', async () => {
    const root = project({ 'app/components/Card.tess': MESSY })
    const { code, out } = await run(root, 'format')
    expect(code).toBe(0)
    expect(out).toMatch(/Formatted 1 of \d+ files\./)
    const text = readFileSync(join(root, 'app/components/Card.tess'), 'utf8')
    expect(text).toContain('"name": "Card"')
    expect(text).toContain('<Button>Save</Button>')
    expect(text).toContain('padding: $space.4;')
    expect(text).not.toContain('{"name"')
    expect((await run(root, 'format', '--check')).out).toMatch(/All \d+ files are formatted\./)
    expect((await run(root, 'format')).out).toMatch(/All \d+ files were already formatted\./)
  })

  it('formats only the files it is given', async () => {
    const root = project({
      'app/components/Card.tess': MESSY,
      'app/components/Other.tess': MESSY.replace('Card', 'Other'),
    })
    await run(root, 'format', 'app/components/Card.tess')
    expect(readFileSync(join(root, 'app/components/Other.tess'), 'utf8')).toContain('{"name"')
  })

  it('says how to install Prettier when the project has none', async () => {
    // A throwaway folder outside the repository cannot find a Prettier.
    const root = tmpProject({ 'app/components/Card.tess': MESSY })
    const { code, err } = await run(root, 'format')
    expect(code).toBe(1)
    expect(err).toContain('Prettier is not installed in this project.')
    expect(err).toContain('npm install --save-dev prettier')
  })
})

describe('tessera format --stdin-filepath', () => {
  it('formats a buffer from standard input to standard output, for an editor’s external formatter', async () => {
    const root = project({})
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let out = ''
    stdout.on('data', (d) => (out += d))
    stdin.end(MESSY)
    const code = await main(['format', '--stdin-filepath', 'app/components/Card.tess'], {
      cwd: root,
      stdin,
      stdout,
      out: () => {},
      err: () => {},
    })
    expect(code).toBe(0)
    expect(out).toContain('"name": "Card"')
    expect(out).toContain('<Button>Save</Button>')
    expect(out).not.toContain('{"name"')
  })

  it('passes a file that is not .tess through unchanged', async () => {
    const root = project({})
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let out = ''
    stdout.on('data', (d) => (out += d))
    stdin.end('<p   >hi</p>')
    await main(['format', '--stdin-filepath', 'index.html'], {
      cwd: root,
      stdin,
      stdout,
      out: () => {},
      err: () => {},
    })
    expect(out).toBe('<p   >hi</p>')
  })
})
