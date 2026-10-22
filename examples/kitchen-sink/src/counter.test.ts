// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { flush } from '../../../packages/core/src'
import { mountCounter } from './counter'

it('counter and list work end to end', () => {
  const host = document.createElement('div')
  const app = mountCounter(host)
  host.querySelector('button')!.click()
  flush()
  expect(host.querySelector('button')!.textContent).toBe('Clicked 1 times')
  app.todos.value = [...app.todos.value, { id: 2, text: 'Render it' }]
  flush()
  expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
    'Write signals',
    'Render it',
  ])
})
