import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { checkContent, formatProblems, parseBlocks } from '../scripts/checker'

const project = new Project(
  fileURLToPath(new URL('../../examples/kitchen-sink', import.meta.url)),
  { today: '2026-10-22' },
)

const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** A docs folder with these pages. */
function docs(pages: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-docs-'))
  made.push(dir)
  for (const [name, content] of Object.entries(pages)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}

const sample = (body: string, tags = '') => `# Page\n\n\`\`\`xml tess ${tags}\n${body}\n\`\`\`\n`

const good = `<contract>
{ "name": "Card", "role": "group", "parts": ["root"] }
</contract>
<template><div class="root"><Button tone="danger">Go</Button></div></template>`

const check = (pages: Record<string, string>) => checkContent(docs(pages), { project })

describe('docs samples', () => {
  it('passes a sample that compiles, using components the project has', () => {
    expect(check({ 'a.md': sample(good) })).toEqual([])
  })

  it('fails the docs build for a deliberately broken sample, showing the real error', () => {
    const problems = check({
      'a.md': sample(good.replace('<Button', '<Buton').replace('</Button>', '</Buton>')),
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ file: 'a.md', line: 3 })
    expect(formatProblems(problems)).toContain('T4007')
    expect(formatProblems(problems)).toContain('Unknown component <Buton>.')
    expect(formatProblems(problems)).toContain('Did you mean <Button>?')
  })

  it('passes a sample that shows an error when it produces the named code, and fails when it does not', () => {
    const broken = good.replace('tone="danger"', 'tone="dangr"')
    expect(check({ 'a.md': sample(broken, 'error=T4008') })).toEqual([])
    const wrong = check({ 'a.md': sample(good, 'error=T4008') })
    expect(wrong[0]!.message).toContain('tagged error=T4008 but did not produce it')
  })

  it('compiles pages and layouts when told, and takes the file name from a file= tag', () => {
    const page =
      '<page>{ "title": "x" }</page>\n<template><main><Link to="/about">a</Link></main></template>'
    expect(check({ 'a.md': sample(page) })).toEqual([])
    const bad = page.replace('/about', '/abuot')
    expect(formatProblems(check({ 'a.md': sample(bad) }))).toContain('Unknown route "/abuot"')
    expect(
      check({ 'a.md': sample('<template><div><slot /></div></template>', 'kind=layout') }),
    ).toEqual([])
    const mismatch = good.replace('"Card"', '"Other"')
    expect(
      check({ 'a.md': sample(mismatch, 'error=T3004 file=app/components/Card.tess') }),
    ).toEqual([])
  })

  it('requires a language on every block, and xml blocks to be tagged', () => {
    const none = check({ 'a.md': '```\nhello\n```\n' })
    expect(none[0]!.message).toContain('has no language')
    const untagged = check({ 'a.md': '```xml\n<template><div></div></template>\n```\n' })
    expect(untagged[0]!.message).toContain('must be tagged `xml tess`')
    const unknown = check({ 'a.md': '```python\nx = 1\n```\n' })
    expect(unknown[0]!.message).toContain('Unknown language "python"')
  })

  it('checks that ts blocks parse and json blocks are valid', () => {
    expect(check({ 'a.md': '```ts\nconst a = 1\n```\n' })).toEqual([])
    expect(check({ 'a.md': '```ts\nconst = \n```\n' })[0]!.message).toContain('not valid syntax')
    expect(check({ 'a.md': '```json\n{ "a": 1 }\n```\n' })).toEqual([])
    expect(check({ 'a.md': '```json\n{ "a": \n```\n' })[0]!.message).toContain('not valid JSON')
    // Output and commands are not checked.
    expect(check({ 'a.md': '```text\nERROR  T1  x\n```\n```bash\nnpm i\n```\n' })).toEqual([])
  })

  it('does not treat a fence inside a longer fence as the end', () => {
    expect(parseBlocks('````text\n```ts\nx\n```\n````\n')).toHaveLength(1)
  })
})

describe('docs links', () => {
  it('passes links that resolve, with and without anchors', () => {
    expect(
      check({
        'index.md':
          '# Home\n\n[guide](/guide/a) [section](/guide/a#second-part) [same](#home) [rel](./guide/a)\n',
        'guide/a.md': '# A\n\n## Second part\n\ntext\n',
      }),
    ).toEqual([])
  })

  it('fails a broken link and a broken anchor, naming the line', () => {
    const problems = check({
      'index.md': '# Home\n\n[gone](/guide/missing)\n\n[bad](/guide/a#nope)\n',
      'guide/a.md': '# A\n',
    })
    expect(problems.map((p) => `${p.file}:${p.line} ${p.message}`)).toEqual([
      'index.md:3 Broken link: /guide/missing',
      'index.md:5 Broken anchor: /guide/a#nope',
    ])
  })

  it('ignores external links and links inside code', () => {
    expect(
      check({
        'index.md': '# Home\n\n[x](https://example.com) `[y](/nope)`\n\n```text\n[z](/nope)\n```\n',
      }),
    ).toEqual([])
  })
})

describe('components a page defines', () => {
  it('can be used by later samples on the same page, and not by other pages', () => {
    const defines =
      '```xml tess\n<contract>\n{ "name": "Tag", "role": "group", "parts": ["root"], "slots": { "default": "x" } }\n</contract>\n<template><span class="root"><slot /></span></template>\n```\n'
    const uses = '```xml tess kind=page\n<template><main><Tag>hi</Tag></main></template>\n```\n'
    expect(check({ 'a.md': `${defines}\n${uses}` })).toEqual([])
    const other = check({ 'a.md': defines, 'b.md': uses })
    expect(other.map((p) => p.file)).toEqual(['b.md'])
    expect(other[0]!.message).toContain('Unknown component <Tag>')
  })
})
