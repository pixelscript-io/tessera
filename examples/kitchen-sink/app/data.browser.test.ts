import 'virtual:tessera/tokens.css'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flush, getRenderer } from '@pixelscriptio/tessera/core'
import backend from './apis/backend'
import fallback from './apis/default'
import Quote from './components/Quote.tess'
import TaskList from './components/TaskList.tess'

const r = getRenderer()
let dispose: (() => void) | undefined

/** A server of tasks that lives in this test. */
let tasks: Array<{ id: number; title: string }>
let up: boolean
const calls: string[] = []

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

const server = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = init?.method ?? 'GET'
  calls.push(`${method} ${String(input)}`)
  if (!up) return json({ message: 'down' }, 404)
  if (method === 'POST') {
    const body = JSON.parse(String(init!.body)) as { title: string }
    const task = { id: tasks.length + 1, title: body.title }
    tasks.push(task)
    return json(task, 201)
  }
  if (String(input).endsWith('/quote')) return json({ text: 'Make it work.' })
  return json(tasks)
}) as typeof fetch

beforeEach(() => {
  tasks = [
    { id: 1, title: 'Write the compiler' },
    { id: 2, title: 'Write the docs' },
  ]
  up = true
  calls.length = 0
  backend.clear()
  fallback.clear()
  backend.configure({ fetch: server, retryDelay: () => 1 })
  fallback.configure({ fetch: server, retryDelay: () => 1 })
})

afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

const wait = async (ms = 40) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
  flush()
}

function mount(component: () => unknown) {
  const container = document.createElement('div')
  document.body.append(container)
  dispose = r.mount(container, component as never)
  return container
}

describe('an api in app/apis, used without an import', () => {
  it('shows loading, then the tasks', async () => {
    const container = mount(() => TaskList())
    expect(container.querySelector('.t-TaskList__message')!.textContent).toBe('Loading tasks...')
    await wait()
    expect(container.querySelector('.t-TaskList__message')).toBeNull()
    expect(
      [...container.querySelectorAll('.t-TaskList__item')].map((li) => li.textContent),
    ).toEqual(['Write the compiler', 'Write the docs'])
    expect(calls).toEqual(['GET https://example.com/api/tasks'])
  })

  it('says it could not load, and loads when asked again', async () => {
    up = false
    const container = mount(() => TaskList())
    await wait()
    expect(container.querySelector('.t-TaskList__message')!.textContent).toBe(
      'Could not load the tasks: GET https://example.com/api/tasks failed: 404',
    )
    up = true
    ;(container.querySelector('.t-TaskList__reload') as HTMLButtonElement).click()
    await wait()
    expect(container.querySelectorAll('.t-TaskList__item')).toHaveLength(2)
  })

  it('adds a task, and the list shows it without being told to', async () => {
    const container = mount(() => TaskList())
    await wait()
    const field = container.querySelector('.t-TaskList__field') as HTMLInputElement
    await userEvent.fill(field, 'Ship it')
    const add = container.querySelector('.t-TaskList__add') as HTMLButtonElement
    await userEvent.click(add)
    await wait(80)
    expect(
      [...container.querySelectorAll('.t-TaskList__item')].map((li) => li.textContent),
    ).toEqual(['Write the compiler', 'Write the docs', 'Ship it'])
    expect(field.value).toBe('')
    expect(calls).toEqual([
      'GET https://example.com/api/tasks',
      'POST https://example.com/api/tasks',
      'GET https://example.com/api/tasks',
    ])
    expect(add.disabled).toBe(false)
  })
})

describe('get without a name uses app/apis/default.ts', () => {
  it('reads from the default api, taking the read apart', async () => {
    const container = mount(() => Quote())
    expect(container.querySelector('.t-Quote__message')!.textContent).toBe('Loading...')
    await wait()
    expect(container.querySelector('.t-Quote__text')!.textContent).toBe('Make it work.')
    expect(calls).toEqual(['GET https://example.com/api/quote'])
  })

  it('shows the error of a destructured read', async () => {
    up = false
    const container = mount(() => Quote())
    await wait()
    expect(container.querySelector('.t-Quote__message')!.textContent).toContain(
      'No quote: GET https://example.com/api/quote failed: 404',
    )
  })
})
