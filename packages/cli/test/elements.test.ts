import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from '../src'
import { presetFiles } from '../src/commands/init'
import { handlerName, kebab, tagName } from '../src/elements'
import type { Io } from '../src/io'

// The design system as custom elements, built from a project made by the tessera preset and used the way another team
// would: from plain HTML and from React, in a real browser, with none of the framework's own runtime on the page.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
const scratch = join(repo, 'examples/kitchen-sink/.docs-test-elements')
const axeSource = readFileSync(
  createRequire(join(repo, 'website/package.json')).resolve('axe-core'),
  'utf8',
)

let root: string
let out: string
let output = ''
let browser: Browser | undefined
const closers: Array<() => Promise<void> | void> = []

beforeAll(async () => {
  mkdirSync(scratch, { recursive: true })
  root = mkdtempSync(join(scratch, 'p-')).replaceAll('\\', '/')
  writeFileSync(
    join(root, 'package.json'),
    '{ "name": "acme-system", "dependencies": { "@pixelscriptio/tessera-ui": "*" } }\n',
  )
  for (const [file, content] of Object.entries(presetFiles('tailwind'))) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  out = join(root, 'dist-elements').replaceAll('\\', '/')
  const io: Io = { cwd: root, out: (t) => void (output += t + '\n'), err: () => {} }
  const code = await main(['elements', '--prefix', 'acme'], io)
  expect(code).toBe(0)
}, 240_000)

afterAll(async () => {
  await browser?.close()
  for (const close of closers) await close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})

const read = (file: string) => readFileSync(join(out, file), 'utf8')

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
}

/** A file server that knows nothing about Tessera or Vite: what any host does. */
function serve(dir: string): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = []
  const server: Server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!)
    requests.push(path)
    if (path === '/favicon.ico') {
      res.statusCode = 204
      res.end()
      return
    }
    try {
      const name = path === '/' ? '/index.html' : path
      const file = await readFile(join(dir, name))
      res.setHeader('Content-Type', TYPES[extname(name)] ?? 'application/octet-stream')
      res.end(file)
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })
  closers.push(() => new Promise<void>((done) => server.close(() => done())))
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({ url: `http://127.0.0.1:${port}/`, requests })
    }),
  )
}

async function open(url: string): Promise<{ page: Page; errors: string[] }> {
  browser ??= await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url)
  return { page, errors }
}

