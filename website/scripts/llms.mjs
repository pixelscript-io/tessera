// Turns the documentation into the two files AI tools read: `llms.txt` (an index, with a link to each page) and
// `llms-full.txt` (every page in one Markdown file). It is plain JavaScript so the package build and the docs build
// can both use it.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The pages an AI tool needs to build with Tessera, in reading order. A folder is every page in it, by name. */
const ORDER = [
  'introduction/index.md',
  'quick-start.md',
  'tutorial/',
  'reference/template-syntax.md',
  'reference/glossary.md',
  'guide/',
  'cookbook/',
]

const SKIP = new Set(['tutorial/index.md', 'guide/design-systems/index.md'])

function walk(dir, prefix = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), `${prefix}${entry.name}/`))
    else if (entry.name.endsWith('.md')) out.push(`${prefix}${entry.name}`)
  }
  return out
}

/** The pages to include, as paths under the content folder. */
export function docPages(contentDir) {
  const pages = []
  for (const item of ORDER) {
    if (item.endsWith('/')) {
      const dir = join(contentDir, item)
      if (existsSync(dir)) pages.push(...walk(dir, item).filter((p) => !SKIP.has(p)))
    } else if (existsSync(join(contentDir, item))) pages.push(item)
  }
  return [...new Set(pages)]
}

/** A page as plain Markdown: no front matter, and VitePress containers as block quotes. */
function clean(text) {
  let out = text.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '')
  out = out
    .split('\n')
    .map((line) => {
      const tip = /^:::\s*(tip|warning|danger|info|details)\s*(.*)$/.exec(line)
      if (tip) return `> **${tip[2] || tip[1]}**`
      if (/^:::\s*code-group\s*$/.test(line) || /^:::\s*$/.test(line)) return ''
      return line
    })
    .join('\n')
  return out.trim()
}

const titleOf = (text) => /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? ''

/** The first paragraph after the title that is not a note, as the one-line description of a page. */
function summaryOf(text) {
  const body = text.replace(/^#\s+.+$/m, '')
  for (const block of body.split(/\n\s*\n/)) {
    const line = block.trim().replace(/\s+/g, ' ')
    if (!line || /^(Introduced in|[#`|>:\-*0-9])/.test(line)) continue
    return line.length > 200 ? `${line.slice(0, 197).replace(/\s+\S*$/, '')}...` : line
  }
  return ''
}

/**
 * `llms.txt` and `llms-full.txt` from the documentation in `contentDir`. With `base` (the address of the docs site)
 * the index links to each page; without it the index names the section of the full file.
 */
export function buildLlms({ contentDir, version, base }) {
  const pages = docPages(contentDir).map((path) => {
    const text = clean(readFileSync(join(contentDir, path), 'utf8'))
    return { path, text, title: titleOf(text) || path, summary: summaryOf(text) }
  })
  const url = (page) => `${base}/${page.path.replace(/\.md$/, '').replace(/\/index$/, '/')}`

  const intro = [
    `Tessera${version ? ` ${version}` : ''} is a design-system-first frontend framework: components are \`.tess\` files with a contract, design tokens are checked by the compiler, and pages, data and shared state follow files and folders. Build from the components and tokens of the project, and run \`npx tessera check\` after every change.`,
  ]

  const index = [
    '# Tessera',
    '',
    `> ${intro[0]}`,
    '',
    `The whole documentation as one file: ${base ? `${base}/llms-full.txt` : 'llms-full.txt'}`,
    '',
    '## Documentation',
    '',
    ...pages.map(
      (p) => `- [${p.title}](${base ? url(p) : p.path})${p.summary ? `: ${p.summary}` : ''}`,
    ),
    '',
  ].join('\n')

  const full = [
    '# Tessera documentation',
    '',
    `> ${intro[0]}`,
    '',
    'This file is the documentation as plain Markdown, one section per page, each starting with a line `<!-- page: path -->`. A link such as `/guide/data` points to the page `guide/data.md` in this file. Every code sample here compiles.',
    '',
    ...pages.flatMap((p) => ['---', '', `<!-- page: ${p.path} -->`, '', p.text, '']),
  ].join('\n')

  return { index, full, pages: pages.map((p) => p.path) }
}
