import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Project } from '../src/project-entry'

const root = fileURLToPath(new URL('../../../examples/kitchen-sink', import.meta.url))
const manifest = new Project(root, { today: '2026-10-22' }).agentManifest()
const component = (name: string) => manifest.components.find((c) => c.name === name)!

describe('the agent manifest: components', () => {
  it('lists every component, system and app, sorted by name', () => {
    expect(manifest.components.map((c) => c.name)).toEqual([
      'Accordion',
      'AccordionItem',
      'Alert',
      'Avatar',
      'Button',
      'CartAdd',
      'CartCount',
      'Checkbox',
      'Combobox',
      'ConfirmBar',
      'Counter',
      'Dialog',
      'Kbd',
      'Link',
      'Progress',
      'Quote',
      'Select',
      'Separator',
      'SiteNav',
      'Skeleton',
      'Spinner',
      'Switch',
      'TaskList',
      'TextField',
    ])
    expect(manifest.version).toBe(1)
    expect(manifest.generator).toBe('tessera')
  })

  it('carries the contract: role, parts, variants with defaults, states, behavior, slots and events', () => {
    const button = component('Button')
    expect(button).toMatchObject({
      role: 'button',
      behavior: 'press',
      parts: ['root', 'icon', 'label'],
      states: ['hover', 'focus-visible', 'pressed', 'disabled'],
    })
    expect(button.variants).toEqual([
      { name: 'tone', values: ['primary', 'neutral', 'danger'], default: 'primary' },
      { name: 'size', values: ['sm', 'md', 'lg'], default: 'sm' },
      { name: 'emphasis', values: ['solid', 'outline', 'ghost'], default: 'solid' },
    ])
    expect(button.slots).toHaveProperty('default')
    expect(button.events.press).toContain('click')
    expect(button.file).toBe('../../packages/ui/components/Button.tess')
  })

  it('writes usage examples that are valid for the contract', () => {
    expect(component('Button').usage).toEqual([
      '<Button>content</Button>',
      '<Button tone="neutral" size="md" emphasis="outline" @press="onPress">content</Button>',
    ])
    // A component with no default slot gets a self-closing tag.
    expect(component('ConfirmBar').usage[0]).toBe('<ConfirmBar />')
  })

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest)
  })
})

describe('the agent manifest: shared state', () => {
  it('lists the state of the project, with what each file exports', () => {
    expect(manifest.state.map((s) => [s.name, s.file])).toEqual([['cart', 'app/state/cart.ts']])
    expect(manifest.state[0]!.members.map((m) => [m.name, m.kind])).toEqual([
      ['items', 'signal'],
      ['count', 'signal'],
      ['add', 'function'],
      ['clear', 'function'],
    ])
    expect(manifest.state[0]!.members[1]!.usage).toBe(
      '{cart.count} in a template, cart.count.value in a script',
    )
  })
})

describe('the agent manifest: apis', () => {
  it('lists the apis of the project, with what each describes', () => {
    expect(manifest.apis.map((a) => [a.name, a.file, a.described])).toEqual([
      ['backend', 'app/apis/backend.ts', true],
      ['default', 'app/apis/default.ts', false],
    ])
    const backend = manifest.apis[0]!
    expect(backend.base).toBe('https://example.com/api')
    expect(backend.types.Task).toBe('{ id: number; title: string }')
    expect(backend.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
      'GET /tasks',
      'POST /tasks',
    ])
    expect(backend.endpoints[0]).toMatchObject({
      params: [],
      query: {},
      returns: 'Task[]',
      usage: "const { data, loading, error } = backend.get('/tasks')",
    })
    expect(backend.endpoints[1]).toMatchObject({ body: 'NewTask', returns: 'Task' })
  })
})

describe('the agent manifest: tokens, routes and rules', () => {
  it('lists tokens with tier, type, CSS variable and a value in every scope', () => {
    expect(manifest.tokens.themes.map((t) => t.name).sort()).toEqual(['compact', 'dark'])
    const bg = manifest.tokens.tokens.find((t) => t.path === 'color.action.primary.bg')!
    expect(bg).toMatchObject({
      type: 'color',
      tier: 'semantic',
      cssVar: '--t-color-action-primary-bg',
    })
    expect(Object.keys(bg.values)).toContain('base')
    expect(Object.keys(bg.values)).toContain('theme=dark')
    expect(bg.values['base']).not.toBe(bg.values['theme=dark'])
    // Primitives are marked, so a tool can avoid them.
    expect(manifest.tokens.tokens.find((t) => t.path === 'color.blue.600')!.tier).toBe('primitive')
  })

  it('lists the routes, the not-found page and the layouts', () => {
    expect(manifest.routes.routes.map((r) => r.path)).toEqual([
      '/',
      '/about',
      '/blog',
      '/blog/:slug',
    ])
    expect(manifest.routes.routes.find((r) => r.path === '/blog/:slug')!.params).toEqual(['slug'])
    expect(manifest.routes.notFound).toBe('404.tess')
    expect(manifest.routes.layouts).toEqual(['default', 'focus'])
  })

  it('states the rules: what is governed, the contrast minimum and the primitive policy', () => {
    expect(manifest.rules.governed['padding']).toEqual([{ type: 'dimension', groups: ['space'] }])
    expect(manifest.rules.governed['color']).toEqual([{ type: 'color', groups: ['color'] }])
    expect(manifest.rules.contrastMinimum).toBe(4.5)
    expect(manifest.rules.primitives).toBe('warn')
    expect(manifest.rules.autoImports).toBe(true)
  })

  it('has no tokens, routes or layouts for a project without them, and does not throw', () => {
    const empty = new Project(fileURLToPath(new URL('./fixtures', import.meta.url)), {
      tokens: fileURLToPath(new URL('./fixtures/none', import.meta.url)),
    }).agentManifest()
    expect(empty.tokens).toEqual({ themes: [], tokens: [] })
    expect(empty.routes).toEqual({ routes: [], layouts: [] })
  })
})
