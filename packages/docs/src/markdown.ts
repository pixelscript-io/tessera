/**
 * A small Markdown renderer for `Button.docs.md`: headings, paragraphs, lists, block quotes, fenced code, and
 * inline code, emphasis, strong and links. It escapes everything first, so prose can never inject markup, and
 * it has no dependencies. A fenced block whose info string is `tess live` is not shown as code only: it becomes
 * a placeholder the docs app fills with the running example, and is returned in `live`.
 */
export interface RenderedMarkdown {
  html: string
  /** The `tess live` blocks, in order. The html has `<div data-live="N">` where block N goes. */
  live: Array<{ source: string }>
}

const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/** Only links that go somewhere safe: a relative link, an anchor, or http, https and mailto. */
const safeHref = (href: string): boolean =>
  /^(https?:|mailto:|#|\/|\.{0,2}\/|[\w-]+(\/|\.|$))/i.test(href) &&
  !/^\s*(javascript|data|vbscript):/i.test(href)

/** A private-use character that stands in for inline code while the rest of the line is escaped. */
const HOLE = String.fromCharCode(0xe000)

function inline(text: string): string {
  const codes: string[] = []
  // Inline code first, so nothing inside it is touched.
  let out = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${escape(code)}</code>`)
    return `${HOLE}${codes.length - 1}${HOLE}`
  })
  out = escape(out)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, href: string) => {
    const raw = href.replaceAll('&amp;', '&')
    return safeHref(raw) ? `<a href="${escape(raw)}">${label}</a>` : m
  })
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  return out.replace(new RegExp(`${HOLE}(\\d+)${HOLE}`, 'g'), (_, i: string) => codes[Number(i)]!)
}

export function renderMarkdown(source: string): RenderedMarkdown {
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  const html: string[] = []
  const live: RenderedMarkdown['live'] = []
  let i = 0

  const startsBlock = (line: string) => /^(#{1,6}\s|```|>\s?|\s*[-*]\s+|\s*\d+\.\s+)/.test(line)

  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }

    const fence = /^```\s*(.*)$/.exec(line)
    if (fence) {
      const info = fence[1]!.trim()
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) body.push(lines[i++]!)
      i++
      const code = body.join('\n')
      if (/^tess\s+live\b/.test(info)) {
        html.push(`<div class="docs-live" data-live="${live.length}"></div>`)
        live.push({ source: code })
        html.push(
          `<details><summary>Source</summary><pre><code>${escape(code)}</code></pre></details>`,
        )
      } else {
        const lang = info.split(/\s+/)[0]
        html.push(
          `<pre><code${lang ? ` class="language-${escape(lang)}"` : ''}>${escape(code)}</code></pre>`,
        )
      }
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      html.push(`<h${level}>${inline(heading[2]!.trim())}</h${level}>`)
      i++
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!))
        quote.push(lines[i++]!.replace(/^>\s?/, ''))
      html.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`)
      continue
    }

    const list = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line)
    if (list) {
      const ordered = /\d/.test(list[2]!)
      const items: string[] = []
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]!)
        if (!m || /\d/.test(m[2]!) !== ordered) break
        const item = [m[3]!]
        i++
        // A continuation line is indented and not a new item.
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]!) &&
          !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i]!)
        ) {
          item.push(lines[i++]!.trim())
        }
        items.push(`<li>${inline(item.join(' '))}</li>`)
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }

    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      (paragraph.length === 0 || !startsBlock(lines[i]!))
    ) {
      paragraph.push(lines[i++]!.trim())
    }
    html.push(`<p>${inline(paragraph.join(' '))}</p>`)
  }
  return { html: html.join('\n'), live }
}
