/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import './base.css'
import { page } from 'vitest/browser'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import { flush, getRenderer } from '@tessera/core'
import { FRAMEWORKS, GROUPS, STATUS_LABEL, type Status } from './data/compare'
import Layout from './layouts/default.tess'
import Compare from './pages/compare.tess'

const r = getRenderer()
let dispose: (() => void) | undefined
let root: HTMLElement

const open = async (width = 1280, height = 900) => {
  await page.viewport(width, height)
  root = document.createElement('div')
  document.body.append(root)
  dispose = r.mount(root, () => Layout({ slots: { default: () => [Compare()] } }))
  flush()
  await new Promise((resolve) => setTimeout(resolve, 100))
}

afterEach(async () => {
  dispose?.()
  document.body.innerHTML = ''
  await page.viewport(1280, 900)
})

const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none'
const rows = GROUPS.flatMap((g) => g.rows)

describe('the data of the comparison', () => {
  it('has a cell for every framework in every row, and says what each is in words', () => {
    expect(FRAMEWORKS.map((f) => f.name)).toEqual(['Tessera', 'React', 'Vue', 'Svelte'])
    for (const row of rows) {
      for (const f of FRAMEWORKS) {
        const cell = row.cells[f.id]
        expect(cell, `${row.feature}: ${f.name}`).toBeDefined()
        expect(cell.text.length, `${row.feature}: ${f.name}`).toBeGreaterThan(3)
        expect(STATUS_LABEL[cell.status as Status]).toBeTruthy()
      }
    }
  })

  it('does not claim what Tessera does not have: a planned or missing feature says so', () => {
    const says = (feature: string) => rows.find((r) => r.feature === feature)!.cells.tessera
    expect(says('Forms and validation').status).toBe('none')
    expect(says('Server code').status).toBe('none')
    expect(says('Translations').status).toBe('none')
    expect(says('Type-checked templates').status).toBe('planned')
    expect(says('Server rendering').status).toBe('partial')
  })
})

describe('the comparison page, on a wide screen', () => {
  it('has one h1, a table with a caption, and a column for each framework', async () => {
    await open()
    expect(root.querySelectorAll('h1')).toHaveLength(1)
    expect(root.querySelector('h1')!.textContent).toBe('Tessera next to React, Vue and Svelte.')
    const table = root.querySelector('table')!
    expect(shown(table)).toBe(true)
    expect(table.querySelector('caption')!.textContent!.trim()).toBe(
      'Features of Tessera, React, Vue and Svelte compared',
    )
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent!.trim())
    expect(heads).toEqual(['Feature', 'Tessera', 'React', 'Vue', 'Svelte'])
  })

  it('has a row for every feature, with a cell for each framework, each with a word for its status', async () => {
    await open()
    const body = [...root.querySelectorAll('table tbody tr')].filter((tr) => tr.querySelector('td'))
    expect(body).toHaveLength(rows.length)
    for (const tr of body) {
      const cells = [...tr.querySelectorAll('td')]
      expect(cells).toHaveLength(4)
      for (const td of cells)
        expect(td.textContent).toMatch(/Built in|Partly|Via a library|Planned|No/)
    }
    const groups = [...root.querySelectorAll('table th[scope="colgroup"]')].map((th) =>
      th.textContent!.trim(),
    )
    expect(groups).toEqual(GROUPS.map((g) => g.title))
  })

  it('sets Tessera apart in the head and in each row, and explains the marks', async () => {
    await open()
    expect(root.querySelectorAll('th[data-lead="true"]')).toHaveLength(1)
    expect(root.querySelectorAll('td[data-lead="true"]')).toHaveLength(rows.length)
    const legend = root.querySelector('ul[aria-label="Key to the marks"]')!
    expect(legend.querySelectorAll('li')).toHaveLength(5)
    expect(legend.textContent).toContain('Not available, or not a goal.')
  })

  it('says it is a small framework on purpose, with the date, and where to report a mistake', async () => {
    await open()
    expect(root.textContent).toContain('A small framework, on purpose.')
    expect(root.textContent).toContain('as of October 2026')
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs).toContain('https://github.com/pixelscript-io/tessera/issues')
    expect(hrefs).toContain('https://tessera-docs.pixelscript.io/quick-start')
  })

  it('has the nav of the home page, linking to its sections and to this page', async () => {
    await open()
    const hrefs = [...root.querySelectorAll('header nav a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/compare')
    // With no router running the page is the home page, so the sections are anchors; the prerender test below covers /compare.
    expect(hrefs.filter((h) => h!.endsWith('#data'))).toHaveLength(1)
  })

  it('has no axe violations', async () => {
    await open()
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
})

describe('the comparison page, on a phone', () => {
  for (const width of [320, 390, 600, 800]) {
    it(`does not scroll sideways at ${width}px`, async () => {
      await open(width)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      )
    })
  }

  it('shows a card for each feature, with each framework named, instead of the table', async () => {
    await open(390)
    expect(shown(root.querySelector('table')!.parentElement)).toBe(false)
    const cards = root.querySelectorAll('article')
    expect(cards).toHaveLength(rows.length)
    expect(shown(cards[0]!)).toBe(true)
    const names = [...cards[0]!.querySelectorAll('dt')].map((dt) => dt.textContent)
    expect(names).toEqual(['Tessera', 'React', 'Vue', 'Svelte'])
    expect([...root.querySelectorAll('h2')].map((h) => h.textContent!.trim())).toContain(
      GROUPS[0]!.title,
    )
  })

  it('has no axe violations', async () => {
    await open(390)
    const results = await axe.run(document.body, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] },
    })
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 80)).join(' | ')}`,
      ),
    ).toEqual([])
  })
})
