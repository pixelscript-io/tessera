/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import './base.css'
import { userEvent } from 'vitest/browser'
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
  it('is the version of the published package, in the footer', () => {
    expect(VERSION).toBe(pkg.version)
    expect(SHORT_VERSION).toBe(`v${pkg.version.split('.').slice(0, 2).join('.')}`)
    expect(root.textContent).toContain(SHORT_VERSION)
    expect(root.querySelector('footer')!.textContent).toContain(`Tessera ${SHORT_VERSION}`)
  })
})

describe('the page', () => {
  it('has one h1 and a main landmark, and a nav of the name and three links', () => {
    expect(root.querySelectorAll('h1')).toHaveLength(1)
    expect(root.querySelector('h1')!.textContent).toBe('The design system is the framework.')
    expect(root.querySelectorAll('main')).toHaveLength(1)
    const nav = root.querySelector('header nav')!
    expect(
      [...nav.querySelectorAll('[class*="__links"] a')].map((a) => a.textContent!.trim()),
    ).toEqual(['Docs', 'Compare', 'Tessera UI'])
    // The way to Tessera UI is its own site.
    expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain(
      'https://tessera-ui.pixelscript.io',
    )
  })

  it('opens with a banner that introduces Tessera UI and links to it', () => {
    const banner = root.querySelector('aside[aria-label="Tessera UI"]')!
    expect(banner).not.toBeNull()
    expect(banner.textContent).toContain('Tessera UI')
    expect(banner.textContent).toContain('tessera add Button')
    expect(banner.querySelector('a')!.getAttribute('href')).toBe(
      'https://tessera-ui.pixelscript.io',
    )
    // It is the first thing on the page, above the nav.
    expect(
      banner.compareDocumentPosition(root.querySelector('header')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows an API call, the file that names the server, and the compiler check, in tabs', async () => {
    const data = section('data')
    expect(data.querySelector('h2')!.textContent).toBe('An API call is one line.')
    const tabs = [...data.querySelectorAll('[role=tab]')].map((t) => t.textContent!.trim())
    expect(tabs).toEqual(['profile.tess', 'app/apis/github.ts', 'tessera check'])
    expect(data.textContent).toContain('github.get(')
    await userEvent.click(button(data, 'tessera check'))
    flush()
    const visible = [...data.querySelectorAll<HTMLElement>('[role=tabpanel]')].find(
      (p) => !p.hidden,
    )!
    expect(visible.textContent).toContain('T5006')
    expect(visible.textContent).toContain('Did you mean')
  })

  it('shows shared state: the file, two components, and the compiler check, in tabs', async () => {
    const state = section('state')
    expect(state.querySelector('h2')!.textContent).toBe('Sharing data is a file.')
    const tabs = [...state.querySelectorAll('[role=tab]')].map((t) => t.textContent!.trim())
    expect(tabs).toEqual(['app/state/cart.ts', 'two components', 'tessera check'])
    await userEvent.click(button(state, 'tessera check'))
    flush()
    const visible = [...state.querySelectorAll<HTMLElement>('[role=tabpanel]')].find(
      (p) => !p.hidden,
    )!
    expect(visible.textContent).toContain('T5011')
    expect(visible.textContent).toContain('T5012')
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
    expect(copy.textContent).toContain('npm install @pixelscriptio/tessera@latest')
    expect(copy.textContent).toContain('Copy')
    await userEvent.click(copy)
    expect(writeText).toHaveBeenCalledWith('npm install @pixelscriptio/tessera@latest')
    expect(copy.textContent).toContain('Copied')
    await settle(1700)
    expect(copy.textContent).not.toContain('Copied')
  })
})

describe('the code window', () => {
  const windowOf = (label: string) => {
    const list = root.querySelector<HTMLElement>(`[role="tablist"][aria-label="${label}"]`)!
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')]
    const panels = () => [...list.parentElement!.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
    return {
      tabs,
      shown: () => panels().map((p) => !p.hidden),
      visible: () => panels().find((p) => !p.hidden)!,
    }
  }

  it('shows the panel of the tab that is chosen, with the keyboard or the pointer', async () => {
    const { tabs, shown, visible } = windowOf('How it reads')
    expect(shown()).toEqual([true, false, false])
    await userEvent.click(tabs[1]!)
    expect(shown()).toEqual([false, true, false])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    tabs[1]!.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(shown()).toEqual([false, false, true])
    expect(document.activeElement).toBe(tabs[2])
    expect(shown().filter(Boolean)).toHaveLength(1)
    // The text of the last tab is what asks the compiler.
    expect(visible().textContent).toContain('validate_snippet')
  })

  it('says how to use the elements in each framework, in tabs of their own', async () => {
    const { tabs, shown, visible } = windowOf('Use the elements in your framework')
    expect(tabs.map((t) => t.textContent!.trim())).toEqual([
      'HTML',
      'React',
      'Vue',
      'Svelte',
      'Angular',
    ])
    expect(visible().textContent).toContain('elements.css')
    await userEvent.click(tabs[2]!)
    expect(shown()).toEqual([false, false, true, false, false])
    expect(visible().textContent).toContain('isCustomElement')
    await userEvent.click(tabs[4]!)
    expect(visible().textContent).toContain('CUSTOM_ELEMENTS_SCHEMA')
    await userEvent.click(tabs[1]!)
    expect(visible().textContent).toContain('./dist-elements/react.js')
  })

  it('keeps the ids of the two windows apart', () => {
    const ids = [...root.querySelectorAll('[id]')].map((e) => e.id)
    expect(ids.length).toBeGreaterThan(10)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the two ways in', () => {
  it('starts a project with the command that always gets the latest release, and generates the docs', () => {
    const cards = [...root.querySelectorAll('section')[1]!.children[0]!.children]
    expect(cards[0]!.textContent).toContain('npm create @pixelscriptio/tessera@latest my-app')
    expect(cards[1]!.textContent).toContain('Generate your docs')
    expect(cards[1]!.textContent).toContain('npx tessera docs --static')
    expect(root.textContent).not.toContain('Adopt in an existing app')
  })

  it('gives every npm install and create command @latest', () => {
    const text = root.textContent!
    for (const m of text.matchAll(/npm (?:install|create) @pixelscriptio\/[\w-]+\S*/g))
      expect(m[0], m[0]).toContain('@latest')
  })
})

describe('the footer', () => {
  it('says whose project it is, with the mark, and links to their site', () => {
    const credit = root.querySelector<HTMLAnchorElement>('footer a[href="https://pixelscript.io"]')!
    expect(credit.textContent).toContain('A PixelScript project')
    const logo = credit.querySelector('svg')!
    expect(logo.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(logo.getAttribute('aria-hidden')).toBe('true')
    expect(logo.querySelectorAll('path')).toHaveLength(10)
    const fills = new Set([...logo.querySelectorAll('path')].map((p) => getComputedStyle(p).fill))
    expect(fills.size).toBe(10)
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