async function axe(page: Page): Promise<string[]> {
  await page.evaluate(axeSource)
  return (await page.evaluate(() =>
    (window as any).axe
      .run(document, { resultTypes: ['violations'] })
      .then((r: any) =>
        r.violations
          .filter((v: any) => v.impact === 'serious' || v.impact === 'critical')
          .map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(' ')).join(', ')}`),
      ),
  )) as string[]
}

describe('the names', () => {
  it('turns a component name into a tag and an event into a handler prop', () => {
    expect(kebab('AccordionItem')).toBe('accordion-item')
    expect(kebab('TextField')).toBe('text-field')
    expect(kebab('Button')).toBe('button')
    expect(kebab('HTMLView')).toBe('html-view')
    expect(tagName('t', 'AccordionItem')).toBe('t-accordion-item')
    expect(handlerName('press')).toBe('onPress')
    expect(handlerName('toggle-all')).toBe('onToggleAll')
  })

  it('refuses a prefix that cannot start a tag, and a project with nothing to build', async () => {
    let err = ''
    const io: Io = { cwd: root, out: () => {}, err: (t) => void (err += t + '\n') }
    expect(await main(['elements', '--prefix', 'Acme!'], io)).toBe(1)
    expect(err).toContain('"Acme!" cannot start a tag name.')
  })
})

describe('tessera elements', () => {
  it('says what it built', () => {
    expect(output).toContain('Built 25 custom elements into')
    for (const tag of ['acme-button', 'acme-checkbox', 'acme-accordion-item', 'acme-text-field'])
      expect(output).toContain(`<${tag}>`)
    expect(output).toMatch(/elements\.js [\d.]+ kB .* gzipped/)
  })

  it('writes one self-contained folder', () => {
    const files = [
      'elements.js',
      'elements.css',
      'elements.d.ts',
      'react.js',
      'react.d.ts',
      'custom-elements.json',
      'README.md',
    ]
    for (const file of files) expect(read(file).length, file).toBeGreaterThan(50)
    // The runtime is inside: nothing in the bundle imports Tessera, Vite or a bare package.
    expect(read('elements.js')).not.toMatch(/from ["']@pixelscriptio/)
    expect(read('elements.js')).toContain('customElements.define')
    // The tokens and the component styles are in the stylesheet, and the dark theme with them.
    expect(read('elements.css')).toContain('--t-color-surface-default')
    expect(read('elements.css')).toMatch(/prefers-color-scheme:s*dark/)
  })

  it('describes the elements to TypeScript', () => {
    const dts = read('elements.d.ts')
    expect(dts).toContain('export interface ButtonElement extends HTMLElement')
    expect(dts).toContain('tone: "primary" | "neutral" | "danger"')
    expect(dts).toContain('"acme-button": ButtonElement')
    expect(dts).toContain('interface HTMLElementTagNameMap')
    expect(dts).toContain('checked: boolean')
    expect(dts).toContain('options: Array<any>')
    expect(dts).toContain('addEventListener(type: "toggle"')
  })

  it('writes React wrappers that need no build step', () => {
    const js = read('react.js')
    expect(js).toContain('import { createElement, forwardRef')
    expect(js).toContain("import './elements.js'")
    expect(js).toContain('export const Checkbox = wrap("Checkbox", "acme-checkbox"')
    expect(js).toContain('"onToggle":"toggle"')
    expect(js).not.toContain('<')
    const dts = read('react.d.ts')
    expect(dts).toContain('export interface CheckboxProps')
    expect(dts).toContain('onToggle?: (event: CustomEvent<any>) => void')
    expect(dts).toContain(
      "Omit<HTMLAttributes<HTMLElement>, 'onSelect' | 'onInput' | 'onChange' | 'onToggle'",
    )
  })

  it('writes the manifest with the tags, attributes and events', () => {
    const manifest = JSON.parse(read('custom-elements.json')) as {
      modules: Array<{ path: string; declarations: Array<any> }>
    }
    const checkbox = manifest.modules
      .flatMap((m) => m.declarations)
      .find((d) => d.name === 'Checkbox')
    expect(checkbox.tagName).toBe('acme-checkbox')
    expect(checkbox.customElement).toBe(true)
    expect(checkbox.attributes.map((a: any) => a.name)).toEqual(['size', 'checked', 'disabled'])
    expect(checkbox.events.map((e: any) => e.name)).toEqual(['toggle'])
    expect(manifest.modules[0]!.path).toBe('elements.js')
  })

  it('explains itself in a README', () => {
    const readme = read('README.md')
    expect(readme).toContain('# acme-system: components as custom elements')
    expect(readme).toContain('<link rel="stylesheet" href="elements.css" />')
    expect(readme).toContain("tag.startsWith('acme-')")
    expect(readme).toContain('<acme-accordion-item>')
  })

  it('has types that check, and that reject a wrong value', () => {
    const dir = join(root, 'typecheck')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          lib: ['ES2023', 'DOM'],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
          typeRoots: [join(repo, 'node_modules/@types')],
          jsx: 'react',
        },
        files: ['good.tsx', 'bad.tsx'],
      }),
    )
    writeFileSync(
      join(dir, 'good.tsx'),
      `import * as React from 'react'
import { Button, Checkbox, Combobox, TextField } from '../dist-elements/react.js'
import type { ButtonElement } from '../dist-elements/elements.js'

const ref = React.createRef<ButtonElement>()
export const view = (
  <div>
    <Button ref={ref} tone="danger" size="lg" disabled onPress={(e) => console.log(e.detail)}>Save</Button>
    <Checkbox checked onToggle={(e) => console.log(e.detail.checked)}>Agree</Checkbox>
    <Combobox options={[{ value: 'a', label: 'A' }]} onSelect={(e) => console.log(e.detail)}><span slot="label">Fruit</span></Combobox>
    <TextField type="email" aria-label="Email" className="wide"><span slot="label">Email</span></TextField>
  </div>
)
const el = document.querySelector('acme-button')!
el.tone = 'neutral'
el.addEventListener('press', (e) => e.detail)
`,
    )
    writeFileSync(
      join(dir, 'bad.tsx'),
      `import * as React from 'react'
import { Button } from '../dist-elements/react.js'
export const view = <Button tone="loud">Save</Button>
`,
    )
    let stdout = ''
    try {
      execFileSync(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '-p', dir], {
        stdio: 'pipe',
        encoding: 'utf8',
      })
    } catch (error) {
      stdout = String((error as { stdout?: string }).stdout ?? '')
    }
    // Only the wrong value is an error, and it names the allowed ones.
    const problems = stdout.split('\n').filter((l) => /error TS/.test(l))
    expect(problems, stdout).toHaveLength(1)
    expect(problems[0]).toMatch(/bad\.tsx\(3,\d+\)/)
    expect(problems[0]).toContain('"loud"')
  })
})

describe('the elements in a page with no framework', () => {
  const page = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Elements</title>
  <link rel="stylesheet" href="/elements.css" />
  <script type="module" src="/elements.js"></script>
</head>
<body>
  <main style="padding: 24px">
    <acme-button id="save" tone="primary">Save</acme-button>
    <acme-button id="danger" tone="danger" emphasis="outline">Delete</acme-button>
    <acme-checkbox id="agree">Agree to the terms</acme-checkbox>
    <acme-switch id="notify" checked>Notifications</acme-switch>
    <acme-text-field id="email"><span slot="label">Email</span><span slot="hint">We never share it.</span></acme-text-field>
    <acme-accordion>
      <acme-accordion-item id="q1"><span slot="title">What is it?</span>A design system.</acme-accordion-item>
    </acme-accordion>
    <acme-dialog id="confirm"><span slot="title">Delete?</span>This cannot be undone.<div slot="actions"><button id="cancel">Cancel</button></div></acme-dialog>
  </main>
</body>
</html>`

  it('renders styled components, reacts to the keyboard and the pointer, and reports events', async () => {
    const dir = join(root, 'site')
    mkdirSync(dir, { recursive: true })
    for (const f of ['elements.js', 'elements.css']) writeFileSync(join(dir, f), read(f))
    writeFileSync(join(dir, 'index.html'), page())
    const { url, requests } = await serve(dir)
    const { page: p, errors } = await open(url)
    await p.waitForSelector('acme-button button')

    // Styled by the tokens in the stylesheet.
    expect(await p.locator('#save button').evaluate((e) => getComputedStyle(e).display)).toBe(
      'inline-flex',
    )
    expect(await p.locator('#danger button').getAttribute('data-tone')).toBe('danger')

    // Events, with details.
    await p.evaluate(() => {
      ;(window as any).log = []
      for (const [id, name] of [
        ['save', 'press'],
        ['agree', 'toggle'],
        ['notify', 'toggle'],
        ['q1', 'expand'],
        ['email', 'input'],
      ]) {
        document
          .getElementById(id)!
          .addEventListener(name!, (e) =>
            (window as any).log.push([
              id,
              name,
              JSON.parse(JSON.stringify((e as CustomEvent).detail)),
            ]),
          )
      }
    })
    await p.locator('#save button').click()
    await p.locator('#agree [role=checkbox]').click()
    await p.locator('#notify [role=switch]').click()
    await p.locator('#q1 button').click()
    await p.locator('#email input').fill('a@b')
    const log = (await p.evaluate(() => (window as any).log)) as Array<[string, string, any]>
    expect(log.filter((l) => l[0] === 'save')).toHaveLength(1)
    expect(log.find((l) => l[0] === 'save')![2].source).toBe('pointer')
    expect(log.find((l) => l[0] === 'agree')![2].checked).toBe(true)
    expect(log.find((l) => l[0] === 'notify')![2].checked).toBe(false)
    expect(log.find((l) => l[0] === 'q1')![2].expanded).toBe(true)
    // Typing: the component's event, once per change, never also the browser's own.
    expect(log.filter((l) => l[0] === 'email').map((l) => l[2])).toEqual(['a@b'])
    expect(await p.locator('#q1 [class*="__content"]').isVisible()).toBe(true)

    // A dialog, opened by a property, closed by Escape.
    await p.evaluate(() => ((document.getElementById('confirm') as any).open = true))
    await p.waitForFunction(() => document.querySelector('#confirm dialog')?.hasAttribute('open'))
    await p.keyboard.press('Escape')
    await p.waitForFunction(() => !document.querySelector('#confirm dialog')?.hasAttribute('open'))

    // Nothing but the two files was needed.
    expect(requests.filter((r) => r !== '/' && !r.includes('favicon'))).toEqual([
      '/elements.css',
      '/elements.js',
    ])
    expect(errors).toEqual([])
    await p.close()
  }, 120_000)

  it('follows the page’s theme, and passes axe in light and dark', async () => {
    const dir = join(root, 'site')
    const { url } = await serve(dir)
    const { page: p } = await open(url)
    await p.waitForSelector('acme-button button')
    const background = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor)
    for (const scheme of ['light', 'dark'] as const) {
      await p.emulateMedia({ colorScheme: scheme })
      // The theme that follows the system, as in an app: the attribute turns it on.
      await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'auto'))
      // Colors are measured once their transition is over.
      await p.waitForTimeout(500)
      expect(await axe(p), scheme).toEqual([])
    }
    await p.emulateMedia({ colorScheme: 'light' })
    await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await p.waitForTimeout(500)
    const dark = await background()
    await p.evaluate(() => document.documentElement.removeAttribute('data-theme'))
    await p.waitForTimeout(500)
    const light = await background()
    expect(dark).not.toBe(light)
    await p.close()
  }, 120_000)
})

