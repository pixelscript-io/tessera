import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config'

describe('tokenGroups', () => {
  it('moves every property of a kind to the groups named', () => {
    const { governed } = resolveConfig({ tokenGroups: { space: ['spacing', 'layout.gap'] } })
    expect(governed.padding).toEqual([{ type: 'dimension', groups: ['spacing', 'layout.gap'] }])
    expect(governed['margin-top']).toEqual([
      { type: 'dimension', groups: ['spacing', 'layout.gap'] },
    ])
    expect(governed['border-radius']).toEqual([{ type: 'dimension', groups: ['radius'] }])
  })

  it('accepts a token of the right type from any group with false or an empty list', () => {
    const { governed } = resolveConfig({ tokenGroups: { color: false, radius: [] } })
    expect(governed.background).toEqual([{ type: 'color' }])
    expect(governed['border-radius']).toEqual([{ type: 'dimension' }])
  })

  it('leaves a property the person governed themselves as they wrote it', () => {
    const { governed } = resolveConfig({
      tokenGroups: { space: ['spacing'] },
      governed: { gap: { type: 'dimension', groups: ['space'] } },
    })
    expect(governed.gap).toEqual([{ type: 'dimension', groups: ['space'] }])
    expect(governed.padding).toEqual([{ type: 'dimension', groups: ['spacing'] }])
  })

  it('changes nothing when it is not set', () => {
    expect(resolveConfig({}).governed.padding).toEqual([{ type: 'dimension', groups: ['space'] }])
  })
})
