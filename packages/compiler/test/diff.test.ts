import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { diffSnapshots, renderChangelog, summarize, type Snapshot } from '../src'
import { Project } from '../src/project-entry'

const root = fileURLToPath(new URL('../../../examples/kitchen-sink', import.meta.url))
const project = new Project(root, { today: '2026-10-22' })
const tokenManifest = () => {
  const t = project.tokens()
  if (!t?.ok) throw new Error('tokens do not build')
  return t.manifest
}
const snapshot = (): Snapshot => ({
  components: structuredClone(project.agentManifest().components),
  tokens: structuredClone(tokenManifest()),
})

const messages = (before: Snapshot, after: Snapshot) =>
  diffSnapshots(before, after).map((c) => `${c.kind}: ${c.message}`)

const component = (s: Snapshot, name: string) => s.components.find((c) => c.name === name)!
const token = (s: Snapshot, path: string) => s.tokens!.tokens.find((t) => t.path === path)!

describe('diff: nothing changed', () => {
  it('reports no changes', () => {
    expect(diffSnapshots(snapshot(), snapshot())).toEqual([])
    expect(renderChangelog([])).toBe('## Unreleased\n\nNo changes to the design system.\n')
  })
})

describe('diff: components', () => {
  it('removing a variant value is breaking', () => {
    const after = snapshot()
    const tone = component(after, 'Button').variants.find((v) => v.name === 'tone')!
    tone.values = tone.values.filter((v) => v !== 'danger')
    expect(messages(snapshot(), after)).toEqual(['breaking: Button.tone lost the value "danger".'])
  })

  it('adding a value, a variant, a part, a slot and an event is additive', () => {
    const after = snapshot()
    const button = component(after, 'Button')
    button.variants.find((v) => v.name === 'size')!.values.push('xl')
    button.variants.push({ name: 'shape', values: ['round', 'square'], default: 'round' })
    button.parts.push('badge')
    button.slots['footer'] = 'extra'
    button.events['hold'] = 'held'
    expect(messages(snapshot(), after).sort()).toEqual([
      'additive: Button gained the event "hold".',
      'additive: Button gained the part "badge".',
      'additive: Button gained the slot "footer".',
      'additive: Button gained the variant "shape" ("round", "square", default "round").',
      'additive: Button.size gained the value "xl".',
    ])
  })

  it('removing a part, a state, a slot or an event, or changing the role, is breaking', () => {
    const after = snapshot()
    const button = component(after, 'Button')
    button.parts = button.parts.filter((p) => p !== 'icon')
    button.states = button.states.filter((s) => s !== 'pressed')
    delete button.slots['icon']
    delete button.events['press']
    button.role = 'link'
    expect(messages(snapshot(), after).sort()).toEqual([
      'breaking: Button changed role from "button" to "link".',
      'breaking: Button lost the event "press".',
      'breaking: Button lost the part "icon".',
      'breaking: Button lost the slot "icon".',
      'breaking: Button lost the state "pressed".',
    ])
  })

  it('changing a default is breaking, because uses that do not set it render differently', () => {
    const after = snapshot()
    const size = component(after, 'Button').variants.find((v) => v.name === 'size')!
    size.values = ['md', 'sm', 'lg']
    size.default = 'md'
    expect(messages(snapshot(), after)).toEqual([
      'breaking: The default of Button.size changed from "sm" to "md", so uses that do not set it render differently.',
    ])
  })

  it('a renamed component is one breaking change a codemod can apply, and the rest is measured against the old one', () => {
    const after = snapshot()
    const button = component(after, 'Button')
    button.name = 'Action'
    button.renamedFrom = 'Button'
    button.parts.push('badge')
    const changes = diffSnapshots(snapshot(), after)
    expect(changes.map((c) => [c.kind, c.message, c.codemod])).toEqual([
      ['breaking', 'Button was renamed to Action.', true],
      ['additive', 'Action gained the part "badge".', undefined],
    ])
  })

  it('a renamed variant value is breaking with a codemod, not a bare removal', () => {
    const after = snapshot()
    const button = component(after, 'Button')
    const tone = button.variants.find((v) => v.name === 'tone')!
    tone.values = tone.values.map((v) => (v === 'danger' ? 'destructive' : v))
    button.renamedValues = { tone: { danger: 'destructive' } }
    const changes = diffSnapshots(snapshot(), after)
    expect(changes.map((c) => [c.kind, c.message, c.codemod])).toEqual([
      ['breaking', 'Button.tone value "danger" was renamed to "destructive".', true],
      ['additive', 'Button.tone gained the value "destructive".', undefined],
    ])
  })

  it('removing a component is breaking, adding one is additive, deprecating one is listed as a deprecation', () => {
    const after = snapshot()
    after.components = after.components.filter((c) => c.name !== 'Counter')
    component(after, 'ConfirmBar').deprecated = 'Use Dialog instead.'
    after.components.push({
      ...component(snapshot(), 'Counter'),
      name: 'Toggle',
      description: 'A switch.',
    })
    const changes = diffSnapshots(snapshot(), after)
    expect(
      changes.map((c) => `${c.kind}${c.deprecation ? '/deprecation' : ''}: ${c.message}`),
    ).toEqual([
      'breaking: Counter was removed.',
      'additive/deprecation: ConfirmBar is now deprecated: Use Dialog instead.',
      'additive: Toggle was added: A switch.',
    ])
  })
})

