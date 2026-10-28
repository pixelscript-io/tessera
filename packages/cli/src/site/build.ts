import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { extractContract } from '@tessera/compiler'
import { renderMarkdown } from '@tessera/docs'
import type { Registry } from '../registry/build'
import { itemFile, type RegistryItem } from '../registry/schema'

/** A file of the site, by the path it is served from. */
export interface SiteFile {
  path: string
  content: string
}

const HOST = 'https://tessera-ui.pixelscript.io'
const FRAMEWORK = 'https://tessera.pixelscript.io/'

const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const code = (text: string): string => `<code>${escape(text)}</code>`
const command = (text: string): string => `<pre class="command"><code>${escape(text)}</code></pre>`

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf8; --surface: #ffffff; --text: #1c1b19; --muted: #5d5a54; --border: #dedad3;
  --accent: #14663d; --accent-text: #ffffff; --code-bg: #f1efea; --focus: #14663d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151412; --surface: #1d1c1a; --text: #f1efea; --muted: #a9a59c; --border: #35332f;
    --accent: #5bc58a; --accent-text: #0e1a13; --code-bg: #242320; --focus: #5bc58a;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); text-underline-offset: 3px; }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 2px; }
.skip { position: absolute; left: 16px; top: -48px; background: var(--accent); color: var(--accent-text); padding: 8px 12px; border-radius: 4px; }
.skip:focus { top: 16px; }
header.site { border-bottom: 1px solid var(--border); }
header.site nav { max-width: 960px; margin: 0 auto; padding: 14px 24px; display: flex; gap: 20px; align-items: baseline; flex-wrap: wrap; }
header.site .brand { font-weight: 700; color: var(--text); text-decoration: none; margin-right: auto; }
main { max-width: 960px; margin: 0 auto; padding: 40px 24px 80px; }
footer { max-width: 960px; margin: 0 auto; padding: 24px; border-top: 1px solid var(--border); color: var(--muted); font-size: 14px; }
h1 { font-size: 2.25rem; line-height: 1.15; margin: 0 0 12px; letter-spacing: -0.02em; }
h2 { font-size: 1.35rem; margin: 40px 0 12px; }
h3 { font-size: 1.1rem; margin: 28px 0 8px; }
.lede { font-size: 1.15rem; color: var(--muted); max-width: 640px; margin: 0 0 24px; }
code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }
pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px; overflow-x: auto; margin: 12px 0; }
pre code { background: none; padding: 0; }
pre.command { border-left: 3px solid var(--accent); }
.grid { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.grid li { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
.grid a { font-weight: 600; }
.grid p { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 15px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-weight: 600; color: var(--muted); }
.crumbs { font-size: 14px; color: var(--muted); margin: 0 0 16px; }
.docs blockquote { border-left: 3px solid var(--border); margin: 12px 0; padding: 0 16px; color: var(--muted); }
details { margin: 8px 0; }
summary { cursor: pointer; color: var(--muted); }
.tag { font-size: 12px; border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; color: var(--muted); }
@media (max-width: 640px) {
  main { padding: 24px 16px 56px; }
  header.site nav, footer { padding-left: 16px; padding-right: 16px; }
  h1 { font-size: 1.8rem; }
  th, td { padding: 6px 8px; }
}
`

function layout(title: string, path: string, body: string, description: string): string {
  const up = '../'.repeat(path.split('/').length - 1)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="site"><nav aria-label="Tessera UI">
<a class="brand" href="${up || './'}">Tessera UI</a>
<a href="${up}tokens/">Design tokens</a>
<a href="${FRAMEWORK}">Tessera</a>
<a href="${up}index.json">Registry (JSON)</a>
</nav></header>
<main id="main">
${body}
</main>
<footer>Tessera UI is a catalogue. <code>tessera add</code> copies a component into your project, and from then on it is yours to change. Served from ${escape(HOST.replace('https://', ''))}.</footer>
</body>
</html>
`
}

function list(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
}

function row(cells: string[], header = false): string {
  const tag = header ? 'th' : 'td'
  return `<tr>${cells.map((c) => `<${tag}${header ? ' scope="col"' : ''}>${c}</${tag}>`).join('')}</tr>`
}

const table = (head: string[], rows: string[][]): string =>
  `<table><thead>${row(head, true)}</thead><tbody>${rows.map((r) => row(r)).join('')}</tbody></table>`

/** The docs page as HTML: examples shown as source, headings one level down, links only to places that exist. */
function docsHtml(source: string, known: Set<string>): string {
  const html = renderMarkdown(source)
    .html.replace(/<div class="docs-live" data-live="\d+"><\/div>\n?/g, '')
    .replace(
      /<details><summary>Source<\/summary>/g,
      '<details open><summary>Example source</summary>',
    )
    .replace(
      /<(\/?)h([1-6])>/g,
      (_, slash: string, level: string) => `<${slash}h${Math.min(6, Number(level) + 1)}>`,
    )
  return html.replace(
    /<a href="([^"]*)">([\s\S]*?)<\/a>/g,
    (whole, href: string, label: string) => {
      const component = /^#\/components\/([A-Z][A-Za-z0-9]*)$/.exec(href)
      if (component)
        return known.has(component[1]!) ? `<a href="../${component[1]}/">${label}</a>` : label
      return /^(https?:|mailto:)/.test(href) ? whole : label
    },
  )
}

