import 'virtual:tessera/tokens.css'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flush, getRenderer, resetState, state } from '@pixelscriptio/tessera/core'
import * as cart from './state/cart'
import CartAdd from './components/CartAdd.tess'
import CartCount from './components/CartCount.tess'

const r = getRenderer()
let disposers: Array<() => void> = []
let root: HTMLElement

beforeEach(() => {
  cart.clear()
  root = document.createElement('div')
  document.body.append(root)
  for (const component of [CartCount, CartAdd]) {
    const host = document.createElement('div')
    root.append(host)
    disposers.push(r.mount(host, () => component()))
  }
  flush()
})

afterEach(() => {
  for (const dispose of disposers) dispose()
  disposers = []
  document.body.innerHTML = ''
})

const button = (label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement
const total = () => root.querySelector('.t-CartCount__total')!.textContent
const items = () => [...root.querySelectorAll('.t-CartCount__item')].map((li) => li.textContent)

describe('shared state: app/state/cart.ts', () => {
  it('is seen by two components that never import it, and they stay in step', async () => {
    expect(total()).toBe('0 in the cart')
    await userEvent.click(button('Add to cart'))
    await userEvent.click(button('Add to cart'))
    expect(total()).toBe('2 in the cart')
    expect(items()).toEqual(['Item 1', 'Item 2'])
    await userEvent.click(button('Empty the cart'))
    expect(total()).toBe('0 in the cart')
    expect(items()).toEqual([])
  })

  it('keeps the rules of the state file: a cart holds three things', async () => {
    for (let i = 0; i < 5; i++) await userEvent.click(button('Add to cart'))
    expect(items()).toEqual(['Item 1', 'Item 2', 'Item 3'])
  })

  it('is the same state when a plain script changes it', () => {
    cart.add('From a script')
    flush()
    expect(items()).toEqual(['From a script'])
    expect(total()).toBe('1 in the cart')
  })
})

describe('resetState: shared state back to where it started, for tests', () => {
  it('puts the cart back, because the build marked the file as shared state', async () => {
    await userEvent.click(button('Add to cart'))
    await userEvent.click(button('Add to cart'))
    expect(total()).toBe('2 in the cart')
    resetState()
    flush()
    expect(total()).toBe('0 in the cart')
    expect(items()).toEqual([])
  })

  it('leaves a state a component made alone', () => {
    const local = state(1)
    local.value = 2
    resetState()
    expect(local.value).toBe(2)
  })
})
