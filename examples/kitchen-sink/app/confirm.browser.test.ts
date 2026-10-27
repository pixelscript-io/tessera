import 'virtual:tessera/tokens.css'
import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flush, getRenderer } from '@pixelscriptio/tessera/core'
import ConfirmBar from './components/ConfirmBar.tess'

const r = getRenderer()
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

function mountBar() {
  const confirm = vi.fn()
  const cancel = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  dispose = r.mount(container, () => ConfirmBar({ events: { confirm, cancel } }))
  return { container, confirm, cancel }
}

describe('ConfirmBar uses the system Button', () => {
  it('passes variants, so the tokens style the buttons', () => {
    const { container } = mountBar()
    const [del, cancel] = [...container.querySelectorAll('button')] as HTMLButtonElement[]
    expect(del!.getAttribute('data-tone')).toBe('danger')
    expect(getComputedStyle(del!).backgroundColor).toBe('rgb(185, 28, 28)')
    expect(cancel!.getAttribute('data-tone')).toBe('neutral')
    expect(cancel!.getAttribute('data-emphasis')).toBe('outline')
  })

  it('works by mouse and by keyboard', async () => {
    const { container, confirm, cancel } = mountBar()
    const [del, back] = [...container.querySelectorAll('button')] as HTMLButtonElement[]
    await userEvent.click(del!)
    expect(confirm).toHaveBeenCalledTimes(1)

    // The click left focus on Delete, so Tab moves to Cancel.
    await userEvent.tab()
    expect(document.activeElement).toBe(back)
    await userEvent.keyboard('{Enter}')
    expect(cancel).toHaveBeenCalledTimes(1)
    await userEvent.keyboard(' ')
    expect(cancel).toHaveBeenCalledTimes(2)
    flush()
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
