import { describe, expect, it } from 'vitest'
import { compile } from '../src/compile'
import { buildStateList, readStateFile, type ProjectState } from '../src/shared-state'
import type { CompileOptions } from '../src/compile'

const FILE = 'app/pages/Shop.tess'
const PATH = '/project/app/pages/Shop.tess'

const CART = `import type { CartItem } from '../types'

export const items = state<CartItem[]>([])
export const coupon = state('')
export const count = derived(() => items.value.length)
export const limit = 10
export function add(item: CartItem) {
  items.value = [...items.value, item]
}
export function clear() {
  items.value = []
}
const hidden = state(0)
`

const cart: ProjectState = {
  name: 'cart',
  file: '/project/app/state/cart.ts',
  members: {
    items: 'signal',
    coupon: 'signal',
    count: 'signal',
    limit: 'value',
    add: 'function',
    clear: 'function',
  },
}

const page = (script: string, template: string) =>
  `<script>\n${script}\n</script>\n<template>${template}</template>`

const build = (source: string, options: Partial<CompileOptions> = {}) =>
  compile(source, { file: FILE, path: PATH, kind: 'page', state: [cart], ...options })

const issues = (source: string, options: Partial<CompileOptions> = {}) =>
  build(source, options).diagnostics.map(
    (d) => `${d.code} ${d.message}${d.hint ? ` | ${d.hint}` : ''}`,
  )

describe('reading a state file', () => {
  it('knows what each export is, and leaves out what is not exported', () => {
    expect(readStateFile(CART)).toEqual(cart.members)
  })

  it('reads exports with types, generics and several declarations', () => {
    expect(
      readStateFile(
        'export const a: Signal<number> = state(1), b = derived(() => a.value * 2)\nexport class Thing {}\nexport async function load() {}\nexport let n = 3',
      ),
    ).toEqual({ a: 'signal', b: 'signal', Thing: 'function', load: 'function', n: 'value' })
  })
})

describe('the shared state of a project', () => {
  const read = () => CART

  it('is each script file in the folder, named after the file', () => {
    const list = buildStateList(
      [
        '/p/app/state/cart.ts',
        '/p/app/state/cart.d.ts',
        '/p/app/state/cart.test.ts',
        '/p/app/state/notes.md',
      ],
      read,
    )
    expect(list.diagnostics).toEqual([])
    expect(list.states.map((s) => [s.name, s.file])).toEqual([['cart', '/p/app/state/cart.ts']])
    expect(list.states[0]!.members.count).toBe('signal')
  })

  it('refuses a name a script cannot use, one Tessera uses, and one an api has', () => {
    const list = buildStateList(
      [
        '/p/app/state/my-cart.ts',
        '/p/app/state/state.ts',
        '/p/app/state/github.ts',
        '/p/app/state/default.ts',
      ],
      read,
      { apis: ['github'], display: (f) => f.replace('/p/', '') },
    )
    expect(list.states).toEqual([])
    expect(list.diagnostics.map((d) => `${d.code} ${d.file} ${d.message}`)).toEqual([
      'T5010 app/state/default.ts "default" cannot be the name of shared state: it is not a name a script can use.',
      'T5010 app/state/github.ts "github" is the name of an API and of shared state. Rename one of the files.',
      'T5010 app/state/my-cart.ts "my-cart" cannot be the name of shared state: it is not a name a script can use.',
      'T5010 app/state/state.ts "state" cannot be the name of shared state: Tessera already uses it.',
    ])
  })
})

describe('using shared state in a component', () => {
  it('needs no import, and adds the one it needs', () => {
    const result = build(page('const n = cart.count', '<p class="root">{cart.count}</p>'))
    expect(result.diagnostics).toEqual([])
    expect(result.code).toContain('import * as cart from "../state/cart.ts"')
  })

  it('adds nothing for a script that does not use it, or defines the name itself', () => {
    expect(build(page('const n = 1', '<p class="root">{n}</p>')).code).not.toContain('state/cart')
    const own = build(page('const cart = { count: 1 }', '<p class="root">{cart.count}</p>'))
    expect(own.diagnostics).toEqual([])
    expect(own.code).not.toContain('state/cart')
  })

  it('reads a signal member as its value in the template, and leaves a function alone', () => {
    const result = build(
      page(
        '',
        '<div class="root"><p>{cart.count}</p><button @click="cart.add({ id: 1 })">Add</button></div>',
      ),
    )
    expect(result.diagnostics).toEqual([])
    expect(result.code).toContain('cart.count.value')
    expect(result.code).toContain('cart.add(')
    expect(result.code).not.toContain('cart.add.value')
  })

  it('reads members through a list, a condition and an attribute', () => {
    const result = build(
      page(
        '',
        '<ul class="root" :data-n="cart.count"><li each="i in cart.items" key="i.id">{i.name}</li><p if="cart.coupon">{cart.coupon}</p><p>{cart.limit}</p></ul>',
      ),
    )
    expect(result.diagnostics).toEqual([])
    expect(result.code).toContain('cart.items.value')
    expect(result.code).toContain('cart.coupon.value')
    expect(result.code).toContain('cart.count.value')
    expect(result.code).not.toContain('cart.limit.value')
  })

  it('keeps a destructured signal reactive and a destructured function callable', () => {
    const result = build(
      page(
        'const { count, add } = cart',
        '<div class="root"><p>{count}</p><button @click="add({ id: 1 })">Add</button></div>',
      ),
    )
    expect(result.diagnostics).toEqual([])
    expect(result.code).toContain('count.value')
    expect(result.code).not.toContain('add.value')
  })

  it('reads a member in the script as a signal, with .value', () => {
    expect(issues(page('const n = cart.count.value + 1', '<p class="root">{n}</p>'))).toEqual([])
  })
})

