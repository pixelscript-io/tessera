import { Reporter, parseTemplate, type ElementNode, type TemplateNode } from '@tessera/compiler'

/**
 * Re-indent a template without changing a single character of content. Prettier's HTML printer cannot
 * be used here: its parser lowercases component tags (`<Button>` becomes `<button>`), treats `{expr}`
 * as plain text and reflows text, which can change how whitespace renders. This formatter only changes
 * the leading whitespace of each line (to match element nesting), strips trailing whitespace and
 * collapses runs of blank lines. Line breaks are the author's.
 *
 * Returns undefined if the template does not parse, so the caller can leave it alone.
 */
export function reindentTemplate(content: string, indentUnit: string): string | undefined {
  const report = new Reporter('', content)
  const nodes = parseTemplate(content, 0, content.length, report)
  if (report.hasErrors) return undefined

  const elements: ElementNode[] = []
  const collect = (list: TemplateNode[]) => {
    for (const node of list) {
      if (node.type !== 'element') continue
      elements.push(node)
      collect(node.children)
    }
  }
  collect(nodes)

  // Multi-line comments keep their own layout.
  const comments = [...content.matchAll(/<!--[\s\S]*?-->/g)].map(
    (m) => [m.index, m.index + m[0].length] as const,
  )
  const inComment = (offset: number) => comments.some(([s, e]) => offset > s && offset < e)

  // Multi-line `{expressions}` and text continue one level in from the line they started on.
  const lines = content.split('\n')
  const out: string[] = []
  let offset = 0
  let blank = false

  for (const line of lines) {
    const start = offset
    offset += line.length + 1
    const first = line.search(/\S/)
    if (first === -1) {
      // Collapse blank lines, and drop them at the start.
      if (out.length > 0 && !blank) out.push('')
      blank = true
      continue
    }
    blank = false

    const at = start + first
    if (inComment(at)) {
      out.push(line.replace(/\s+$/, ''))
      continue
    }

    let depth = 0
    let continuation = 0
    for (const el of elements) {
      const inContent =
        el.openEnd <= at && (el.closeStart === undefined ? !el.selfClosing : at < el.closeStart)
      if (inContent) depth++
      else if (el.start < at && at < el.openEnd) continuation = 1 // inside a multi-line opening tag
    }
    out.push(indentUnit.repeat(depth + continuation) + line.slice(first).replace(/\s+$/, ''))
  }

  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}