describe('diff: tokens', () => {
  it('removing a token or a theme, or changing a token’s type, is breaking', () => {
    const after = snapshot()
    const gone = after.tokens!.tokens.filter((t) => t.path.startsWith('space.')).at(-1)!.path
    after.tokens!.tokens = after.tokens!.tokens.filter((t) => t.path !== gone)
    token(after, 'space.4').type = 'number'
    after.tokens!.themes = after.tokens!.themes.filter((t) => t.name !== 'compact')
    expect(messages(snapshot(), after).sort()).toEqual([
      'breaking: $space.4 changed type from dimension to number.',
      `breaking: $${gone} was removed.`,
      'breaking: The theme "density=compact" was removed.',
    ])
  })

  it('a new token or theme is additive', () => {
    const after = snapshot()
    after.tokens!.tokens.push({
      ...token(after, 'space.4'),
      path: 'space.9',
      cssVar: '--t-space-9',
    })
    after.tokens!.themes.push({ attribute: 'theme', name: 'sepia', file: 'x', overrides: [] })
    expect(messages(snapshot(), after).sort()).toEqual([
      'additive: $space.9 was added.',
      'additive: The theme "theme=sepia" was added.',
    ])
  })

  it('a renamed token is breaking with a codemod', () => {
    const after = snapshot()
    const t = token(after, 'space.4')
    t.path = 'space.medium'
    t.cssVar = '--t-space-medium'
    t.extensions = { tessera: { renamedFrom: 'space.4' } }
    const changes = diffSnapshots(snapshot(), after)
    expect(changes.map((c) => [c.kind, c.message, c.codemod])).toEqual([
      ['breaking', '$space.4 was renamed to $space.medium.', true],
    ])
  })

  it('a value change that does not touch contrast or the scale is cosmetic', () => {
    const after = snapshot()
    token(after, 'color.blue.300').values['base']!.resolved = '#aaccff'
    const changes = diffSnapshots(snapshot(), after)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'cosmetic', name: '$color.blue.300' })
    expect(changes[0]!.message).toMatch(
      /^\$color\.blue\.300 changed value \(base: .* → #aaccff\)\.$/,
    )
  })

  it('a value change that flips a contrast result in a theme is breaking', () => {
    const before = snapshot()
    const after = snapshot()
    // Text stays dark; the page surface becomes dark too, in the default theme only.
    token(after, 'color.surface.default').values['base']!.resolved = '#101820'
    const changes = diffSnapshots(before, after).filter((c) => c.kind === 'breaking')
    expect(changes.map((c) => c.message)).toEqual([
      expect.stringMatching(
        /^Contrast of \$color\.text\.default on \$color\.surface\.default in the default theme fell from [\d.]+:1 to [\d.]+:1, below the 4\.5:1 minimum\.$/,
      ),
      expect.stringMatching(
        /^Contrast of \$color\.text\.muted on \$color\.surface\.default in the default theme fell from/,
      ),
    ])
  })

  it('a contrast improvement is reported as cosmetic', () => {
    const before = snapshot()
    before.tokens!.tokens.find((t) => t.path === 'color.surface.default')!.values[
      'base'
    ]!.resolved = '#101820'
    const after = snapshot()
    const changes = diffSnapshots(before, after)
    expect(changes.some((c) => c.kind === 'cosmetic' && c.message.includes('rose from'))).toBe(true)
    expect(changes.some((c) => c.kind === 'breaking')).toBe(false)
  })

  it('a value that moves a token past its neighbour in a scale is breaking', () => {
    const after = snapshot()
    token(after, 'space.4').values['base']!.resolved = '90px'
    const breaking = diffSnapshots(snapshot(), after).filter((c) => c.kind === 'breaking')
    expect(breaking.map((c) => c.message)).toEqual([
      expect.stringMatching(/^\$space\.4 moved past \$space\.\d(, \$space\.\d)* in its scale/),
    ])
  })

  it('a token that becomes deprecated is a deprecation', () => {
    const after = snapshot()
    token(after, 'space.4').extensions = { tessera: { deprecated: 'Use $space.5.' } }
    const changes = diffSnapshots(snapshot(), after)
    expect(changes.map((c) => [c.kind, c.deprecation, c.message])).toEqual([
      ['additive', true, '$space.4 is now deprecated: Use $space.5.'],
    ])
  })
})

describe('changelog', () => {
  it('groups changes under breaking, added, deprecated and changed, and says which a codemod updates', () => {
    const after = snapshot()
    const button = component(after, 'Button')
    button.name = 'Action'
    button.renamedFrom = 'Button'
    button.variants.find((v) => v.name === 'size')!.values.push('xl')
    component(after, 'ConfirmBar').deprecated = 'Use Dialog.'
    token(after, 'color.blue.300').values['base']!.resolved = '#aaccff'
    const text = renderChangelog(diffSnapshots(snapshot(), after), {
      version: '1.1.0',
      date: '2026-10-23',
    })
    expect(text.split('\n')).toEqual([
      '## 1.1.0 (2026-10-23)',
      '',
      '### Breaking changes',
      '',
      '- Button was renamed to Action. (`tessera codemod` updates it)',
      '',
      '### Added',
      '',
      '- Action.size gained the value "xl".',
      '',
      '### Deprecated',
      '',
      '- ConfirmBar is now deprecated: Use Dialog.',
      '',
      '### Changed',
      '',
      '- $color.blue.300 changed value (base: #93c5fd \u2192 #aaccff).',
      '',
    ])
  })

  it('counts changes by kind', () => {
    const after = snapshot()
    after.components = after.components.filter((c) => c.name !== 'Counter')
    expect(summarize(diffSnapshots(snapshot(), after))).toEqual({
      breaking: 1,
      additive: 0,
      cosmetic: 0,
    })
  })
})
