import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { extractContract } from '@tessera/compiler'
import { renderMarkdown } from '@tessera/docs'
import type { Registry } from '../registry/build'
import { itemFile, type RegistryItem } from '../registry/schema'
import { highlight } from './highlight'

/** A file of the site, by the path it is served from. */
export interface SiteFile {
  path: string
  content: string
}

/** The script and style sheet that make the previews live, as addresses on this site. Without them the pages are static. */
export interface SiteAssets {
  script: string
  css: string
}

export interface SiteOptions {
  assets?: SiteAssets
}

/** A `tess live` example of a component's docs page: the name its page and its preview go by, and its source. */
export interface LiveExample {
  key: string
  component: string
  source: string
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

const byName = (a: RegistryItem, b: RegistryItem): number => a.name.localeCompare(b.name)

/** The docs file of a component, if it has one. */
const docsOf = (item: RegistryItem): string | undefined =>
  item.files.find((f) => f.path === `${item.name}.docs.md`)?.content

/** Every `tess live` example of every component, in the order the pages show them. */
export function liveExamples(registry: Registry): LiveExample[] {
  const out: LiveExample[] = []
  for (const item of registry.items.filter((i) => i.type === 'component').sort(byName)) {
    const docs = docsOf(item)
    if (!docs) continue
    renderMarkdown(docs).live.forEach((block, i) =>
      out.push({
        key: `${item.name}-${i}`,
        component: item.name,
        source: block.source.endsWith('\n') ? block.source : block.source + '\n',
      }),
    )
  }
  return out
}

const TAB_COUNT = 8
const tabRules = Array.from({ length: TAB_COUNT }, (_, i) => {
  const n = i + 1
  return `.tabs > input:nth-of-type(${n}):checked ~ .tab-list label:nth-of-type(${n}) { color: var(--text); border-bottom-color: var(--accent); }
.tabs > input:nth-of-type(${n}):focus-visible ~ .tab-list label:nth-of-type(${n}) { outline: 2px solid var(--focus); outline-offset: 2px; }
.tabs > input:nth-of-type(${n}):checked ~ .panels > .panel:nth-of-type(${n}) { display: block; }`
}).join('\n')

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf8; --surface: #ffffff; --text: #1c1b19; --muted: #5d5a54; --border: #dedad3; --hover: #f1efea;
  --accent: #14663d; --accent-text: #ffffff; --code-bg: #f6f4ef; --focus: #14663d;
  --tk-c: #6b675f; --tk-s: #0b6b41; --tk-t: #a1336a; --tk-a: #3a5ea8; --tk-v: #8a5a00; --tk-k: #7d3cbf; --tk-n: #8a5a00;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151412; --surface: #1d1c1a; --text: #f1efea; --muted: #a9a59c; --border: #35332f; --hover: #242320;
    --accent: #5bc58a; --accent-text: #0e1a13; --code-bg: #1b1a18; --focus: #5bc58a;
    --tk-c: #8d897f; --tk-s: #7ed3a2; --tk-t: #ee8bb9; --tk-a: #8fb0f0; --tk-v: #e6b45a; --tk-k: #c39bf0; --tk-n: #e6b45a;
  }
}
* { box-sizing: border-box; }
html { scroll-padding-top: 72px; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); text-underline-offset: 3px; }
a:focus-visible, summary:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 2px; }
.skip { position: absolute; left: 16px; top: -48px; background: var(--accent); color: var(--accent-text); padding: 8px 12px; border-radius: 4px; z-index: 20; }
.skip:focus { top: 12px; }

header.top { position: sticky; top: 0; z-index: 10; background: var(--bg); border-bottom: 1px solid var(--border); }
header.top .bar { max-width: 1400px; margin: 0 auto; padding: 0 24px; height: 56px; display: flex; align-items: center; gap: 24px; }
header.top .brand { font-weight: 700; color: var(--text); text-decoration: none; letter-spacing: -0.01em; }
header.top nav { display: flex; gap: 20px; font-size: 14px; }
header.top nav a { color: var(--muted); text-decoration: none; }
header.top nav a:hover { color: var(--text); }
header.top .end { margin-left: auto; }

