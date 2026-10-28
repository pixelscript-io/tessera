import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { buildDocsData, renderMarkdown } from '../src'

const root = fileURLToPath(new URL('../../../examples/kitchen-sink', import.meta.url))
const data = buildDocsData(new Project(root, { today: '2026-10-22' }), {
  liveModule: (name, i) => `/live/${name}-${i}.tess`,
  report: { a11y: { generated: ['Button'] } },
})
const component = (name: string) => data.components.find((c) => c.name === name)!

describe('the docs data', () => {
  it('has a page of data for every component, system, app and router', () => {
    expect(data.components.map((c) => [c.name, c.origin])).toEqual([
      ['Accordion', 'system'],
      ['AccordionItem', 'system'],
      ['Alert', 'system'],
      ['Avatar', 'system'],
      ['Badge', 'system'],
      ['Button', 'system'],
      ['Card', 'system'],
      ['CartAdd', 'app'],
      ['CartCount', 'app'],
      ['Checkbox', 'system'],
      ['Combobox', 'system'],
      ['ConfirmBar', 'app'],
      ['Counter', 'app'],
      ['Dialog', 'system'],
      ['Form', 'system'],
      ['FormField', 'system'],
      ['Icon', 'system'],
      ['Kbd', 'system'],
      ['Link', 'router'],
      ['Popover', 'system'],
      ['Progress', 'system'],
      ['Quote', 'app'],
      ['RadioGroup', 'system'],
      ['Select', 'system'],
      ['Separator', 'system'],
      ['SiteNav', 'app'],
      ['Skeleton', 'system'],
      ['Spinner', 'system'],
      ['Switch', 'system'],
      ['TaskList', 'app'],
      ['Textarea', 'system'],
      ['TextField', 'system'],
      ['Tooltip', 'system'],
    ])
    expect(data.hasTokens).toBe(true)
  })

  it('lists the tokens a component’s styles use, and only real ones', () => {
    const used = component('Button').usedTokens
    expect(used.length).toBeGreaterThan(3)
    expect(used).toContain('color.action.primary.bg')
    const known = new Set(data.tokens.entries.map((t) => t.path))
    expect(used.every((t) => known.has(t))).toBe(true)
  })

  it('carries each token with its value in every scope and the alias it came from', () => {
    const bg = data.tokens.entries.find((t) => t.path === 'color.action.primary.bg')!
    expect(bg.tier).toBe('semantic')
    expect(Object.keys(bg.values)).toEqual(['base', 'density=compact', 'theme=dark'])
    expect(bg.values['base']!.alias).toBe('color.blue.600')
    expect(bg.values['base']!.resolved).toMatch(/^(#[0-9a-f]{6}|rgb\()/)
    expect(data.tokens.scopes).toEqual(['base', 'density=compact', 'theme=dark'])
  })

  it('measures contrast of text on the backgrounds it is used with, in every theme', () => {
    const rows = data.tokens.contrast.filter(
      (r) => r.foreground === 'color.text.default' && r.background === 'color.surface.default',
    )
    expect(rows.map((r) => r.scope)).toEqual(['base', 'theme=dark'])
    expect(rows.every((r) => r.ratio > 4.5 && r.passes)).toBe(true)
  })

  it('says whether a generated accessibility suite covers a component, only when it was told', () => {
    expect(component('Button').a11yGenerated).toBe(true)
    expect(component('Counter').a11yGenerated).toBe(false)
    const without = buildDocsData(new Project(root, { today: '2026-10-22' }), {
      liveModule: () => '',
    })
    expect(without.components[0]!.a11yGenerated).toBeUndefined()
  })

  it('renders the prose of a Name.docs.md beside the component, with its live examples', () => {
    const prose = component('Button').prose!
    expect(prose.file).toBe('system/components/Button.docs.md')
    expect(prose.html).toContain('<h1>Using Button</h1>')
    expect(prose.html).toContain('data-live="0"')
    expect(prose.live).toEqual([
      {
        source: expect.stringContaining('<Button>Primary</Button>'),
        module: '/live/Button-0.tess',
      },
    ])
    expect(component('Counter').prose).toBeUndefined()
  })

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(data))).toEqual(data)
  })
})

describe('the Markdown renderer', () => {
  it('renders headings, paragraphs, lists, quotes and inline formatting', () => {
    const { html } = renderMarkdown(
      '# Title\n\nSome **bold** and *soft* text with `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n',
    )
    expect(html).toBe(
      [
        '<h1>Title</h1>',
        '<p>Some <strong>bold</strong> and <em>soft</em> text with <code>code</code>.</p>',
        '<ul><li>one</li><li>two</li></ul>',
        '<ol><li>first</li><li>second</li></ol>',
        '<blockquote>quoted</blockquote>',
      ].join('\n'),
    )
  })

  it('escapes markup, so prose can never inject any', () => {
    const { html } = renderMarkdown(
      '<script>alert(1)</script> and `<b>`\n\n```html\n<img onerror=x>\n```',
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<code>&lt;b&gt;</code>')
    expect(html).toContain('&lt;img onerror=x&gt;')
  })

  it('only links to places that are safe', () => {
    expect(
      renderMarkdown('[a](https://x.dev) [b](#/components/Button) [c](javascript:alert(1))').html,
    ).toBe(
      '<p><a href="https://x.dev">a</a> <a href="#/components/Button">b</a> [c](javascript:alert(1))</p>',
    )
  })

  it('turns a tess live block into a placeholder, and returns its source', () => {
    const { html, live } = renderMarkdown(
      'Before\n\n```tess live\n<template><p>Hi</p></template>\n```\n\nAfter',
    )
    expect(live).toEqual([{ source: '<template><p>Hi</p></template>' }])
    expect(html).toContain('<div class="docs-live" data-live="0"></div>')
    expect(html).toContain('<details><summary>Source</summary>')
    expect(html).toContain('<p>After</p>')
  })
})