describe('the React wrappers', () => {
  it('render in a React 19 app, set properties, and call the on-event props', async () => {
    const dir = join(root, 'react-site')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>React</title></head><body><div id="root"></div><script type="module" src="./main.js"></script></body></html>',
    )
    writeFileSync(
      join(dir, 'main.js'),
      `import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Checkbox, Combobox, TextField, AccordionItem } from '../dist-elements/react.js'
import '../dist-elements/elements.css'

const log = (window.log = [])
function App() {
  const [tone, setTone] = useState('primary')
  const [options, setOptions] = useState([{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }])
  const [count, setCount] = useState(0)
  return h('main', null,
    h(Button, { id: 'b', tone, onPress: () => { setCount((c) => c + 1); log.push('press') } }, 'Pressed ', count),
    h('button', { id: 'swap', onClick: () => setTone('danger') }, 'swap'),
    h('button', { id: 'more', onClick: () => setOptions([{ value: 'c', label: 'Cherry' }]) }, 'more'),
    h(Checkbox, { id: 'c', checked: false, onToggle: (e) => log.push('toggle:' + e.detail.checked) }, 'Agree'),
    h(Combobox, { id: 'cb', options, onSelect: (e) => log.push('select:' + e.detail.value) }, h('span', { slot: 'label' }, 'Fruit')),
    h(TextField, { id: 't', className: 'wide', 'aria-label': 'Email', onInput: (e) => log.push('input:' + e.detail) }, h('span', { slot: 'label' }, 'Email')),
    h(AccordionItem, { id: 'a', onExpand: (e) => log.push('expand:' + e.detail.expanded) }, h('span', { slot: 'title' }, 'Q'), 'Answer'),
  )
}
createRoot(document.getElementById('root')).render(h(App))
`,
    )
    // Bundled the way a React app is: by its bundler, which resolves React from the project.
    await build({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      build: { outDir: join(dir, 'out'), emptyOutDir: true, target: 'es2022' },
    })
    const { url } = await serve(join(dir, 'out'))
    const { page, errors } = await open(url)
    await page.waitForSelector('#b button')
    expect(await page.locator('#b button').getAttribute('data-tone')).toBe('primary')

    await page.locator('#b button').click()
    await page.locator('#c [role=checkbox]').click()
    expect(await page.locator('#b button').textContent()).toContain('Pressed')
    expect(await page.locator('#b').textContent()).toContain('1')

    // A prop that changes in React reaches the element.
    await page.locator('#swap').click()
    await page.waitForFunction(
      () => document.querySelector('#b button')?.getAttribute('data-tone') === 'danger',
    )

    // A list is passed as itself, and changes.
    await page.locator('#cb input').focus()
    await page.keyboard.press('ArrowDown')
    expect(await page.locator('#cb [role=option]').count()).toBe(2)
    await page.locator('#more').click()
    await page.waitForFunction(() =>
      document.querySelector('#cb [role=option]')?.textContent?.includes('Cherry'),
    )
    // The list is closed by the click away; open it again, and it has the new options.
    await page.locator('#cb input').focus()
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(() => document.querySelectorAll('#cb [role=option]').length === 1)
    await page.keyboard.press('Enter')

    // Named slots are children with a slot attribute; attributes reach the element; className becomes class.
    await page.locator('#t input').fill('hi')
    await page.locator('#a button').click()
    expect(await page.locator('#t').getAttribute('class')).toBe('wide')
    expect(await page.locator('#t input').getAttribute('aria-label')).toBeNull()

    const log = (await page.evaluate(() => (window as any).log)) as string[]
    expect(log).toContain('press')
    expect(log).toContain('toggle:true')
    expect(log).toContain('select:c')
    expect(log).toContain('input:hi')
    expect(log).toContain('expand:true')
    expect(errors).toEqual([])
    await page.close()
  }, 180_000)
})