.shell { max-width: 1400px; margin: 0 auto; padding: 0 24px; display: grid; grid-template-columns: 240px minmax(0, 1fr) 200px; gap: 40px; }
.shell.single { grid-template-columns: minmax(0, 1fr); max-width: 760px; }
details.menu { position: sticky; top: 56px; align-self: start; max-height: calc(100vh - 56px); overflow-y: auto; padding: 24px 0 32px; }
details.menu > summary { display: none; }
.sidebar h2 { font-size: 13px; font-weight: 600; margin: 0 0 6px; padding: 0 10px; letter-spacing: 0; color: var(--text); }
.sidebar ul { list-style: none; margin: 0 0 24px; padding: 0; }
.sidebar a { display: block; padding: 4px 10px; border-radius: 6px; font-size: 14px; color: var(--muted); text-decoration: none; }
.sidebar a:hover { color: var(--text); background: var(--hover); }
.sidebar a[aria-current="page"] { color: var(--text); background: var(--hover); font-weight: 600; }
.toc { position: sticky; top: 56px; align-self: start; padding: 32px 0; font-size: 13px; }
.toc h2 { font-size: 13px; margin: 0 0 8px; }
.toc ul { list-style: none; margin: 0; padding: 0; }
.toc a { display: block; padding: 3px 0; color: var(--muted); text-decoration: none; }
.toc a:hover { color: var(--text); }
main { min-width: 0; padding: 36px 0 80px; }
footer { max-width: 1400px; margin: 0 auto; padding: 24px; border-top: 1px solid var(--border); color: var(--muted); font-size: 14px; }

