import { describe, expect, it } from 'vitest'
import { addTokenGroups, classifyTokens, tokenGroupsSource } from '../src/classify'

const t = (path: string, type: string) => ({ path, type })

describe('classifyTokens', () => {
  it('says nothing when the tokens already use the default groups', () => {
    const r = classifyTokens([
      t('space.4', 'dimension'),
      t('radius.md', 'dimension'),
      t('font.size.lg', 'dimension'),
      t('color.brand.600', 'color'),
      t('shadow.md', 'shadow'),
      t('motion.duration.fast', 'duration'),
    ])
    expect(r.tokenGroups).toEqual({})
    expect(r.found.map((f) => f.category).sort()).toEqual(
      ['fontSize', 'duration', 'radius', 'shadow', 'space'].sort(),
    )
  })

  it('finds the groups a team named its own way', () => {
    const r = classifyTokens([
      t('spacing.4', 'dimension'),
      t('spacing.8', 'dimension'),
      t('layout.gap.md', 'dimension'),
      t('rounded.md', 'dimension'),
      t('fontSizes.lg', 'dimension'),
      t('text.sm.$root', 'dimension'),
      t('opacity.50', 'number'),
      t('brand.600', 'color'),
      t('elevation.low', 'shadow'),
      t('ease.out', 'cubicBezier'),
      t('speed.fast', 'duration'),
    ])
    expect(r.tokenGroups).toEqual({
      space: ['layout.gap', 'spacing'],
      radius: ['rounded'],
      fontSize: ['fontSizes', 'text'],
      color: false,
      shadow: ['elevation'],
      easing: ['ease'],
      duration: ['speed'],
    })
  })

  it('reads a group however it is spelled: camelCase, dashes and dots', () => {
    const r = classifyTokens([
      t('fontSize.lg', 'dimension'),
      t('font-size.md', 'dimension'),
      t('type.size.sm', 'dimension'),
      t('Spacing.4', 'dimension'),
    ])
    expect(r.tokenGroups.fontSize).toEqual(['font-size', 'fontSize', 'type.size'])
    expect(r.tokenGroups.space).toEqual(['Spacing'])
  })

  it('counts dimensions it cannot place instead of guessing', () => {
    const r = classifyTokens([
      t('sizes.px', 'dimension'),
      t('sizes.1', 'dimension'),
      t('z.modal', 'number'),
    ])
    expect(r.tokenGroups).toEqual({})
    expect(r.unplaced).toEqual([
      { group: 'sizes', type: 'dimension', count: 2, example: 'sizes.px' },
      { group: 'z', type: 'number', count: 1, example: 'z.modal' },
    ])
  })

  it('takes a token with no group as its own', () => {
    expect(classifyTokens([t('spacing', 'dimension')]).tokenGroups).toEqual({ space: ['spacing'] })
  })
})

describe('addTokenGroups', () => {
  const groups: Parameters<typeof addTokenGroups>[1] = { space: ['spacing'], color: false }

  it('writes the setting into the exported object', () => {
    const out = addTokenGroups('export default {\n  docs: false,\n}\n', groups)
    expect(out).toEqual({
      text: expect.stringContaining("tokenGroups: { space: ['spacing'], color: false },"),
    })
    expect('text' in out && out.text.startsWith('export default {\n  // Written by')).toBe(true)
  })

  it('works with defineConfig and with CRLF line endings', () => {
    const a = addTokenGroups('export default defineConfig({\r\n  docs: false,\r\n})\r\n', groups)
    expect('text' in a && a.text).toContain(
      "tokenGroups: { space: ['spacing'], color: false },\r\n  docs: false",
    )
  })

  it('leaves a config that already sets it, or has another shape, to the person', () => {
    expect(addTokenGroups('export default { tokenGroups: {} }', groups)).toHaveProperty('reason')
    expect(addTokenGroups('const config = {}\nexport default config\n', groups)).toHaveProperty(
      'reason',
    )
  })

  it('writes false for any group', () => {
    expect(tokenGroupsSource({ color: false })).toBe('tokenGroups: { color: false }')
  })
})
