/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import './base.css'
import { page, userEvent } from 'vitest/browser'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flush, getRenderer } from '@tessera/core'
import Layout from './layouts/default.tess'
import Page from './pages/index.tess'

const r = getRenderer()
let dispose: (() => void) | undefined
let root: HTMLElement

const open = async (width: number, height = 800) => {
  await page.viewport(width, height)
  root = document.createElement('div')
  document.body.append(root)
  dispose = r.mount(root, () => Layout({ slots: { default: () => [Page()] } }))
  flush()
  await new Promise((resolve) => setTimeout(resolve, 100))
}

beforeEach(() => {
  root = document.body
})

afterEach(async () => {
  dispose?.()
  document.body.innerHTML = ''
  await page.viewport(1280, 900)
})

const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none'
const section = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!

describe('on a phone', () => {
  for (const width of [320, 360, 390, 430, 600]) {
    it(`does not scroll sideways at ${width}px`, async () => {
      await open(width)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      )
    })
  }

  it('has a header that is one short row: the name, and the three links', async () => {
    await open(390)
    const header = root.querySelector('header')!
    expect(header.getBoundingClientRect().height).toBeLessThan(70)
    const brand = header.querySelector('a')!.getBoundingClientRect()
    const links = [...header.querySelectorAll('[class*="__links"] a')].map((a) =>
      a.getBoundingClientRect(),
    )
    expect(links).toHaveLength(3)
    // The name and the links share the one row, and every link is on the screen.
    for (const link of links) {
      expect(Math.abs(brand.top - link.top)).toBeLessThan(20)
      expect(link.right).toBeLessThanOrEqual(390)
    }
  })

  it('has a banner for Tessera UI that fits the screen and wraps', async () => {
    await open(390)
    const banner = root.querySelector('aside')!
    const box = banner.getBoundingClientRect()
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(390)
    expect(banner.scrollWidth).toBeLessThanOrEqual(390)
    expect(box.height).toBeLessThan(260)
  })

  it('keeps the copy button inside the screen, with its command wrapped and left aligned', async () => {
    await open(390)
    const copy = root.querySelector<HTMLButtonElement>('section button[type="button"]')!
    const box = copy.getBoundingClientRect()
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(390)
    expect(getComputedStyle(copy.querySelector('[class*="__command"]')!).textAlign).toBe('left')
  })

  it('lays the docs demo out in one column, with its sidebar as a row of pages above the preview', async () => {
    await open(390)
    const body = section('docs').querySelector<HTMLElement>('[class*="__body"]')!
    expect(getComputedStyle(body).gridTemplateColumns.split(' ')).toHaveLength(1)
    const sidebar = body.firstElementChild as HTMLElement
    const pageBox = body.lastElementChild!.getBoundingClientRect()
    expect(sidebar.getBoundingClientRect().bottom).toBeLessThanOrEqual(pageBox.top + 1)
    expect(getComputedStyle(sidebar).flexDirection).toBe('row')
  })

  it('stacks the package layers, label above chips', async () => {
    await open(390)
    const layer = section('packages').querySelector<HTMLElement>('[class*="__layer"]')!
    const label = layer.children[0]!.getBoundingClientRect()
    const chips = layer.children[1]!.getBoundingClientRect()
    expect(chips.top).toBeGreaterThanOrEqual(label.bottom - 1)
  })

  it('has no axe violations as a whole page', async () => {
    await open(390)
    const results = await axe.run(document.body, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    })
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 80)).join(' | ')}`,
      ),
    ).toEqual([])
  })

  it('has targets that are big enough to touch: every button is at least 24px tall (WCAG 2.2)', async () => {
    await open(390)
    const small = [...root.querySelectorAll('button')]
      .filter(
        (b) =>
          shown(b) && b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 24,
      )
      .map((b) => `${b.textContent!.trim()} ${Math.round(b.getBoundingClientRect().height)}px`)
    expect(small).toEqual([])
  })
})

describe('the token diagram on a phone', () => {
  it('is a stack that reads top to bottom, not a drawing at a width', async () => {
    await open(390)
    const flow = section('interchange')
    expect(shown(flow.querySelector('[class*="__diagram"]'))).toBe(false)
    const stack = flow.querySelector<HTMLElement>('[class*="__stack"]')!
    expect(shown(stack)).toBe(true)
    expect(stack.querySelectorAll('button')).toHaveLength(9)
    // Imports, then the system, then exports.
    const buttons = [...stack.querySelectorAll('button')]
    const centre = stack.querySelector('[class*="__stackCenter"]')!
    const before = (a: Node, b: Node) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(stack.firstElementChild!.textContent).toBe('Import from')
    expect(before(buttons[4]!, centre)).toBe(true)
    expect(before(centre, buttons[5]!)).toBe(true)
    expect(stack.getBoundingClientRect().right).toBeLessThanOrEqual(390)
  })

  it('opens the details of a format under it, and only one at a time', async () => {
    await open(390)
    const stack = section('interchange').querySelector<HTMLElement>('[class*="__stack"]')!
    const details = () => stack.querySelectorAll('[class*="__stackDetail"]')
    expect(details()).toHaveLength(1)
    expect(details()[0]!.textContent).toContain('Types and string values')
    const figma = [...stack.querySelectorAll('button')].find(
      (b) => b.textContent!.trim() === 'Figma variables',
    )!
    await userEvent.click(figma)
    expect(details()).toHaveLength(1)
    expect(figma.getAttribute('aria-pressed')).toBe('true')
    expect(figma.nextElementSibling!.textContent).toContain('Collections become token groups')
    expect(figma.nextElementSibling!.textContent).toContain(
      'npx tessera tokens import path/to/figma-export',
    )
    // The desktop card is not shown twice.
    expect(shown(section('interchange').querySelector('[class*="__card"]'))).toBe(false)
  })

  it('has buttons a thumb can hit', async () => {
    await open(390)
    const stack = section('interchange').querySelector<HTMLElement>('[class*="__stack"]')!
    for (const b of stack.querySelectorAll('button'))
      expect(b.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  })
})

describe('on a computer', () => {
  it('draws the diagram, and does not show the phone stack', async () => {
    await open(1280, 900)
    const flow = section('interchange')
    expect(shown(flow.querySelector('[class*="__diagram"]'))).toBe(true)
    expect(shown(flow.querySelector('[class*="__stack"]'))).toBe(false)
    expect(shown(flow.querySelector('[class*="__card"]'))).toBe(true)
  })

  it('has the header on one row, and the docs demo with its sidebar beside the preview', async () => {
    await open(1280, 900)
    expect(root.querySelector('header')!.getBoundingClientRect().height).toBeLessThan(70)
    const body = section('docs').querySelector<HTMLElement>('[class*="__body"]')!
    expect(getComputedStyle(body).gridTemplateColumns.split(' ')).toHaveLength(2)
  })

  it('switches between the two at 720px', async () => {
    await open(721)
    expect(shown(section('interchange').querySelector('[class*="__diagram"]'))).toBe(true)
    dispose?.()
    root.remove()
    await open(720)
    expect(shown(section('interchange').querySelector('[class*="__diagram"]'))).toBe(false)
  })
})