function componentPage(item: RegistryItem, known: Set<string>): string {
  const tess = item.files.find((f) => f.path === `${item.name}.tess`)
  const contract = tess ? extractContract(tess.content, tess.path) : undefined
  const docs = item.files.find((f) => f.path === `${item.name}.docs.md`)
  const link = (name: string) =>
    known.has(name) ? `<a href="../${name}/">${escape(name)}</a>` : code(name)
  const body: string[] = [
    `<p class="crumbs"><a href="../../">Tessera UI</a> / ${escape(item.name)}</p>`,
    `<h1>${escape(item.name)}</h1>`,
    `<p class="lede">${escape(item.description)}</p>`,
    '<h2 id="add">Add it</h2>',
    command(`npx tessera add ${item.name}`),
  ]
  const facts: string[] = []
  if (item.components?.length)
    facts.push(`Also installs ${item.components.map(link).join(', ')}, which it uses.`)
  if (item.npm)
    facts.push(
      `Needs the npm ${Object.keys(item.npm).length === 1 ? 'package' : 'packages'} ${Object.entries(
        item.npm,
      )
        .map(([name, version]) => `${code(name)} ${escape(version)}`)
        .join(
          ', ',
        )}; <code>tessera add --install</code> installs ${Object.keys(item.npm).length === 1 ? 'it' : 'them'}.`,
    )
  if (item.minTessera) facts.push(`Works with Tessera ${escape(item.minTessera)} or newer.`)
  if (facts.length) body.push(list(facts))

  if (contract) {
    body.push('<h2 id="contract">Contract</h2>')
    const rows: string[][] = []
    for (const [name, values] of Object.entries(contract.variants))
      rows.push([
        'Variant',
        code(name),
        values
          .map((v, i) => code(v) + (i === 0 ? ' <span class="tag">default</span>' : ''))
          .join(' '),
      ])
    if (contract.states.length) rows.push(['States', '', contract.states.map(code).join(' ')])
    rows.push(['Parts', '', contract.parts.map(code).join(' ')])
    for (const [name, text] of Object.entries(contract.slots))
      rows.push(['Slot', code(name), escape(text)])
    for (const [name, text] of Object.entries(contract.events))
      rows.push(['Event', code(name), escape(text)])
    if (contract.behavior) rows.push(['Behavior', '', code(contract.behavior)])
    if (contract.since) rows.push(['Since', '', escape(contract.since)])
    body.push(table(['', 'Name', 'Values'], rows))
  }

  if (item.tokens?.length) {
    body.push(
      '<h2 id="tokens">Design tokens it uses</h2>',
      '<p>Your design system needs these. <code>tessera add</code> checks that it has them, and can add the ones it lacks.</p>',
      `<p>${item.tokens.map(code).join(' ')}</p>`,
    )
  }
  if (docs)
    body.push(
      '<h2 id="docs">Using it</h2>',
      `<div class="docs">${docsHtml(docs.content, known)}</div>`,
    )
  body.push(
    '<h2 id="files">What gets copied</h2>',
    list(item.files.map((f) => code(`system/components/${f.path}`))),
    `<details><summary>Checksum</summary><p>${code(item.sha256)}</p></details>`,
  )
  return layout(
    `${item.name} · Tessera UI`,
    `components/${item.name}/index.html`,
    body.join('\n'),
    item.description,
  )
}

