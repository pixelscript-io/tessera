import type { AstPath, Doc, Options, Parser, Plugin, Printer, SupportLanguage } from 'prettier'
import { doc } from 'prettier'
import { parseSfc } from '@tessera/compiler'
import { reindentTemplate } from './template-indent'

const { hardline, join } = doc.builders

type BlockName = 'contract' | 'script' | 'template' | 'style' | 'page'

interface BlockNode {
  type: 'block'
  name: BlockName
  /** Raw text of the opening tag's attributes, such as ` lang="ts"`. */
  attrs: string
  content: string
  start: number
  end: number
}

interface CommentNode {
  type: 'comment'
  text: string
  start: number
  end: number
}

interface RootNode {
  type: 'root'
  children: Array<BlockNode | CommentNode>
  text: string
}

type TessNode = RootNode | BlockNode | CommentNode

const PARSER_FOR: Record<Exclude<BlockName, 'template'>, string> = {
  contract: 'jsonc',
  page: 'jsonc',
  script: 'typescript',
  style: 'css',
}

const languages: SupportLanguage[] = [
  {
    name: 'Tessera',
    parsers: ['tess'],
    extensions: ['.tess'],
    vscodeLanguageIds: ['tess'],
  },
]

const silent = { error() {}, warn() {}, diagnostics: [], hasErrors: false } as never

function parse(text: string): RootNode {
  const blocks = parseSfc(text, silent)
  const children: Array<BlockNode | CommentNode> = []

  for (const block of blocks.values()) {
    const openEnd = block.contentStart
    const attrs = /^<[A-Za-z]+([^>]*)>/.exec(text.slice(block.start, openEnd))?.[1] ?? ''
    children.push({
      type: 'block',
      name: block.name,
      attrs,
      content: block.content,
      start: block.start,
      end: openEnd + block.content.length + `</${block.name}>`.length,
    })
  }
  // Top-level HTML comments keep their place between blocks.
  for (const match of text.matchAll(/<!--[\s\S]*?-->/g)) {
    const start = match.index
    if (children.some((c) => c.type === 'block' && start >= c.start && start < c.end)) continue
    children.push({ type: 'comment', text: match[0], start, end: start + match[0].length })
  }
  children.sort((a, b) => a.start - b.start)
  return { type: 'root', children, text }
}

const tessParser: Parser<TessNode> = {
  astFormat: 'tess-ast',
  parse: (text) => parse(text),
  locStart: (node) => (node.type === 'root' ? 0 : node.start),
  locEnd: (node) => (node.type === 'root' ? node.text.length : node.end),
}

const tessPrinter: Printer<TessNode> = {
  print(path: AstPath<TessNode>, _options: Options, print: (path: AstPath<TessNode>) => Doc): Doc {
    const node = path.node
    if (node.type === 'root') {
      // One blank line between blocks. A file that is not valid enough to split is left alone.
      if (node.children.length === 0) return node.text
      return [join([hardline, hardline], path.map(print, 'children')), hardline]
    }
    if (node.type === 'comment') return node.text
    // Blocks with embedded languages are printed by `embed`; this is the fallback.
    return [`<${node.name}${node.attrs}>`, node.content, `</${node.name}>`]
  },

  embed(path: AstPath<TessNode>, options: Options) {
    const node = path.node
    if (node.type !== 'block') return null
    return async (textToDoc: (text: string, options: Options) => Promise<Doc>): Promise<Doc> => {
      const open = `<${node.name}${node.attrs}>`
      const close = `</${node.name}>`
      if (node.content.trim() === '') return [open, close]

      if (node.name === 'template') {
        const unit = options.useTabs ? '\t' : ' '.repeat(options.tabWidth ?? 2)
        const lines = reindentTemplate(node.content, unit)
        // A template that does not parse is left exactly as written.
        if (lines === undefined) return [open, node.content, close]
        const body = lines.split('\n').map((line) => (line ? unit + line : line))
        return [open, hardline, join(hardline, body), hardline, close]
      }

      try {
        const body = await textToDoc(node.content, {
          parser: PARSER_FOR[node.name],
          ...(node.name === 'contract' || node.name === 'page'
            ? { trailingComma: 'none' as const }
            : {}),
        })
        return [open, hardline, body, hardline, close]
      } catch {
        // The block does not parse (for example half-typed code); keep it exactly as written.
        return [open, node.content, close]
      }
    }
  },
}

const plugin: Plugin<TessNode> = {
  languages,
  parsers: { tess: tessParser },
  printers: { 'tess-ast': tessPrinter },
}

export const { parsers, printers } = plugin
export { languages }
export default plugin
