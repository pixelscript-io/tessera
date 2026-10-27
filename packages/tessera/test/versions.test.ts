import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../../cli/src/version'

// The versioning rules (SPEC.md, "Versioning"): the three published packages share one number, the library asks for the
// minor of the framework it was built with, and the number is 0.MINOR.PATCH with a minor that may pass 9.
const read = (path: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')) as {
    version: string
    peerDependencies?: Record<string, string>
  }

const tessera = read('../package.json')
const ui = read('../../ui/package.json')
const create = read('../../create-tessera/package.json')

describe('versions', () => {
  it('are one number for the framework, the component library and the project starter', () => {
    expect(ui.version).toBe(tessera.version)
    expect(create.version).toBe(tessera.version)
  })

  it('are the number the command line reports', () => {
    expect(VERSION).toBe(tessera.version)
  })

  it('are 0.MINOR.PATCH: Tessera has not declared 1.0, and a minor may be 10 or more', () => {
    expect(tessera.version).toMatch(/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  })

  it('ask of the framework, in the library, the minor it was released with (a caret on 0.x means that)', () => {
    const [, minor] = tessera.version.split('.')
    expect(ui.peerDependencies?.['@pixelscriptio/tessera']).toBe(`^0.${minor}.0`)
  })

  it('compare as numbers: 0.10.0 is after 0.9.0', () => {
    const order = ['0.9.0', '0.10.0', '0.2.0', '0.1.0'].sort((a, b) => {
      const [x, y] = [a, b].map((v) => v.split('.').map(Number))
      return x![0]! - y![0]! || x![1]! - y![1]! || x![2]! - y![2]!
    })
    expect(order).toEqual(['0.1.0', '0.2.0', '0.9.0', '0.10.0'])
  })
})