function homePage(components: RegistryItem[]): string {
  const first = components.find((c) => c.name === 'Button') ?? components[0]
  const body = [
    '<h1>Tessera UI</h1>',
    '<p class="lede">Accessible components for Tessera, in the open. You copy a component into your project with one command, and from then on it is your code: change it, restyle it, delete what you do not use.</p>',
    command(`npx tessera add ${first ? first.name : 'Button'}`),
    '<p>Every component has a contract (its variants, states, parts, slots and events), styles that use only design tokens, and a generated accessibility test that runs in light and dark themes. <code>tessera add</code> also checks that your design system has the tokens a component uses.</p>',
    `<h2 id="components">Components <span class="tag">${components.length}</span></h2>`,
    `<ul class="grid">${components
      .map(
        (c) =>
          `<li><a href="components/${escape(c.name)}/">${escape(c.name)}</a><p>${escape(c.description)}</p></li>`,
      )
      .join('')}</ul>`,
    '<h2 id="systems">Design systems</h2>',
    '<p>Components read their colors, spacing and type from design tokens, so the same component fits any look. <a href="tokens/">Token sets</a> give you a place to start.</p>',
    '<h2 id="registry">The registry</h2>',
    `<p>This site is also the registry. <code>tessera add</code> reads ${code(HOST + '/index.json')}, and any tool can: it is plain JSON, served with open CORS.</p>`,
  ]
  return layout(
    'Tessera UI',
    'index.html',
    body.join('\n'),
    'Accessible components for Tessera. Copy one into your project with tessera add.',
  )
}

function tokensPage(sets: RegistryItem[]): string {
  const body = [
    '<p class="crumbs"><a href="../">Tessera UI</a> / Design tokens</p>',
    '<h1>Design tokens</h1>',
    '<p class="lede">A set of tokens is a design system: the colors, spacing, type, radii and shadows the components are written against. Add one as a starting point, then make it yours.</p>',
  ]
  if (!sets.length) body.push('<p>This registry has no token sets.</p>')
  for (const set of sets) {
    const name = set.name.replace(/^tokens:/, '')
    body.push(
      `<h2 id="${escape(name)}">${escape(name)}</h2>`,
      `<p>${escape(set.description)}</p>`,
      command(`npx tessera add ${set.name}`),
      `<details><summary>${set.files.length} ${set.files.length === 1 ? 'file' : 'files'}</summary>${list(set.files.map((f) => code(f.path)))}</details>`,
    )
  }
  return layout(
    'Design tokens · Tessera UI',
    'tokens/index.html',
    body.join('\n'),
    'Token sets Tessera UI components fit, and the command that adds each.',
  )
}

function notFoundPage(): string {
  return layout(
    'Not found · Tessera UI',
    '404.html',
    '<h1>Not found</h1>\n<p class="lede">There is nothing at this address. Try the <a href="/">list of components</a>.</p>',
    'This page does not exist.',
  )
}

const HEADERS = `# Security: the pages run no script and load nothing from elsewhere.
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Cache-Control: public, max-age=0, must-revalidate

# The registry is read by tessera add, by other sites and by tools: open to any origin, cached for five minutes.
/index.json
  ! Cache-Control
  Cache-Control: public, max-age=300
  Access-Control-Allow-Origin: *

/r/*
  ! Cache-Control
  Cache-Control: public, max-age=300
  Access-Control-Allow-Origin: *
`

/**
 * The whole site, as files: the registry (`index.json`, `r/<item>.json`, the same bytes `writeRegistry` writes),
 * a page for each component and for the token sets, and the `_headers` file Cloudflare reads. Everything is made
 * from the registry, so the site cannot say something the registry does not. Pages run no script.
 */
export function buildSite(registry: Registry): SiteFile[] {
  const components = registry.items.filter((i) => i.type === 'component')
  const sets = registry.items.filter((i) => i.type === 'tokens')
  const known = new Set(components.map((c) => c.name))
  const files: SiteFile[] = [
    { path: 'index.html', content: homePage(components) },
    { path: 'tokens/index.html', content: tokensPage(sets) },
    { path: '404.html', content: notFoundPage() },
    { path: '_headers', content: HEADERS },
    { path: 'index.json', content: JSON.stringify(registry.index, null, 2) + '\n' },
  ]
  for (const item of components)
    files.push({
      path: `components/${item.name}/index.html`,
      content: componentPage(item, known),
    })
  for (const item of registry.items)
    files.push({ path: itemFile(item.name), content: JSON.stringify(item, null, 2) + '\n' })
  return files
}

/** Write the site to a folder, replacing what was there. */
export function writeSite(files: SiteFile[], out: string): void {
  rmSync(out, { recursive: true, force: true })
  for (const file of files) {
    const path = join(out, file.path)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, file.content)
  }
}
