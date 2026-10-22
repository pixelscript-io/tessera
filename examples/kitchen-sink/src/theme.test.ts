// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { setDensity, setTheme } from '../../../packages/tokens/src'
import { mountCounter } from './counter'

it('switching theme and density changes attributes only, with no re-render', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  mountCounter(host)
  const button = host.querySelector('button')!
  const records: MutationRecord[] = []
  const observer = new MutationObserver((r) => records.push(...r))
  observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true })

  setTheme('dark', host)
  setDensity('compact', host)
  await Promise.resolve()
  observer.disconnect()

  expect(host.getAttribute('data-theme')).toBe('dark')
  expect(host.getAttribute('data-density')).toBe('compact')
  expect(host.querySelector('button')).toBe(button)
  // The only mutations are the two attributes on the host itself, none inside.
  expect(records.every((r) => r.target === host && r.type === 'attributes')).toBe(true)
})