describe('a member that is not in the file', () => {
  it('is an error in a template, with the nearest member', () => {
    expect(issues(page('', '<p class="root">{cart.cout}</p>'))).toEqual([
      'T5012 "cart" has no "cout". | Did you mean "count"?',
    ])
  })

  it('names what it has, when nothing is close', () => {
    expect(issues(page('', '<p class="root">{cart.zzzzzzzz}</p>'))).toEqual([
      'T5012 "cart" has no "zzzzzzzz". | It has items, coupon, count, limit, add and clear.',
    ])
  })

  it('is an error in a script', () => {
    expect(issues(page('const n = cart.cout.value', '<p class="root">{n}</p>'))).toEqual([
      'T5012 "cart" has no "cout". | Did you mean "count"?',
    ])
  })

  it('is not raised for a member that exists', () => {
    expect(issues(page('const c = cart.clear', '<p class="root">{c}</p>'))).toEqual([])
  })
})

describe('shared state is read-only outside its file', () => {
  const ERROR =
    '"cart.items" can only be changed inside app/state/cart.ts. | Change it with cart.add() or cart.clear(), or add a function to that file.'

  it('refuses an assignment in a template handler', () => {
    expect(
      issues(page('', '<button class="root" @click="cart.items = []">Clear</button>')),
    ).toEqual([`T5011 ${ERROR}`])
  })

  it('refuses a change by .value, an increment and a method that changes a list', () => {
    expect(
      issues(page('', '<button class="root" @click="cart.items.value = []">x</button>')),
    ).toEqual([`T5011 ${ERROR}`])
    expect(
      issues(page('', '<button class="root" @click="cart.items.push({ id: 1 })">x</button>')),
    ).toEqual([`T5011 ${ERROR}`])
    expect(issues(page('', '<button class="root" @click="cart.count++">x</button>'))).toEqual([
      'T5011 "cart.count" can only be changed inside app/state/cart.ts. | Change it with cart.add() or cart.clear(), or add a function to that file.',
    ])
  })

  it('refuses it in the script too, where the change is by .value', () => {
    const result = issues(
      page(
        'function wipe() {\n  cart.items.value = []\n}',
        '<button class="root" @click="wipe()">x</button>',
      ),
    )
    expect(result).toEqual([`T5011 ${ERROR}`])
    expect(
      issues(page('function wipe() { cart.items.value.push(1) }', '<p class="root">x</p>')),
    ).toEqual([`T5011 ${ERROR}`])
    expect(
      issues(page('function wipe() { cart.count.value++ }', '<p class="root">x</p>')),
    ).toHaveLength(1)
  })

  it('points at the assignment in the script', () => {
    const script = 'function wipe() {\n  cart.items.value = []\n}'
    const source = page(script, '<p class="root">x</p>')
    const d = build(source).diagnostics[0]!
    expect([d.line, d.column]).toEqual([3, 3])
  })

  it('refuses a two-way bind to it, and says what to do instead', () => {
    expect(issues(page('', '<div class="root"><input bind:value="cart.coupon" /></div>'))).toEqual([
      'T5011 bind:value would change "cart.coupon", which can only be changed inside app/state/cart.ts. | Keep the text in a state() of this component, or show it with :value and change it from a function in app/state/cart.ts.',
    ])
  })

  it('says to add a function when the file has none', () => {
    const bare: ProjectState = { name: 'cart', file: cart.file, members: { items: 'signal' } }
    expect(
      issues(page('', '<button class="root" @click="cart.items = []">x</button>'), {
        state: [bare],
      }),
    ).toEqual([
      'T5011 "cart.items" can only be changed inside app/state/cart.ts. | Add a function to that file that changes it, and call that.',
    ])
  })

  it('allows calling a function, reading a value, comparing and passing a member on', () => {
    expect(
      issues(
        page(
          'const first = cart.items.value[0]\nconst total = cart.items.value.map((i) => i.price)\nfunction go() { cart.add(first) }',
          '<div class="root"><button @click="cart.clear()">x</button><p if="cart.count === 0">none</p><p>{cart.items.length}</p></div>',
        ),
      ),
    ).toEqual([])
  })

  it('does not mistake a name the script defines for the state', () => {
    expect(
      issues(
        page(
          'const cart = state([])\nfunction wipe() { cart.value = [] }',
          '<button class="root" @click="cart.value = []">x</button>',
        ),
      ),
    ).toEqual([])
  })
})
