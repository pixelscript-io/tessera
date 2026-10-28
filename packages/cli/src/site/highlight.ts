const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/** A class for each kind of piece; the page's style sheet colors them. */
const KINDS = ['c', 's', 't', 'a', 'v', 'k', 'n'] as const

// One pass, first match wins at each position: comments, then strings, a tag's name, an attribute, a token reference,
// a keyword, a number. Everything else is left as it is.
const PATTERN = new RegExp(
  [
    String.raw`(<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*)`,
    String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + '`(?:[^`\\\\]|\\\\.)*`)',
    String.raw`(<\/?[A-Za-z][\w.-]*|\/?>)`,
    String.raw`([:@]?[A-Za-z_][\w-]*(?==))`,
    String.raw`(\$[A-Za-z][\w-]*(?:\.[\w-]+)+)`,
    String.raw`\b(const|let|var|import|from|export|default|function|return|if|else|new|type|interface|as|true|false|null|undefined)\b`,
    String.raw`\b(\d+(?:\.\d+)?)\b`,
  ].join('|'),
  'g',
)

/**
 * Color source code for a page: the text is escaped, and pieces are wrapped in `<span class="tk-…">`. It reads
 * `.tess` files, scripts and JSON well enough to be read, and anything else (a shell command) is only escaped.
 * Removing the tags and unescaping gives the source back exactly.
 */
export function highlight(source: string, lang: string): string {
  if (!['tess', 'html', 'ts', 'js', 'json'].includes(lang)) return escape(source)
  let out = ''
  let last = 0
  for (const match of source.matchAll(PATTERN)) {
    const kind = KINDS[match.slice(1).findIndex((g) => g !== undefined)]!
    out +=
      escape(source.slice(last, match.index)) +
      `<span class="tk-${kind}">${escape(match[0])}</span>`
    last = match.index + match[0].length
  }
  return out + escape(source.slice(last))
}
