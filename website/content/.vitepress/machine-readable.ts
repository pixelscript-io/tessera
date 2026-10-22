import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

/** Every Markdown page under the source folder, as paths relative to it with forward slashes. */
function pages(dir: string, root = dir): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '.vitepress' || name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...pages(path, root))
    else if (name.endsWith('.md')) out.push(relative(root, path).replaceAll('\\', '/'))
  }
  return out.sort()
}

/** Title (the first heading) and summary (the first paragraph) of a page, as plain text. */
function summarize(markdown: string): { title: string; summary: string } {
  const body = markdown.replace(/^---[\s\S]*?---\n/, '').replace(/<!--[\s\S]*?-->\n?/g, '')
  // A page with no heading (the home page) is titled by its hero in the front matter.
  const title =
    /^#\s+(.*)$/m.exec(body)?.[1]?.replace(/`/g, '') ??
    /^\s+name:\s*(.*)$/m.exec(markdown)?.[1] ??
    ''
  const paragraph = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find(
      (p) =>
        p && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('|') && !p.startsWith('<'),
    )
  const summary = (paragraph ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
  return { title, summary }
}

/**
 * Machine-readable output, consistent with how agents read a project: every page as Markdown beside its HTML
 * (`/guide/cli.md` next to `/guide/cli`), and `llms.txt`, an index of them with a one-line summary each.
 * Links are relative to the site root because there is no public address yet.
 */
export function writeMachineReadable(srcDir: string, outDir: string): void {
  const files = pages(srcDir)
  const lines = [
    '# Tessera',
    '',
    '> A design-system-first frontend framework: tokens, accessibility, variants and docs are built in and enforced at compile time. Status: early development; packages are not published yet.',
    '',
    'Every page below is available as Markdown at the path shown.',
    '',
  ]
  const sections = new Map<string, string[]>()
  for (const file of files) {
    const source = readFileSync(join(srcDir, file), 'utf8')
    const target = join(outDir, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, source.replace(/^<!-- Generated[^\n]*-->\n\n?/, ''))
    const { title, summary } = summarize(source)
    const section = file.includes('/') ? file.split('/')[0]! : 'start'
    const entry = `- [${title || file}](/${file})${summary ? `: ${summary.slice(0, 160)}` : ''}`
    sections.set(section, [...(sections.get(section) ?? []), entry])
  }
  const order = [
    'start',
    'introduction',
    'tutorial',
    'guide',
    'how-it-works',
    'reference',
    'cookbook',
    'migration',
    'examples',
    'releases',
    'community',
  ]
  for (const section of order) {
    const entries = sections.get(section)
    if (!entries) continue
    lines.push(
      `## ${section === 'start' ? 'Start here' : section.replace(/-/g, ' ')}`,
      '',
      ...entries,
      '',
    )
  }
  writeFileSync(join(outDir, 'llms.txt'), lines.join('\n'))
}