h1 { font-size: 2.25rem; line-height: 1.15; margin: 0 0 8px; letter-spacing: -0.02em; }
h2 { font-size: 1.5rem; margin: 48px 0 12px; letter-spacing: -0.01em; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
h3 { font-size: 1.15rem; margin: 28px 0 8px; }
.lede { font-size: 1.1rem; color: var(--muted); max-width: 640px; margin: 0 0 20px; }
.crumbs { font-size: 14px; color: var(--muted); margin: 0 0 12px; }
.crumbs a { color: var(--muted); }
.head { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.pager { display: flex; gap: 8px; }
.pager a { border: 1px solid var(--border); border-radius: 6px; padding: 4px 12px; font-size: 14px; color: var(--text); text-decoration: none; background: var(--surface); }
.pager a:hover { background: var(--hover); }
code { font: 0.88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }
pre { background: var(--code-bg); margin: 0; padding: 16px; overflow: auto; font-size: 13.5px; line-height: 1.6; max-height: 480px; }
pre code { background: none; padding: 0; font-size: inherit; }
.tk-c { color: var(--tk-c); font-style: italic; } .tk-s { color: var(--tk-s); } .tk-t { color: var(--tk-t); } .tk-a { color: var(--tk-a); }
.tk-v { color: var(--tk-v); } .tk-k { color: var(--tk-k); } .tk-n { color: var(--tk-n); }
figure.code { margin: 12px 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; position: relative; }
figure.code figcaption { font: 12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--muted); padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--surface); }
figure.code.bare figcaption { display: none; }
button.copy { position: absolute; top: 6px; right: 8px; font: 12px system-ui, sans-serif; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button.copy:hover { background: var(--hover); }

.tabs { margin: 16px 0; }
.tabs > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.tab-list { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 0; }
.tab-list label { padding: 8px 14px; cursor: pointer; font-size: 14px; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab-list label:hover { color: var(--text); }
.panel { display: none; }
.tabs.example { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface); }
.tabs.example .tab-list { padding: 0 8px; background: var(--surface); }
.tabs.example figure.code { margin: 0; border: 0; border-radius: 0; }
.tabs:not(.example) > .panels { padding-top: 12px; }
.stage { padding: 40px 24px; min-height: 160px; display: flex; align-items: center; justify-content: center; background: var(--t-color-surface-default, #fff); color: var(--t-color-text-default, #1c1b19); }
.live { width: 100%; display: flex; justify-content: center; }
.live > * { max-width: 100%; }
.live > div { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: center; }
.nojs { color: var(--muted); font-size: 14px; margin: 0; }
.live:not(:empty) .nojs { display: none; }

table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 15px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 13px; }
.tag { font-size: 12px; border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; color: var(--muted); }
.docs blockquote { border-left: 3px solid var(--border); margin: 12px 0; padding: 0 16px; color: var(--muted); }
.grid { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.grid li { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
.grid a { font-weight: 600; }
.grid p { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
ol.steps { padding-left: 0; list-style: none; counter-reset: step; }
ol.steps > li { counter-increment: step; position: relative; padding-left: 40px; margin: 20px 0; }
ol.steps > li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--hover); border: 1px solid var(--border); text-align: center; line-height: 26px; font-size: 13px; font-weight: 600; }
ol.steps > li > h3 { margin: 0 0 6px; font-size: 1rem; }

${tabRules}

@media (max-width: 1100px) {
  .shell { grid-template-columns: 240px minmax(0, 1fr); }
  .toc { display: none; }
}
@media (max-width: 860px) {
  .shell { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 0 16px; }
  header.top .bar { padding: 0 16px; gap: 16px; }
  header.top nav { gap: 12px; }
  details.menu { position: static; max-height: none; padding: 12px 0 0; border-bottom: 1px solid var(--border); }
  details.menu > summary { display: block; cursor: pointer; font-size: 14px; padding: 6px 0 12px; color: var(--muted); }
  main { padding-top: 24px; }
  h1 { font-size: 1.8rem; }
  .stage { padding: 24px 12px; }
  th, td { padding: 6px 8px; }
  footer { padding: 16px; }
}
`

/** A relative link from one page to a folder of the site, written with a trailing slash. */
function link(from: string, to: string): string {
  const target = to.replace(/\/$/, '')
  const rel = posix.relative(posix.dirname(from), target)
  return rel === '' ? './' : `${rel}/`
}

interface Context {
  assets?: SiteAssets
  components: RegistryItem[]
}

interface Page {
  /** Where it is written: `components/Button/index.html`. */
  path: string
  /** The folder the sidebar marks as current, `components/Button`. */
  current: string
  title: string
  description: string
  body: string
  toc?: Array<{ id: string; label: string }>
}

function sidebar(ctx: Context, page: Page): string {
  const item = (to: string, label: string) =>
    `<li><a href="${link(page.path, to)}"${to === page.current ? ' aria-current="page"' : ''}>${escape(label)}</a></li>`
  return `<details class="menu" open><summary>Menu</summary><nav class="sidebar" aria-label="Docs">
<h2>Get started</h2>
<ul>${item('', 'Introduction')}${item('installation', 'Installation')}${item('tokens', 'Design tokens')}</ul>
<h2>Components</h2>
<ul>${item('components', 'All components')}${ctx.components.map((c) => item(`components/${c.name}`, c.name)).join('')}</ul>
</nav></details>`
}

function layout(ctx: Context, page: Page, withSidebar = true): string {
  const up = posix.relative(posix.dirname(page.path), '') || '.'
  const root = withSidebar ? (up === '.' ? '' : `${up}/`) : '/'
  const toc =
    page.toc && page.toc.length
      ? `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul>${page.toc.map((t) => `<li><a href="#${t.id}">${escape(t.label)}</a></li>`).join('')}</ul></nav>`
      : ''
  const assets = ctx.assets
  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(page.title)}</title>
<meta name="description" content="${escape(page.description)}">
<link rel="icon" href="data:,">
<style>${STYLE}</style>
${assets ? `<link rel="stylesheet" href="${assets.css}">\n` : ''}</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="top"><div class="bar">
<a class="brand" href="${root || './'}">Tessera UI</a>
<nav aria-label="Site">
<a href="${root}installation/">Docs</a>
<a href="${root}components/">Components</a>
<a href="${root}tokens/">Tokens</a>
</nav>
<nav class="end" aria-label="Elsewhere"><a href="${FRAMEWORK}">Tessera</a></nav>
</div></header>
<div class="shell${withSidebar ? '' : ' single'}">
${withSidebar ? sidebar(ctx, page) : ''}
<main id="main">
${page.body}
</main>
${toc}
</div>
<footer>Tessera UI is a catalogue. <code>tessera add</code> copies a component into your project, and from then on it is yours to change. Served from ${escape(HOST.replace('https://', ''))}. <a href="${root}index.json">Registry (JSON)</a></footer>
${assets ? `<script type="module" src="${assets.script}"></script>\n` : ''}</body>
</html>
`
}

/** Ids for the tab groups of one page. */
class Tabs {
  private n = 0
  /** Radio buttons and labels, so tabs work with no script; the style sheet shows the panel of the one that is checked. */
  render(tabs: Array<{ label: string; html: string }>, className = ''): string {
    const group = `t${++this.n}`
    const inputs = tabs
      .map(
        (_, i) =>
          `<input type="radio" name="${group}" id="${group}-${i}"${i === 0 ? ' checked' : ''}>`,
      )
      .join('')
    const labels = tabs
      .map((t, i) => `<label for="${group}-${i}">${escape(t.label)}</label>`)
      .join('')
    const panels = tabs.map((t) => `<div class="panel">${t.html}</div>`).join('')
    return `<div class="tabs${className ? ` ${className}` : ''}">${inputs}<div class="tab-list">${labels}</div><div class="panels">${panels}</div></div>`
  }
}

const langOf = (file: string): string =>
  file.endsWith('.ts')
    ? 'ts'
    : file.endsWith('.json')
      ? 'json'
      : file.endsWith('.tess')
        ? 'tess'
        : 'text'

/** A file shown as code, named by what it is called in the project. */
function codeBlock(file: string, source: string, bare = false): string {
  return `<figure class="code${bare ? ' bare' : ''}"><figcaption>${escape(file)}</figcaption><pre data-file="${escape(file)}"><code>${highlight(source, langOf(file))}</code></pre></figure>`
}

/** A command, with no file name. */
const command = (text: string): string =>
  `<figure class="code bare"><pre><code>${escape(text)}</code></pre></figure>`

/** The command for each package manager. `tessera` is not run bare with npm or bun: `npx tessera` can fetch another package. */
function runTabs(tabs: Tabs, args: string): string {
  return tabs.render([
    { label: 'npm', html: command(`npx @pixelscriptio/tessera ${args}`) },
    { label: 'pnpm', html: command(`pnpm exec tessera ${args}`) },
    { label: 'yarn', html: command(`yarn tessera ${args}`) },
    { label: 'bun', html: command(`bunx @pixelscriptio/tessera ${args}`) },
  ])
}

function list(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
}

const row = (cells: string[], header = false): string => {
  const tag = header ? 'th' : 'td'
  return `<tr>${cells.map((c) => `<${tag}${header ? ' scope="col"' : ''}>${c}</${tag}>`).join('')}</tr>`
}
const table = (head: string[], rows: string[][]): string =>
  `<table><thead>${row(head, true)}</thead><tbody>${rows.map((r) => row(r)).join('')}</tbody></table>`

/** A preview of a live example, and the example's code beside it, as tabs. */
function example(tabs: Tabs, key: string, source: string): string {
  return tabs.render(
    [
      {
        label: 'Preview',
        html: `<div class="stage"><div class="live" data-live="${escape(key)}"><p class="nojs">The preview needs JavaScript. The code is in the Code tab.</p></div></div>`,
      },
      { label: 'Code', html: codeBlock(`${key}.tess`, source, true) },
    ],
    'example',
  )
}

/** The docs page as HTML: examples as previews with code, headings one level down, links only to places that exist. */
function docsHtml(name: string, source: string, known: Set<string>, tabs: Tabs): string {
  const rendered = renderMarkdown(source)
  const html = rendered.html
    .replace(
      /<div class="docs-live" data-live="(\d+)"><\/div>\n<details>[\s\S]*?<\/details>/g,
      (_, index: string) => {
        const block = rendered.live[Number(index)]!
        return example(
          tabs,
          `${name}-${index}`,
          block.source.endsWith('\n') ? block.source : block.source + '\n',
        )
      },
    )
    .replace(
      /<(\/?)h([1-6])>/g,
      (_, slash: string, level: string) => `<${slash}h${Math.min(6, Number(level) + 2)}>`,
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

/** What the contract says, as tables. */
function apiHtml(item: RegistryItem): string {
  const tess = item.files.find((f) => f.path === `${item.name}.tess`)
  const contract = tess ? extractContract(tess.content, tess.path) : undefined
  if (!contract) return ''
  const out: string[] = []
  const variants = Object.entries(contract.variants)
  if (variants.length)
    out.push(
      '<h3>Variants</h3>',
      table(
        ['Variant', 'Values'],
        variants.map(([name, values]) => [
          code(name),
          values
            .map((v, i) => code(v) + (i === 0 ? ' <span class="tag">default</span>' : ''))
            .join(' '),
        ]),
      ),
    )
  const slots = Object.entries(contract.slots)
  if (slots.length)
    out.push(
      '<h3>Slots</h3>',
      table(
        ['Slot', 'Content'],
        slots.map(([n, t]) => [code(n), escape(t)]),
      ),
    )
  const events = Object.entries(contract.events)
  if (events.length)
    out.push(
      '<h3>Events</h3>',
      table(
        ['Event', 'When'],
        events.map(([n, t]) => [code(n), escape(t)]),
      ),
    )
  const facts: string[][] = [['Role', code(contract.role)]]
  if (contract.behavior) facts.push(['Behavior', code(contract.behavior)])
  facts.push(['Parts', contract.parts.map(code).join(' ')])
  if (contract.states.length) facts.push(['States', contract.states.map(code).join(' ')])
  if (contract.since) facts.push(['Since', escape(contract.since)])
  out.push('<h3>Anatomy</h3>', table(['', ''], facts))
  return out.join('\n')
}

function componentPage(ctx: Context, item: RegistryItem, index: number, known: Set<string>): Page {
  const path = `components/${item.name}/index.html`
  const tabs = new Tabs()
  const docs = docsOf(item)
  const examples = docs ? renderMarkdown(docs).live : []
  const prev = ctx.components[index - 1]
  const next = ctx.components[index + 1]
  const name = (n: string) => (known.has(n) ? `<a href="../${n}/">${escape(n)}</a>` : code(n))

  const files = item.files.filter((f) => !f.path.endsWith('.docs.md'))
  const facts: string[] = []
  if (item.components?.length)
    facts.push(`Also installs ${item.components.map(name).join(', ')}, which it uses.`)
  if (item.npm) {
    const n = Object.keys(item.npm).length
    facts.push(
      `Needs the npm ${n === 1 ? 'package' : 'packages'} ${Object.entries(item.npm)
        .map(([p, v]) => `${code(p)} ${escape(v)}`)
        .join(', ')}; <code>--install</code> installs ${n === 1 ? 'it' : 'them'}.`,
    )
  }
  if (item.minTessera) facts.push(`Works with Tessera ${escape(item.minTessera)} or newer.`)

  const manual: string[] = ['<ol class="steps">']
  if (item.npm)
    manual.push(
      `<li><h3>Install the dependencies</h3>${Object.entries(item.npm)
        .map(([p, v]) => command(`npm install ${p}@${v}`))
        .join('')}</li>`,
    )
  manual.push(
    `<li><h3>Copy and paste the code into your project</h3><p>Put ${files.length === 1 ? 'it' : 'each file'} in <code>system/components</code>.${item.components?.length ? ` Add ${item.components.map(name).join(', ')} the same way.` : ''}</p>${files
      .map((f) => codeBlock(`system/components/${f.path}`, f.content))
      .join('')}</li>`,
  )
  if (item.tokens?.length)
    manual.push(
      `<li><h3>Check your design tokens</h3><p>Your design system needs these. <code>tessera add</code> reports the ones that are missing; by hand, run <code>npx @pixelscriptio/tessera check</code>.</p><p>${item.tokens.map(code).join(' ')}</p></li>`,
    )
  manual.push('</ol>')

  const body: string[] = [
    `<div class="head"><div>`,
    `<p class="crumbs"><a href="../">Components</a></p>`,
    `<h1>${escape(item.name)}</h1>`,
    `<p class="lede">${escape(item.description)}</p></div>`,
    `<div class="pager">${prev ? `<a rel="prev" href="../${prev.name}/" aria-label="Previous: ${escape(prev.name)}">← ${escape(prev.name)}</a>` : ''}${next ? `<a rel="next" href="../${next.name}/" aria-label="Next: ${escape(next.name)}">${escape(next.name)} →</a>` : ''}</div></div>`,
  ]
  const first = examples[0]
  if (first)
    body.push(
      example(
        tabs,
        `${item.name}-0`,
        first.source.endsWith('\n') ? first.source : first.source + '\n',
      ),
    )

  const toc: Page['toc'] = []
  body.push(
    '<h2 id="installation">Installation</h2>',
    tabs.render([
      {
        label: 'CLI',
        html: `${runTabs(tabs, `add ${item.name}`)}${facts.length ? list(facts) : ''}`,
      },
      { label: 'Manual', html: manual.join('') },
    ]),
  )
  toc.push({ id: 'installation', label: 'Installation' })
  if (docs) {
    body.push(
      '<h2 id="usage">Usage</h2>',
      `<div class="docs">${docsHtml(item.name, docs, known, tabs)}</div>`,
    )
    toc.push({ id: 'usage', label: 'Usage' })
  }
  const api = apiHtml(item)
  if (api) {
    body.push('<h2 id="api">API reference</h2>', api)
    toc.push({ id: 'api', label: 'API reference' })
  }
  if (item.tokens?.length) {
    body.push(
      '<h2 id="tokens">Design tokens it uses</h2>',
      '<p>Your design system needs these. <code>tessera add</code> checks that it has them, and can add the ones it lacks.</p>',
      `<p>${item.tokens.map(code).join(' ')}</p>`,
    )
    toc.push({ id: 'tokens', label: 'Design tokens' })
  }
  body.push(`<details><summary>Checksum</summary><p>${code(item.sha256)}</p></details>`)
  return {
    path,
    current: `components/${item.name}`,
    title: `${item.name} · Tessera UI`,
    description: item.description,
    body: body.join('\n'),
    toc,
  }
}

function homePage(ctx: Context): Page {
  const body = [
    '<h1>Introduction</h1>',
    '<p class="lede">Accessible components for Tessera, in the open. You copy a component into your project with one command, and from then on it is your code: change it, restyle it, delete what you do not use.</p>',
    '<h2 id="what">What this is</h2>',
    '<p>Tessera UI is a catalogue, not a package you depend on. Each component is a <code>.tess</code> file with a contract (its variants, states, parts, slots and events), styles that use only design tokens, and a generated accessibility test that runs in light and dark themes. <code>tessera add</code> copies it into <code>system/components</code>, and checks that your design system has the tokens it uses.</p>',
    `<p>There are ${ctx.components.length} components. Every page has a live preview, the full code, and how to add it.</p>`,
    '<h2 id="principles">How it works</h2>',
    list([
      '<strong>Open code.</strong> The code is yours. There is no package to update and nothing to wrap.',
      '<strong>Tokens, not values.</strong> A component reads its colors, spacing and type from design tokens, so the same component fits any look.',
      '<strong>Accessible by contract.</strong> The contract says what a component promises, and the generated tests check it.',
      '<strong>A registry.</strong> This site is also the registry. <code>tessera add</code> reads <code>' +
        escape(HOST) +
        '/index.json</code>, and any tool can: it is plain JSON, served with open CORS.',
    ]),
    '<h2 id="next">Next</h2>',
    list([
      '<a href="installation/">Installation</a>: start a project and add a component.',
      '<a href="components/">Components</a>: all of them, with previews.',
      '<a href="tokens/">Design tokens</a>: token sets to start a design system from.',
    ]),
  ]
  return {
    path: 'index.html',
    current: '',
    title: 'Tessera UI',
    description: 'Accessible components for Tessera. Copy one into your project with tessera add.',
    body: body.join('\n'),
    toc: [
      { id: 'what', label: 'What this is' },
      { id: 'principles', label: 'How it works' },
      { id: 'next', label: 'Next' },
    ],
  }
}

function installationPage(): Page {
  const tabs = new Tabs()
  const body = [
    '<h1>Installation</h1>',
    '<p class="lede">Start a Tessera project, then add the components you want. Each one is copied into your project.</p>',
    '<ol class="steps">',
    `<li><h3>Create a project</h3><p>Skip this if you already have one.</p>${tabs.render([
      { label: 'npm', html: command('npm create @pixelscriptio/tessera@latest') },
      { label: 'pnpm', html: command('pnpm create @pixelscriptio/tessera@latest') },
      { label: 'yarn', html: command('yarn create @pixelscriptio/tessera') },
      { label: 'bun', html: command('bun create @pixelscriptio/tessera@latest') },
    ])}<p>Choose the <code>tailwind</code> preset for Tailwind's colors and spacing, or <code>unstyled</code> for a blank page to design on.</p></li>`,
    `<li><h3>Add a component</h3>${runTabs(tabs, 'add Button')}<p>It goes in <code>system/components</code> with its docs file, and brings the components it uses. What it installed is recorded in <code>tessera.lock.json</code>. If the name is taken it asks whether to replace yours or add the new one under another name (<code>--replace</code>, <code>--as</code>). <code>--diff</code> shows what would change, and <code>--list</code> shows what is here.</p></li>`,
    `<li><h3>Make the tokens fit</h3><p>Before it writes a component, <code>add</code> compares the tokens the component uses with each design system in your project, and reports the ones that are missing or of the wrong type. Three ways to fix it:</p>${list(
      [
        '<code>--fit add</code> writes the missing tokens, with values to start from, in a file of their own.',
        '<code>--map color.action.primary.bg=color.brand.bg</code> rewrites the component to use a token you already have.',
        '<code>--fit set</code> installs a whole token set (<code>tokens:tailwind</code>) as another design system.',
      ],
    )}</li>`,
    `<li><h3>Check it</h3>${runTabs(tabs, 'check')}<p>Afterwards <code>add</code> runs this on what it wrote. <code>tessera a11y --system all</code> sets up the generated accessibility tests, which cover the components in every design system.</p></li>`,
    '</ol>',
  ]
  return {
    path: 'installation/index.html',
    current: 'installation',
    title: 'Installation · Tessera UI',
    description: 'Start a Tessera project and add components with tessera add.',
    body: body.join('\n'),
  }
}

function componentsPage(ctx: Context): Page {
  const body = [
    '<h1>Components</h1>',
    '<p class="lede">Accessible components you copy into your project. Each has a live preview, the full code and how to add it.</p>',
    `<ul class="grid">${ctx.components
      .map(
        (c) =>
          `<li><a href="${escape(c.name)}/">${escape(c.name)}</a><p>${escape(c.description)}</p></li>`,
      )
      .join('')}</ul>`,
  ]
  return {
    path: 'components/index.html',
    current: 'components',
    title: 'Components · Tessera UI',
    description: 'Every Tessera UI component, with a preview and the command that adds it.',
    body: body.join('\n'),
  }
}

function tokensPage(sets: RegistryItem[]): Page {
  const tabs = new Tabs()
  const body = [
    '<h1>Design tokens</h1>',
    '<p class="lede">A set of tokens is a design system: the colors, spacing, type, radii and shadows the components are written against. Add one as a starting point, then make it yours.</p>',
  ]
  if (!sets.length) body.push('<p>This registry has no token sets.</p>')
  const toc: Page['toc'] = []
  for (const set of sets) {
    const name = set.name.replace(/^tokens:/, '')
    toc.push({ id: name, label: name })
    body.push(
      `<h2 id="${escape(name)}">${escape(name)}</h2>`,
      `<p>${escape(set.description)}</p>`,
      runTabs(tabs, `add ${set.name}`),
      `<details><summary>${set.files.length} ${set.files.length === 1 ? 'file' : 'files'}</summary>${list(set.files.map((f) => code(f.path)))}</details>`,
    )
  }
  return {
    path: 'tokens/index.html',
    current: 'tokens',
    title: 'Design tokens · Tessera UI',
    description: 'Token sets Tessera UI components fit, and the command that adds each.',
    body: body.join('\n'),
    toc,
  }
}

const HEADERS = `# Security: the pages load a script and a style sheet from this site only, nothing from elsewhere.
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
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

# The bundle's chunks have the hash of their content in their names, so they never change.
/assets/chunks/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
`

/**
 * The whole site, as files: the registry (`index.json`, `r/<item>.json`, the same bytes `writeRegistry` writes), the
 * docs pages (an introduction, installation, the components, a page for each one, the token sets), and the `_headers`
 * file Cloudflare reads. Everything is made from the registry, so the site cannot say something the registry does not.
 * The pages are static HTML; with `assets` they load one script and one style sheet from this site, which make the
 * previews live (`buildLive` builds them from the same examples).
 */
export function buildSite(registry: Registry, options: SiteOptions = {}): SiteFile[] {
  const components = registry.items.filter((i) => i.type === 'component').sort(byName)
  const sets = registry.items.filter((i) => i.type === 'tokens')
  const known = new Set(components.map((c) => c.name))
  const ctx: Context = { ...(options.assets ? { assets: options.assets } : {}), components }
  const pages: Array<{ page: Page; sidebar?: false }> = [
    { page: homePage(ctx) },
    { page: installationPage() },
    { page: componentsPage(ctx) },
    { page: tokensPage(sets) },
    ...components.map((c, i) => ({ page: componentPage(ctx, c, i, known) })),
    {
      page: {
        path: '404.html',
        current: '',
        title: 'Not found · Tessera UI',
        description: 'This page does not exist.',
        body: '<h1>Not found</h1>\n<p class="lede">There is nothing at this address. Try the <a href="/components/">list of components</a>.</p>',
      },
      sidebar: false,
    },
  ]
  const files: SiteFile[] = pages.map(({ page, sidebar }) => ({
    path: page.path,
    content: layout(ctx, page, sidebar !== false),
  }))
  files.push(
    { path: '_headers', content: HEADERS },
    { path: 'index.json', content: JSON.stringify(registry.index, null, 2) + '\n' },
  )
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
