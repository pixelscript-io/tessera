import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import ts from 'typescript'
import { Project } from '@tessera/compiler/project'
import { formatDiagnostic } from '@tessera/contract'
import { parseJsonc, JsonSyntaxError } from '@tessera/contract'

export interface Problem {
  file: string
  line: number
  message: string
}

export interface Block {
  /** 1-based line of the opening fence. */
  line: number
  lang: string
  tags: Map<string, string | true>
  code: string
}

/** Fenced blocks of a Markdown file, with the words after the language read as tags (`tess`, `error=T2102`). */
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,})(.*)$/.exec(lines[i]!)
    if (!open) continue
    const fence = open[2]!
    const info = open[3]!.trim()
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && !new RegExp(`^\\s*${fence}\\s*$`).test(lines[j]!))
      (body.push(lines[j]!), j++)
    const [lang = '', ...rest] = info.split(/\s+/).filter(Boolean)
    const tags = new Map<string, string | true>()
    for (const word of rest) {
      const [key, value] = word.split('=', 2)
      tags.set(key!, value ?? true)
    }
    blocks.push({ line: i + 1, lang, tags, code: body.join('\n') })
    i = j
  }
  return blocks
}

const ALLOWED = ['text', 'bash', 'powershell', 'ts', 'json', 'css', 'xml']

export interface CheckOptions {
  /** A project whose tokens, components, routes and layouts the samples compile against. */
  project: Project
}

/** The compile path for a sample, so its kind and contract name are what a real file's would be. */
function samplePath(project: Project, block: Block): string {
  const root = project.root.replaceAll('\\', '/')
  const explicit = block.tags.get('file')
  if (typeof explicit === 'string') return `${root}/${explicit}`
  const kind = block.tags.get('kind')
  if (kind === 'layout') return `${root}/app/layouts/DocSample.tess`
  if (kind === 'page' || (!block.code.includes('<contract>') && block.code.includes('<page>'))) {
    return `${root}/app/pages/doc-sample.tess`
  }
  const name = /"name"\s*:\s*"([A-Za-z0-9]+)"/.exec(block.code)?.[1] ?? 'DocSample'
  return `${root}/app/components/${name}.tess`
}

function checkTess(block: Block, options: CheckOptions): string[] {
  const path = samplePath(options.project, block)
  const checked = options.project.compileFile(path, block.code, { baseline: null })
  const errors = checked.raw.filter((d) => d.severity === 'error')
  const expected = block.tags.get('error')
  if (typeof expected === 'string') {
    return checked.raw.some((d) => d.code === expected)
      ? []
      : [
          `This sample is tagged error=${expected} but did not produce it. It produced: ${
            checked.raw.map((d) => d.code).join(', ') || 'no diagnostics'
          }.`,
        ]
  }
  return errors.map(
    (d) =>
      `This .tess sample does not compile (tag it error=CODE if it should fail):\n${formatDiagnostic(d)}`,
  )
}

function checkTs(block: Block): string[] {
  const source = ts.createSourceFile(
    'sample.ts',
    block.code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  )
  const diagnostics =
    (source as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics ?? []
  return diagnostics.map((d) => {
    const { line } = source.getLineAndCharacterOfPosition(d.start ?? 0)
    return `This ts sample is not valid syntax (line ${line + 1}): ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}. Tag a fragment as text.`
  })
}

function checkJson(block: Block): string[] {
  try {
    parseJsonc(block.code)
    return []
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      return [`This json sample is not valid JSON: ${error.message}. Tag a fragment as text.`]
    }
    throw error
  }
}

export function checkBlocks(file: string, markdown: string, options: CheckOptions): Problem[] {
  const problems: Problem[] = []
  // A page's samples may use components that an earlier sample on the same page defined, as a reader would.
  const extra: Array<{ file: string; source: string }> = []
  const base = options.project
  const project = new Project(base.root, { ...base.options, extraComponents: extra })
  for (const block of parseBlocks(markdown)) {
    const add = (message: string) => problems.push({ file, line: block.line, message })
    if (!block.lang) {
      add(
        `A fenced block has no language. Use one of: ${ALLOWED.join(', ')} (and tag .tess samples \`xml tess\`).`,
      )
      continue
    }
    if (!ALLOWED.includes(block.lang)) {
      add(`Unknown language "${block.lang}". Use one of: ${ALLOWED.join(', ')}.`)
      continue
    }
    if (block.lang === 'xml') {
      if (!block.tags.has('tess'))
        add('An xml block must be tagged `xml tess` so it is compiled, or use text.')
      else {
        for (const m of checkTess(block, { project })) add(m)
        if (block.code.includes('<contract>')) {
          const path = samplePath(project, block)
          const at = extra.findIndex((e) => e.file === path)
          if (at >= 0) extra.splice(at, 1)
          extra.push({ file: path, source: block.code })
          project.resetComponents()
        }
      }
    } else if (block.lang === 'ts') {
      for (const m of checkTs(block)) add(m)
    } else if (block.lang === 'json') {
      for (const m of checkJson(block)) add(m)
    }
  }
  return problems
}

// --- links ----------------------------------------------------------------------------------------------

const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

function anchorsOf(markdown: string): Set<string> {
  const out = new Set<string>()
  let fenced = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced
    const m = !fenced && /^#{1,6}\s+(.*?)\s*(\{#[^}]+\})?\s*$/.exec(line)
    if (m) out.add(slug(m[1]!.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')))
  }
  return out
}

function markdownFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '.vitepress' || name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path))
    else if (name.endsWith('.md')) out.push(path)
  }
  return out.sort()
}

function resolveLink(content: string, from: string, target: string): string | undefined {
  const base = target.startsWith('/') ? join(content, target) : resolve(dirname(from), target)
  const candidates = [base, `${base}.md`, join(base, 'index.md'), base.replace(/\/$/, '') + '.md']
  return candidates.find((c) => existsSync(c) && statSync(c).isFile() && c.endsWith('.md'))
}

export function checkLinks(content: string): Problem[] {
  const problems: Problem[] = []
  const files = markdownFiles(content)
  const anchors = new Map(files.map((f) => [f, anchorsOf(readFileSync(f, 'utf8'))]))
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const display = relative(content, file).replaceAll('\\', '/')
    let fenced = false
    text.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*```/.test(line)) fenced = !fenced
      if (fenced) return
      for (const m of line.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = m[1]!
        if (/^[a-z]+:/i.test(href) || href.startsWith('mailto:')) continue
        const [path = '', anchor] = href.split('#') as [string, string | undefined]
        const target = path === '' ? file : resolveLink(content, file, path.split('?')[0]!)
        if (!target) {
          problems.push({ file: display, line: index + 1, message: `Broken link: ${href}` })
        } else if (anchor && !anchors.get(target)?.has(anchor)) {
          problems.push({ file: display, line: index + 1, message: `Broken anchor: ${href}` })
        }
      }
    })
  }
  return problems
}

/** Check every Markdown file under a content folder: code samples, then links. */
export function checkContent(content: string, options: CheckOptions): Problem[] {
  const problems: Problem[] = []
  for (const file of markdownFiles(content)) {
    problems.push(
      ...checkBlocks(
        relative(content, file).replaceAll('\\', '/'),
        readFileSync(file, 'utf8'),
        options,
      ),
    )
  }
  problems.push(...checkLinks(content))
  return problems
}

export const formatProblems = (problems: Problem[]): string =>
  problems.map((p) => `${p.file}:${p.line}\n  ${p.message.replace(/\n/g, '\n  ')}`).join('\n\n')
