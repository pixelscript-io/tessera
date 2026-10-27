import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { serveDocs } from '../src'

// A preview that is empty, broken or half there is a broken page. This opens the docs of a real project and visits the
// preview of every component it lists, library and app, and checks what a person would see: that it rendered, that
// every piece of sample content is on the page, and that the data the component needs reached it.
const repo = fileURLToPath(new URL('../../..', import.meta.url)).replaceAll('\\', '/')
// A copy of the kitchen-sink app, in a folder of its own: the docs reload when a file under their root changes, and other
// tests write into the kitchen-sink folder while this one runs.
const root = `${repo}examples/kitchen-sink/.docs-test-previews`
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
cpSync(`${repo}examples/kitchen-sink/app`, `${root}/app`, {
  recursive: true,
  filter: (src) => !/(\.browser\.test\.ts|__screenshots__|seeded)/.test(src),
})
writeFileSync(
  `${root}/package.json`,
  JSON.stringify({
    name: 'previews',
    private: true,
    type: 'module',
    dependencies: { '@pixelscriptio/tessera': '*', '@pixelscriptio/tessera-ui': '*' },
  }),
)

type Node =
  | string
  | { component: string; slots?: Record<string, Node | Node[]> }
  | { tag: string; text?: string; children?: Node | Node[] }

const list = (content: Node | Node[] | undefined): Node[] =>
  content === undefined ? [] : Array.isArray(content) ? content : [content]

/** Every piece of text a preview's content puts on the page. */
function textsOf(content: Node | Node[] | undefined): string[] {
  return list(content).flatMap((node): string[] => {
    if (typeof node === 'string') return [node]
    if ('component' in node) return Object.values(node.slots ?? {}).flatMap((s) => textsOf(s))
    return [...(node.text ? [node.text] : []), ...textsOf(node.children)]
  })
}

/** Every component the content names, with how many times. */
function componentsIn(content: Node | Node[] | undefined, into = new Map<string, number>()) {
  for (const node of list(content)) {
    if (typeof node === 'string') continue
    if ('component' in node) {
      into.set(node.component, (into.get(node.component) ?? 0) + 1)
      for (const slot of Object.values(node.slots ?? {})) componentsIn(slot, into)
    } else componentsIn(node.children, into)
  }
  return into
}

const manifest = new Project(root).agentManifest()
let browser: Browser | undefined
let page: Page
let close: (() => Promise<void> | void) | undefined

beforeAll(async () => {
  const server = await serveDocs(root, { port: 0 })
  close = () => server.close()
  browser = await chromium.launch({ channel: 'msedge' })
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(server.resolvedUrls!.local[0]!)
  await page.waitForSelector('.docs-nav a', { timeout: 75_000 })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await close?.()
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})

/**
 * Run a step against the page, again if the page reloaded under it. The docs reload when a file in the project changes,
 * and other tests write into this folder while this one runs.
 */
async function steady<T>(step: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step()
    } catch (error) {
      const text = String(error)
      const reloaded = /Execution context was destroyed|Cannot read properties of null/.test(text)
      if (!reloaded || attempt >= 4) throw error
      await page.waitForLoadState('load')
    }
  }
}

/** The preview stage of a component, once it has settled. */
function stageOf(name: string, expected: string[] = []) {
  return steady(() => settledStage(name, expected))
}

async function settledStage(name: string, expected: string[]) {
  await page.evaluate((n) => (location.hash = `#/components/${n}`), name)
  // The page for this component, not the last one's, and its stage built: with all the sample text there, when the
  // sample has some. (The machine may be busy with other tests, so this waits instead of guessing.)
  await page.waitForFunction(
    ({ n, texts }) => {
      if (!location.hash.endsWith(`/${n}`)) return false
      const stage = document.querySelector('.docs-stage')
      if (!stage || stage.children.length === 0) return false
      return texts.every((t) => (stage.textContent ?? '').includes(t))
    },
    { n: name, texts: expected },
    { timeout: 45_000 },
  )
  // Styles arrive a moment after the markup: wait until something on the stage has a size (an overlay never will).
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.docs-stage *')].some((el) => {
          const box = el.getBoundingClientRect()
          return box.width > 0 && box.height > 0
        }),
      undefined,
      { timeout: 3_000 },
    )
    .catch(() => undefined)
  await page.waitForTimeout(100)
  return page.evaluate(() => {
    const stage = document.querySelector('.docs-stage') as HTMLElement
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }
    return {
      error: stage.querySelector('.docs-error')?.textContent ?? null,
      text: stage.textContent ?? '',
      sized: [...stage.querySelectorAll('*')].some(visible),
      // An overlay is not on the stage until it is opened: it has a button that opens it.
      trigger: document.querySelector('[id$="-trigger"]') !== null,
      classes: [...stage.querySelectorAll('[class]')].map((e) => e.getAttribute('class')!),
      options: stage.querySelectorAll('option, [role="option"], [role="radio"]').length,
      note: document.querySelector('.docs-note')?.textContent ?? null,
      // What the first control can change, so a control that does nothing is noticed.
      controls: document.querySelectorAll('.docs-controls label').length,
    }
  })
}

describe('the preview of every component', () => {
  for (const component of manifest.components) {
    it(`${component.name} shows itself, with its sample content and the data it needs`, async () => {
      const sampleSlots = ((component.preview ?? {}) as { slots?: Record<string, Node | Node[]> })
        .slots
      const stage = await stageOf(
        component.name,
        Object.values(sampleSlots ?? {}).flatMap((slot) => textsOf(slot)),
      )
      expect(stage.error, 'the preview raised an error').toBeNull()
      expect(stage.sized || stage.trigger, 'nothing in the preview has a size').toBe(true)

      const sample = (component.preview ?? {}) as {
        props?: Record<string, unknown>
        slots?: Record<string, Node | Node[]>
      }

      // Every piece of text the sample puts in a slot is on the page.
      for (const text of Object.values(sample.slots ?? {}).flatMap((s) => textsOf(s))) {
        expect(stage.text, `the slot text ${JSON.stringify(text)}`).toContain(text)
      }

      // Every component the sample nests was built, as many times as it is named.
      for (const [name, count] of componentsIn(Object.values(sample.slots ?? {}).flat())) {
        const roots = stage.classes.filter((c) => c.split(/\s+/).includes(`t-${name}__root`))
        expect(roots.length, `${name} in the preview`).toBeGreaterThanOrEqual(count)
      }

      // A list of options reached the component as options.
      const options = sample.props?.options
      if (Array.isArray(options)) {
        expect(stage.options, 'options in the preview').toBeGreaterThanOrEqual(options.length)
      }

      // A component that needs sample data has it: no notice that the preview is bare.
      expect(stage.note, 'the page says the preview has no sample data').toBeNull()
    }, 90_000)
  }
})

describe('an overlay in the docs', () => {
  it('opens from its button, covers the page, and closing it by Escape closes it in the controls too', async () => {
    await stageOf('Dialog')
    expect(await page.locator('dialog[open]').count()).toBe(0)
    await page.click('#ctl-Dialog-trigger')
    await page.waitForSelector('dialog[open]')
    expect(await page.locator('dialog[open]').textContent()).toContain('Delete project?')
    expect(await page.isChecked('#ctl-Dialog-open')).toBe(true)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelector('dialog[open]') === null)
    expect(await page.isChecked('#ctl-Dialog-open')).toBe(false)
    // Opened again, from the checkbox this time.
    await page.check('#ctl-Dialog-open')
    await page.waitForSelector('dialog[open]')
    await page.keyboard.press('Escape')
  }, 60_000)
})
