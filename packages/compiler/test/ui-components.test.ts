import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatDiagnostic } from '@tessera/contract'
import { loadComponentRegistry, loadDesignTokens } from '../src/node'
import { compile } from '../src/compile'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const loaded = loadDesignTokens(`${root}system/tokens`)
const tokens = loaded.ok ? loaded.tokens : undefined

const dir = `${root}packages/ui/components`
const files = readdirSync(dir).filter((f) => f.endsWith('.tess'))

describe('every component in the Tessera UI library', () => {
  it('has design tokens to compile against', () => {
    expect(loaded.ok).toBe(true)
  })

  for (const file of files) {
    it(`${file} compiles cleanly: contract, template, token-enforced styles and contrast in every theme`, () => {
      const source = readFileSync(`${dir}/${file}`, 'utf8')
      const result = compile(source, {
        file: `packages/ui/components/${file}`,
        tokens,
        today: '2026-10-22',
      })
      expect(result.diagnostics.map(formatDiagnostic)).toEqual([])
      expect(result.ok).toBe(true)
      expect(result.css).toContain('@layer tessera.components')
    })
  }
})

describe('Button', () => {
  const source = readFileSync(`${dir}/Button.tess`, 'utf8')
  const result = compile(source, { file: 'system/components/Button.tess', tokens })

  it('wires the press behavior onto its native button', () => {
    expect(result.code).toContain(
      'import { attachPress as $attachPress } from "@pixelscriptio/tessera/behavior"',
    )
    expect(result.code).toContain('native: true, role: "button"')
  })

  it('has variants with the first value as the default', () => {
    expect(result.code).toContain('"Button", {"tone":"primary","size":"sm","emphasis":"solid"}')
  })

  it('scopes its parts as public class names', () => {
    expect(result.code).toContain('t-Button__root')
    expect(result.code).toContain('t-Button__label')
    expect(result.css).toContain('.t-Button__root')
    expect(result.css).toContain("&[data-tone='danger']")
  })

  it('is checked against every variant and state combination for contrast', () => {
    // Make the danger text unreadable in dark and the compiler must say which combination fails.
    const worse = source.replace(
      'color: $color.action.danger.text;',
      'color: $color.action.danger.bg;',
    )
    const bad = compile(worse, { file: 'system/components/Button.tess', tokens })
    const failures = bad.diagnostics.filter((d) => d.code === 'T2107')
    expect(failures.length).toBeGreaterThan(0)
    expect(failures[0]!.hint).toContain(".root[data-tone='danger'][data-emphasis=")
  })
})

describe('using the system Button from an app', () => {
  const app = `${root}examples/kitchen-sink/app/components/ConfirmBar.tess`
  const source = readFileSync(app, 'utf8')
  const { registry } = loadComponentRegistry(`${root}examples/kitchen-sink`)
  const options = () => ({
    file: 'examples/kitchen-sink/app/components/ConfirmBar.tess',
    path: app.replaceAll('\\', '/'),
    registry,
    tokens,
  })

  it('has no import for Button, and still compiles', () => {
    expect(source).not.toContain('import')
    const result = compile(source, options())
    expect(result.diagnostics).toEqual([])
    expect(result.code).toContain(
      'import Button from "../../../../packages/ui/components/Button.tess"',
    )
  })

  it('compiles when the variants are valid', () => {
    expect(compile(source, options()).diagnostics).toEqual([])
  })

  it('rejects a misspelled variant value against the real contract, with a suggestion', () => {
    const bad = source.replace('tone="danger"', 'tone="dangr"')
    const [d] = compile(bad, options()).diagnostics
    expect(d).toMatchObject({
      code: 'T4008',
      message: 'Button.tone has no value "dangr".',
      hint: 'Did you mean "danger"?',
    })
    const [line] = bad.split('\n').filter((l) => l.includes('dangr'))
    expect(line!.slice(d!.column - 1, d!.column - 1 + 5)).toBe('dangr')
  })

  it('rejects an undeclared slot, event and variant too', () => {
    const slot = source.replace('>Delete<', '><i slot="icn"></i>Delete<')
    expect(compile(slot, options()).diagnostics[0]).toMatchObject({
      code: 'T4009',
      hint: 'Did you mean "icon"?',
    })
    const event = source.replace('@press="confirm"', '@pres="confirm"')
    expect(compile(event, options()).diagnostics[0]).toMatchObject({
      code: 'T4010',
      hint: 'Did you mean "press"?',
    })
    const size = source.replace('tone="danger"', 'tone="danger" size="xl"')
    expect(compile(size, options()).diagnostics[0]).toMatchObject({
      code: 'T4008',
      message: 'Button.size has no value "xl".',
    })
  })
})

describe('the token interface of the library', () => {
  const page = readFileSync(`${root}website/content/guide/tessera-ui.md`, 'utf8')
  const listed = (/```text token-interface\n([\s\S]*?)```/.exec(page)?.[1] ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const used = new Set<string>()
  for (const file of files) {
    const source = readFileSync(`${dir}/${file}`, 'utf8')
    const style = source.slice(source.indexOf('<style'))
    for (const m of style.matchAll(/\$([a-z][a-z0-9.-]*[a-z0-9])/g)) used.add(m[1]!)
  }

  it('is the list on the Tessera UI page, exactly: no component uses a token the page does not list', () => {
    expect(listed.length).toBeGreaterThan(20)
    expect([...used].sort()).toEqual([...listed].sort())
  })

  for (const preset of ['tessera', 'tailwind']) {
    it(`is defined by the ${preset} preset, and every component compiles against it`, () => {
      const presetTokens = loadDesignTokens(`${root}packages/cli/templates/${preset}/system/tokens`)
      expect(presetTokens.ok).toBe(true)
      if (!presetTokens.ok) return
      expect(listed.filter((path) => !presetTokens.tokens.has(path))).toEqual([])
      for (const file of files) {
        const result = compile(readFileSync(`${dir}/${file}`, 'utf8'), {
          file: `packages/ui/components/${file}`,
          tokens: presetTokens.tokens,
          today: '2026-10-22',
        })
        expect(result.diagnostics.map(formatDiagnostic), file).toEqual([])
      }
    })
  }
})
