/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import './base.css'
import { userEvent } from '@vitest/browser/context'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flush, getRenderer } from '@tessera/core'
import Layout from './layouts/default.tess'
import Page from './pages/index.tess'
import { SHORT_VERSION, VERSION } from './version'
import pkg from '../../packages/tessera/package.json'

const r = getRenderer()
let dispose: (() => void) | undefined
let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  dispose = r.mount(root, () => Layout({ slots: { default: () => [Page()] } }))
  flush()
})

afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))
const button = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll('button')].find(
    (b) => b.textContent!.trim() === label,
  ) as HTMLButtonElement
const section = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!

describe('the version on the page', () => {
  it('is the version of the published package, in the banner and the footer', () => {
    expect(VERSION).toBe(pkg.version)
    expect(SHORT_VERSION).toBe(`v${pkg.version.split('.').slice(0, 2).join('.')}`)
    expect(root.textContent).toContain(SHORT_VERSION)
    expect(root.querySelector('footer')!.textContent).toContain(`Tessera ${SHORT_VERSION}`)
  })
})

describe('the page', () => {
  it('has one h1, a main landmark, and every section the nav links to', () => {
    expect(root.querySelectorAll('h1')).toHaveLength(1)
    expect(root.querySelector('h1')!.textContent).toBe('The design system is the framework.')
    expect(root.querySelectorAll('main')).toHaveLength(1)
    for (const a of root.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]'))
      expect(root.querySelector(a.getAttribute('href')!), a.getAttribute('href')!).not.toBeNull()
  })

  it('sends the docs links to the docs site', () => {
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs).toContain('https://tessera-docs.pixelscript.io/quick-start')
    expect(hrefs).toContain('https://github.com/pixelscript-io/tessera')
  })

  it('has no axe violations as a whole page, apart from the fonts it loads from outside', async () => {
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

describe('the install command', () => {
  it('copies the command and says it did, then goes back to Copy', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const copy = root.querySelector<HTMLButtonElement>('section button[type="button"]')!
    expect(copy.textContent).toContain('npm install @pixelscriptio/tessera')
    expect(copy.textContent).toContain('Copy')
    await userEvent.click(copy)
    expect(writeText).toHaveBeenCalledWith('npm install @pixelscriptio/tessera')
    expect(copy.textContent).toContain('Copied')
    await settle(1700)
    expect(copy.textContent).not.toContain('Copied')
  })
})

describe('the code window', () => {
  it('shows the panel of the tab that is chosen, with the keyboard or the pointer', async () => {
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')]
    const panels = () =>
      [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')].map((p) => !p.hidden)
    expect(panels()).toEqual([true, false, false])
    await userEvent.click(tabs[1]!)
    expect(panels()).toEqual([false, true, false])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    tabs[1]!.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(panels()).toEqual([false, false, true])
    expect(document.activeElement).toBe(tabs[2])
    expect(panels().filter(Boolean)).toHaveLength(1)
    // The text of the last tab is what asks the compiler.
    expect(root.querySelector('[role="tabpanel"]:not([hidden])')!.textContent).toContain(
      'validate_snippet',
    )
  })
})

describe('the package explorer', () => {
  const name = () => section('packages').querySelector('[aria-live] span')!.textContent
  it('shows the package under the pointer, and goes back to the chosen one', async () => {
    const packages = section('packages')
    expect(name()).toBe('@tessera/compiler')
    await userEvent.hover(button(packages, 'core'))
    expect(name()).toBe('@tessera/core')
    // Leaving is its own event; moving the pointer away could land it on the next chip.
    button(packages, 'core').dispatchEvent(new MouseEvent('mouseleave'))
    flush()
    expect(name()).toBe('@tessera/compiler')
    await userEvent.click(button(packages, 'cli'))
    expect(name()).toBe('@tessera/cli')
    expect(packages.querySelector('[aria-live]')!.textContent).toContain(
      'Depends on agent, compiler',
    )
    expect(button(packages, 'cli').getAttribute('aria-pressed')).toBe('true')
  })

  it('marks what the chosen package depends on and what uses it', async () => {
    const packages = section('packages')
    await userEvent.click(button(packages, 'core'))
    expect(button(packages, 'core').dataset.state).toBe('selected')
    expect(button(packages, 'router').dataset.state).toBe('user')
    expect(button(packages, 'create-tessera').dataset.state).toBe('idle')
    await userEvent.click(button(packages, 'router'))
    expect(button(packages, 'core').dataset.state).toBe('dependency')
  })
})

describe('the docs demo', () => {
  it('changes the preview with each control, and the theme only of the stage', async () => {
    const docs = section('docs')
    const stage = docs.querySelector<HTMLElement>('[data-theme]')!
    const preview = docs.querySelector<HTMLElement>('button[data-tone][data-size]')!
    expect([stage.dataset.theme, preview.dataset.tone, preview.dataset.size]).toEqual([
      'light',
      'primary',
      'md',
    ])
    await userEvent.click(button(docs, 'Dark'))
    await userEvent.click(button(docs, 'danger'))
    await userEvent.click(button(docs, 'lg'))
    expect([stage.dataset.theme, preview.dataset.tone, preview.dataset.size]).toEqual([
      'dark',
      'danger',
      'lg',
    ])
    expect(document.documentElement.dataset.theme).toBeUndefined()
    await settle(400)
    expect(getComputedStyle(stage).backgroundColor).toBe('rgb(22, 23, 21)')
    expect(getComputedStyle(preview).backgroundColor).toBe('rgb(185, 28, 28)')
  })
})

describe('the token diagram', () => {
  it('is an svg in the svg namespace, drawn at the width it has, with one link and one dot for each format', async () => {
    const flow = section('interchange')
    const svg = flow.querySelector('svg')!
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(flow.querySelectorAll('svg path')).toHaveLength(9)
    expect(flow.querySelectorAll('svg circle animateMotion')).toHaveLength(9)
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+ 340$/)
    const stage = svg.parentElement as HTMLElement
    stage.style.width = '700px'
    await settle(100)
    expect(svg.getAttribute('viewBox')).toBe('0 0 700 340')
  })

  it('shows the command of the format that is chosen, and highlights its link', async () => {
    const flow = section('interchange')
    expect(flow.querySelector('[aria-live]')!.textContent).toContain('Tokens Studio')
    await userEvent.click(button(flow, 'Manifest for AI tools'))
    expect(flow.querySelector('[aria-live]')!.textContent).toContain('Export')
    expect(flow.querySelector('[aria-live]')!.textContent).toContain('npx tessera manifest')
    expect(flow.querySelectorAll('svg path[data-on]')).toHaveLength(1)
    expect(button(flow, 'Manifest for AI tools').getAttribute('aria-pressed')).toBe('true')
  })
})
