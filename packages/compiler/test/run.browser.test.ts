import { afterEach, describe, expect, it, vi } from 'vitest'
import { flush, getRenderer } from '@tessera/core'
import { compile, formatDiagnostic } from '../src'
import counterSource from '../../../examples/kitchen-sink/app/components/Counter.tess?raw'
import Toolbar from './fixtures/Toolbar.tess'

const r = getRenderer()
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

describe('components that use other components', () => {
  function mountToolbar(input: Parameters<typeof Toolbar>[0] = {}) {
    const container = document.createElement('div')
    document.body.append(container)
    dispose = r.mount(container, () => Toolbar(input))
    return container
  }

  it('passes variants, forwards attributes, and fills named and default slots', () => {
    const container = mountToolbar()
    const [save, second] = [...container.querySelectorAll('button')] as HTMLButtonElement[]
    expect(save!.getAttribute('data-tone')).toBe('danger')
    expect(save!.getAttribute('data-size')).toBe('md')
    expect(save!.getAttribute('class')).toBe('t-Button__root t-Toolbar__extra')
    expect(save!.getAttribute('aria-label')).toBe('Save now')
    expect(save!.querySelector('span')!.textContent).toBe('!')
    expect(save!.querySelector('.t-Button__label')!.textContent).toBe('Save 0')
    // The second button uses every default.
    expect(second!.getAttribute('data-tone')).toBe('primary')
    expect(second!.getAttribute('data-size')).toBe('sm')
    expect(second!.querySelector('.t-Button__label')!.textContent).toBe('Second')
    expect(second!.disabled).toBe(false)
  })

  it('handles the child event, updates the parent state, and re-emits', () => {
    const saved = vi.fn()
    const container = mountToolbar({ events: { saved } })
    const [save, second] = [...container.querySelectorAll('button')] as HTMLButtonElement[]
    save!.click()
    flush()
    expect(save!.querySelector('.t-Button__label')!.textContent).toBe('Save 1')
    expect(saved).toHaveBeenCalledWith(1)
    save!.click()
    flush()
    expect(saved).toHaveBeenLastCalledWith(2)
    // `:disabled="saves > 1"` reaches the child as a reactive prop.
    expect(second!.disabled).toBe(true)
  })
})

describe('the compiler core in a browser', () => {
  it('compiles Counter.tess without any Node API', () => {
    // This file runs in a browser tab: there is no fs, path or process here, so compile() passing
    // shows the core needs none.
    const result = compile(counterSource, { file: 'Counter.tess' })
    expect(result.diagnostics.map(formatDiagnostic)).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.code).toContain('$defineComponent("Counter"')
    expect(result.code).toContain('$r.each(')
  })

  it('reports errors with locations in a browser too', () => {
    const result = compile(counterSource.replace('{label}', '{lable}'), { file: 'Counter.tess' })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]).toMatchObject({ code: 'T4006', hint: 'Did you mean "label"?' })
  })
})
