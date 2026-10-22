import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'
import { describe, expect, it } from 'vitest'
import { compile } from '@tessera/compiler'
import plugin from '../src/prettier-plugin'
import { reindentTemplate } from '../src/template-indent'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const read = (path: string) => readFileSync(`${repo}${path}`, 'utf8')
const run = (text: string, options = {}) =>
  format(text, { parser: 'tess', plugins: [plugin], semi: false, singleQuote: true, ...options })

/** The generated render expression: everything the template compiles to. */
const render = (source: string) =>
  compile(source, { file: 'Card.tess' })
    .code.split('\n')
    .find((l) => l.startsWith('  return $ctx.root('))

const MESSY = `<contract>
{"name":"Card",   "role":"group",
 // keep this comment
 "parts":["root"],"events":{"change":"c"}}
</contract>
<script>
const   count=state(0)
function inc(){count.value++;emit('change')}
</script>


<!-- note about the template -->
<template>
<div class="root"   :title="count">
      <button
  @click="inc"
        class="button">
  Clicked   {count}   times
      </button>
<p if="count>1">many</p>
   <p else>few</p>
   </div>
</template>
<style>
.root{padding:$space.4;
  color:$color.text.default}
</style>`

describe('prettier plugin for .tess', () => {
  it('formats every block with the right language and keeps comments', async () => {
    expect(await run(MESSY)).toBe(`<contract>
{
  "name": "Card",
  "role": "group",
  // keep this comment
  "parts": ["root"],
  "events": { "change": "c" }
}
</contract>

<script>
const count = state(0)
function inc() {
  count.value++
  emit('change')
}
</script>

<!-- note about the template -->

<template>
  <div class="root"   :title="count">
    <button
      @click="inc"
      class="button">
      Clicked   {count}   times
    </button>
    <p if="count>1">many</p>
    <p else>few</p>
  </div>
</template>

<style>
.root {
  padding: $space.4;
  color: $color.text.default;
}
</style>
`)
  })

  it('is idempotent', async () => {
    const once = await run(MESSY)
    expect(await run(once)).toBe(once)
  })

  it('does not change what the template compiles to', async () => {
    const before = compile(MESSY, { file: 'Card.tess' })
    const after = compile(await run(MESSY), { file: 'Card.tess' })
    expect(before.diagnostics).toEqual([])
    expect(after.diagnostics).toEqual([])
    expect(render(await run(MESSY))).toBe(render(MESSY))
  })

  it('keeps component tag case, self-closing tags, directives and expressions', async () => {
    const source = `<contract>
{ "name": "Card", "role": "group", "parts": ["root"], "slots": { "default": "x" } }
</contract>
<template>
<div class="root">
<Button tone="danger" @press="save">
<slot name="icon" />
</Button>
<input bind:value="name" />
<li each="x in xs" key="x.id">{x.id < 2 ? 'a' : 'b'}</li>
</div>
</template>`
    const out = await run(source)
    expect(out).toContain(
      '    <Button tone="danger" @press="save">\n      <slot name="icon" />\n    </Button>',
    )
    expect(out).toContain('    <input bind:value="name" />')
    expect(out).toContain(`<li each="x in xs" key="x.id">{x.id < 2 ? 'a' : 'b'}</li>`)
  })

  it('formats the real kitchen-sink component without changing its output', async () => {
    const source = read('examples/kitchen-sink/app/components/Counter.tess')
    const out = await run(source)
    expect(await run(out)).toBe(out)
    expect(render(out)).toBe(render(source))
  })

  it('respects tabs and tab width', async () => {
    const source =
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<template>\n<div class="root">\n<p>x</p>\n</div>\n</template>'
    expect(await run(source, { useTabs: true })).toContain(
      '<template>\n\t<div class="root">\n\t\t<p>x</p>\n\t</div>\n</template>',
    )
    expect(await run(source, { tabWidth: 4 })).toContain(
      '<template>\n    <div class="root">\n        <p>x</p>',
    )
  })

  it('leaves a block it cannot parse exactly as written', async () => {
    const source = `<contract>
{ "name": "Card", "role": "group", "parts": ["root"] }
</contract>
<script>
const = ;;
</script>
<template><div class="root"></div></template>`
    expect(await run(source)).toContain('<script>\nconst = ;;\n</script>')
    const badTemplate = '<template>\n<div>\n</template>'
    expect(await run(badTemplate)).toContain('<template>\n<div>\n</template>')
  })

  it('handles empty blocks and files with no blocks', async () => {
    expect(await run('<script></script>\n<template><div></div></template>')).toContain(
      '<script></script>',
    )
    expect(await run('')).toBe('')
  })

  it('keeps attributes on block tags', async () => {
    const out = await run('<script lang="ts">const a=1</script>\n<template><div></div></template>')
    expect(out).toContain('<script lang="ts">\nconst a = 1\n</script>')
  })
})

describe('reindentTemplate', () => {
  it('leaves multi-line comments alone and collapses blank lines', () => {
    const out = reindentTemplate('<div>\n\n\n<!--\n   a\n      b\n-->\n<p></p>\n</div>', '  ')
    expect(out).toBe('<div>\n\n  <!--\n   a\n      b\n-->\n  <p></p>\n</div>')
  })

  it('indents a multi-line expression one level in', () => {
    const out = reindentTemplate('<p>\n{\nitems.length\n}\n</p>', '  ')
    expect(out).toBe('<p>\n  {\n  items.length\n  }\n</p>')
  })

  it('does not indent after void and self-closing elements', () => {
    expect(reindentTemplate('<div>\n<input>\n<br />\n<b>x</b>\n</div>', '  ')).toBe(
      '<div>\n  <input>\n  <br />\n  <b>x</b>\n</div>',
    )
  })

  it('returns undefined for a template that does not parse', () => {
    expect(reindentTemplate('<div>', '  ')).toBeUndefined()
  })
})
