import type { Reporter } from './diagnostics'

export type BlockName = 'contract' | 'script' | 'template' | 'style' | 'page'

export interface Block {
  name: BlockName
  attrs: Record<string, string>
  content: string
  /** Offset in the file where the content starts. */
  contentStart: number
  /** Offset where the opening tag starts. */
  start: number
}

const BLOCKS: readonly string[] = ['contract', 'script', 'template', 'style', 'page']

/** Split a `.tess` file into its top-level blocks, keeping each block's offset in the file. */
export function parseSfc(source: string, report: Reporter): Map<BlockName, Block> {
  const blocks = new Map<BlockName, Block>()
  let i = 0

  while (i < source.length) {
    const c = source[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4)
      i = close === -1 ? source.length : close + 3
      continue
    }
    if (c !== '<') {
      const end = source.indexOf('<', i)
      report.error(
        'T4001',
        i,
        'Unexpected content outside of a block. A .tess file contains only <contract>, <script>, <template>, <style> and <page> blocks.',
      )
      i = end === -1 ? source.length : end
      continue
    }

    const open = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(source.slice(i))
    if (!open) {
      report.error('T4001', i, 'Unexpected "<" outside of a block.')
      i++
      continue
    }
    const name = open[1]!
    const tagEnd = findTagEnd(source, i + open[0].length)
    if (tagEnd === -1) {
      report.error('T4001', i, `The <${name}> tag is never closed with ">".`)
      return blocks
    }
    const attrs = parseBlockAttrs(source.slice(i + open[0].length, tagEnd))
    const contentStart = tagEnd + 1
    const closeTag = findClose(source, name, contentStart)
    if (closeTag === -1) {
      report.error('T4001', i, `The <${name}> block is never closed. Add </${name}>.`)
      return blocks
    }

    if (!BLOCKS.includes(name)) {
      report.error(
        'T4001',
        i,
        `Unknown block <${name}>. A .tess file contains only <contract>, <script>, <template>, <style> and <page> blocks.`,
      )
    } else if (blocks.has(name as BlockName)) {
      report.error('T4001', i, `Duplicate <${name}> block. A file can have only one.`)
    } else {
      blocks.set(name as BlockName, {
        name: name as BlockName,
        attrs,
        content: source.slice(contentStart, closeTag),
        contentStart,
        start: i,
      })
    }
    i = closeTag + `</${name}>`.length
  }
  return blocks
}

function findTagEnd(source: string, from: number): number {
  let quote: string | null = null
  for (let i = from; i < source.length; i++) {
    const c = source[i]!
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '>') return i
  }
  return -1
}

/** Index of the matching `</name>`. Nested same-name tags are counted, so <template> may appear inside <template>. */
function findClose(source: string, name: string, from: number): number {
  const open = new RegExp(String.raw`<${name}(?=[\s>/])`, 'g')
  const close = `</${name}>`
  let depth = 1
  let i = from
  while (i < source.length) {
    const nextClose = source.indexOf(close, i)
    if (nextClose === -1) return -1
    open.lastIndex = i
    const nextOpen = name === 'template' ? open.exec(source) : null
    if (nextOpen && nextOpen.index < nextClose) {
      depth++
      i = nextOpen.index + nextOpen[0].length
    } else {
      depth--
      if (depth === 0) return nextClose
      i = nextClose + close.length
    }
  }
  return -1
}

function parseBlockAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of text.matchAll(
    /([A-Za-z:_-][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
  )) {
    attrs[m[1]!] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}
