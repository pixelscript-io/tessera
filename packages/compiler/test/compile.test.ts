import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  compile,
  extractContract,
  formatDiagnostic,
  listImports,
  type CompileOptions,
  type ComponentResolver,
} from '../src'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')

const card =
  (opts: { parts?: string; slots?: string; events?: string; script?: string } = {}) =>
  (template: string) =>
    `<contract>
{ "name": "Card", "role": "group", "parts": ["root"${opts.parts ?? ''}], "slots": { ${opts.slots ?? '"default": "x"'} }, "events": { ${opts.events ?? '"change": "c"'} } }
</contract>
${opts.script ? `<script>\n${opts.script}\n</script>\n` : ''}<template>${template}</template>`

/** `code line:column message | hint` for each diagnostic. */
const issues = (source: string, options: Partial<CompileOptions> = {}) =>
  compile(source, { file: 'Card.tess', ...options }).diagnostics.map(
    (d) => `${d.code} ${d.line}:${d.column} ${d.message}${d.hint ? ` | ${d.hint}` : ''}`,
  )

const buttonInfo = {
  contract: extractContract(fixture('Button.tess'), 'Button.tess')!,
  importPath: './Button.tess',
}
const resolver: ComponentResolver = {
  resolve: (tag) => (tag === 'Button' ? buttonInfo : undefined),
  names: () => ['Button'],
}

describe('blocks', () => {
  it('requires a template', () => {
    expect(issues('<script>const a = 1</script>')).toEqual([
      'T4002 1:1 This file has no <template> block. A component needs a template with one root element.',
    ])
  })

  it('reports duplicate, unknown and unclosed blocks and stray content', () => {
    const tpl = '<template><div class="root"></div></template>'
    expect(issues(`${tpl}\n${tpl}`).filter((i) => i.startsWith('T4001'))).toEqual([
      'T4001 2:1 Duplicate <template> block. A file can have only one.',
    ])
    expect(issues(`<oops></oops>${tpl}`).filter((i) => i.startsWith('T4001'))).toEqual([
      'T4001 1:1 Unknown block <oops>. A .tess file contains only <contract>, <script>, <template>, <style> and <page> blocks.',
    ])
    expect(issues('<script>const a = 1')).toEqual([
      'T4001 1:1 The <script> block is never closed. Add </script>.',
    ])
    expect(issues(`hello ${tpl}`).filter((i) => i.startsWith('T4001'))).toEqual([
      'T4001 1:1 Unexpected content outside of a block. A .tess file contains only <contract>, <script>, <template>, <style> and <page> blocks.',
    ])
  })

  it('allows a nested <template> inside the template block', () => {
    const src = card()('<div class="root"><template><b></b></template></div>')
    expect(issues(src)).toEqual([])
    expect(compile(src, { file: 'Card.tess' }).code).toContain('$r.el("template"')
  })

  it('requires a contract for components and rejects one in pages', () => {
    expect(issues('<template><div></div></template>')).toEqual([
      'T4013 1:1 This component has no <contract>. Every component needs one, for example <contract>{ "name": "Card", "role": "group", "parts": ["root"] }</contract>.',
    ])
    expect(issues('<template><div></div></template>', { contract: 'optional' })).toEqual([])
    expect(issues('<template><div></div></template>', { kind: 'page' })).toEqual([])
    expect(issues(card()('<div class="root"></div>'), { kind: 'page' })).toEqual([
      'T4013 1:1 A page cannot have a <contract>. Only components are part of the design system.',
    ])
  })

  it('reports contract errors at their real position in the file', () => {
    const src =
      '\n\n<contract>\n{ "name": "Card", "role": "buton", "parts": ["root"] }\n</contract>\n<template><div class="root"></div></template>'
    expect(issues(src)).toEqual(['T3005 4:27 Unknown ARIA role "buton". | Did you mean "button"?'])
  })
})

describe('template syntax', () => {
  it('requires exactly one root element', () => {
    expect(issues(card()('<div class="root"></div><p></p>'))).toEqual([
      expect.stringMatching(
        /^T4004 4:\d+ A template must have exactly one root element, found 2\. Wrap them in a single element such as <div class="root">\.$/,
      ),
    ])
    expect(issues(card()('  '))).toEqual([
      'T4004 4:11 The template is empty. A component needs exactly one root element.',
    ])
    expect(issues(card()('<div class="root" if="true"></div>'))).toEqual([
      expect.stringMatching(
        /^T4004 4:\d+ The root element cannot use "if"\. Put it on an element inside the root\.$/,
      ),
    ])
  })

  it('reports unclosed and mismatched tags', () => {
    expect(issues(card()('<div class="root"><p></div>'))[0]).toMatch(
      /^T4003 4:\d+ Unexpected closing tag <\/div>\. Expected <\/p> to close the <p> at line 4\.$/,
    )
    expect(issues(card()('<div class="root">'))).toEqual([
      expect.stringMatching(/^T4003 4:\d+ The <div> tag is never closed\. Add <\/div>\.$/),
    ])
    expect(issues(card()('<div class="root">{oops</div>'))).toEqual([
      // The rest of the template is swallowed by the open brace, so the div is unclosed too.
      expect.stringMatching(/^T4003 4:\d+ The <div> tag is never closed\. Add <\/div>\.$/),
      expect.stringMatching(
        /^T4003 4:\d+ This "\{" is never closed\. Write a literal brace as \{"\{"\}\.$/,
      ),
    ])
  })
})

describe('expressions and signals', () => {
  const src = card({ script: 'const count = state(0)' })

  it('rejects an unknown name with a suggestion', () => {
    expect(issues(src('<div class="root">{cnt}</div>'))).toEqual([
      expect.stringMatching(
        /^T4006 7:\d+ Unknown name "cnt" in the template\. It is not declared in <script> and is not a loop variable\. \| Did you mean "count"\?$/,
      ),
    ])
  })

  it('rejects invalid expressions', () => {
    expect(issues(src('<div class="root">{1 +}</div>'))).toEqual([
      expect.stringMatching(/^T4005 7:\d+ Invalid expression: Unexpected token\.$/),
    ])
    expect(issues(src('<div class="root">{count count}</div>'))[0]).toMatch(
      /^T4005 7:\d+ Unexpected content after the expression/,
    )
  })

  it('errors on a signal nested in an object, with the documented message', () => {
    const nested = card({ script: 'const user = { name: state("a"), age: 3 }' })
    expect(issues(nested('<div class="root">{user.name}</div>'))).toEqual([
      expect.stringMatching(
        /^T4012 7:\d+ Signal "user\.name" is nested inside an object and will not unwrap in the template\. Destructure it to a top-level binding or read \.value\.$/,
      ),
    ])
    // A plain member of the same object is fine.
    expect(issues(nested('<div class="root">{user.age}</div>'))).toEqual([])
  })

  it('errors when reaching a signal through the object returned by props()', () => {
    const viaProps = card({ script: 'const p = props({ open: false })' })
    expect(issues(viaProps('<div class="root">{p.open}</div>'))).toEqual([
      expect.stringMatching(/^T4012 7:\d+ Signal "p\.open" is nested inside an object/),
    ])
    const destructured = card({ script: 'const { open } = props({ open: false })' })
    expect(issues(destructured('<div class="root">{open}</div>'))).toEqual([])
  })

  it('unwraps top-level signals and leaves other names alone', () => {
    const code = compile(
      card({
        script:
          'const count = state(0)\nconst n = 5\nfunction inc() {}\nimport { shared } from "./shared"',
      })(
        '<div class="root" @click="inc" :title="count + n + shared">{count} {Math.max(n, 2)}</div>',
      ),
      { file: 'Card.tess' },
    ).code
    expect(code).toContain('"title": () => (count.value + n + $u(shared))')
    expect(code).toContain('"click": inc')
    expect(code).toContain('Math.max(n, 2)')
  })

  it('writes .value for assignments in handlers', () => {
    const code = compile(
      card({ script: 'const count = state(0)' })(
        '<div class="root" @click="count++; count += 2"></div>',
      ),
      { file: 'Card.tess' },
    ).code
    expect(code).toContain('($event: any) => { count.value++; count.value += 2 }')
  })

  it('does not rewrite local names, property keys or member names', () => {
    const code = compile(
      card({ script: 'const count = state(0)' })(
        '<div class="root">{[1, 2].map((count) => count + 1).join()} {({ count: 1 }).count}</div>',
      ),
      { file: 'Card.tess' },
    ).code
    expect(code).toContain('[1, 2].map((count) => count + 1).join()')
    expect(code).toContain('({ count: 1 }).count')
  })

  it('rewrites shorthand properties', () => {
    const code = compile(
      card({ script: 'const count = state(0)' })(
        '<div class="root">{JSON.stringify({ count })}</div>',
      ),
      { file: 'Card.tess' },
    ).code
    expect(code).toContain('JSON.stringify({ count: count.value })')
  })

  it('refuses to assign to functions', () => {
    const fn = card({ script: 'function f() {}' })
    expect(issues(fn('<div class="root" @click="f = 1"></div>'))).toEqual([
      expect.stringMatching(/^T4011 7:\d+ Cannot assign to "f", which is a function\.$/),
    ])
  })

  it('warns when derived() assigns a signal or calls emit()', () => {
    const impure = card({
      script:
        'const a = state(0)\nconst d = derived(() => { a.value++; emit("change"); return 1 })',
    })
    expect(issues(impure('<div class="root"></div>'))).toEqual([
      'W4101 6:27 derived() should be pure, but it assigns a.value. Move side effects into effect().',
      'W4101 6:38 derived() should be pure, but it calls emit(). Move side effects into effect().',
    ])
    const pure = card({ script: 'const a = state(0)\nconst d = derived(() => a.value == 1)' })
    expect(issues(pure('<div class="root"></div>'))).toEqual([])
  })

  it('checks emit() calls against the contract events', () => {
    const emits = card({ script: 'emit("chnage")' })
    expect(issues(emits('<div class="root"></div>'))).toEqual([
      'T4010 5:6 Card does not declare an event "chnage". | Did you mean "change"?',
    ])
  })
})

describe('directives', () => {
  const src = card({ script: 'const xs = state([{ id: 1 }])\nconst on = state(true)' })
  const strip = (list: string[]) => list.map((i) => i.replace(/^(\w+) \d+:\d+/, '$1'))
  const fmt = (t: string) => strip(issues(src(`<div class="root">${t}</div>`)))

  it('requires a key with each, and the right shape', () => {
    expect(fmt('<i each="x in xs"></i>')).toEqual([
      'T4011 "each" needs a key, for example <i each="x in items" key="x.id">.',
    ])
    expect(fmt('<i each="xs" key="1"></i>')).toEqual([
      'T4011 "each" must look like each="item in items", got "xs".',
    ])
    expect(fmt('<i key="x"></i>')).toEqual(['T4011 "key" is only used together with "each".'])
    expect(fmt('<i each="x in xs" key="x.id" if="on"></i>')).toEqual([
      'T4011 An element cannot have both "if" and "each". Put one of them on a wrapper element.',
    ])
  })

  it('requires else and else-if to follow an if', () => {
    expect(fmt('<p else>x</p>')).toEqual([
      'T4011 "else" needs an element with "if" or "else-if" right before it.',
    ])
    expect(fmt('<p if="on">a</p><p else-if="!on">b</p><p else>c</p>')).toEqual([])
    expect(fmt('<p if="on">a</p>\n<p else>c</p>')).toEqual([])
  })

  it('restricts bind:value to a state() on a form control', () => {
    const form = card({ script: 'const name = state("")\nconst n = 5' })
    const f = (t: string) => strip(issues(form(`<div class="root">${t}</div>`)))
    expect(f('<input bind:value="name" />')).toEqual([])
    expect(f('<p bind:value="name"></p>')).toEqual([
      'T4011 "bind:value" works only as bind:value on <input>, <textarea> and <select>.',
    ])
    expect(f('<input bind:value="n" />')).toEqual([
      'T4011 bind:value needs a signal made with state(), but "n" is not one.',
    ])
    expect(f('<input bind:value="nme" />')).toEqual([
      'T4011 bind:value needs a signal made with state(), but "nme" is not declared in <script>. | Did you mean "name"?',
    ])
  })

  it('compiles if/else-if/else into one conditional and each into a keyed list', () => {
    const code = compile(
      src(
        '<div class="root"><p if="on">a</p><p else>b</p><i each="x in xs" key="x.id">{x.id}</i></div>',
      ),
      { file: 'Card.tess' },
    ).code
    expect(code).toContain(
      '$r.cond(() => (on.value) ? 0 : 1, [() => $r.el("p", {}, "a"), () => $r.el("p", {}, "b")])',
    )
    expect(code).toContain(
      '$r.each(() => (xs.value), (x) => (x.id), (x) => $r.el("i", {}, () => (x.value.id)))',
    )
  })

  it('handles two-way binding and merges handlers for the same event', () => {
    const form = card({ script: 'const name = state("")\nfunction log() {}' })
    const code = compile(form('<input class="root" bind:value="name" @input="log" />'), {
      file: 'Card.tess',
    }).code
    expect(code).toContain('props: { "value": () => name.value }')
    expect(code).toContain(
      '"input": ($e: any) => { (($e: any) => { name.value = $e.target.value })($e); (log)($e) }',
    )
  })

  it('sends value to a property and other bindings to attributes', () => {
    const code = compile(
      card({ script: 'const v = state(1)' })(
        '<input class="root" :value="v" :title="v" disabled />',
      ),
      { file: 'Card.tess' },
    ).code
    expect(code).toContain('"title": () => (v.value), "disabled": true }')
    expect(code).toContain('props: { "value": () => (v.value) }')
  })

  it('collapses formatting whitespace in text', () => {
    const code = compile(
      card({ script: 'const n = state(1)' })(
        '\n  <div class="root">\n    Clicked  {n}\n    times\n  </div>\n',
      ),
      { file: 'Card.tess' },
    ).code
    expect(code).toContain(
      '$r.el("div", { attrs: { "class": "t-Card__root" } }, () => "Clicked " + (n.value) + " times")',
    )
  })
})

describe('contract against template', () => {
  it('reports a declared part that is not a class', () => {
    expect(issues(card({ parts: ', "icon"' })('<div class="root"></div>'))).toEqual([
      'T3011 2:54 Part "icon" is declared in the contract, but no element in the template has class="icon". | Add class="icon" to an element, or remove "icon" from parts.',
    ])
    expect(
      issues(card({ parts: ', "icon"' })('<div class="root"><b class="icon"></b></div>')),
    ).toEqual([])
  })

  it('reports a root element without the root class', () => {
    expect(issues(card()('<div class="box"></div>'))).toEqual([
      expect.stringContaining('T3011'),
      'T3013 2:46 The template\'s root element must carry class="root". | Add class="root" to the outermost element.',
    ])
  })

  it('lets private classes through', () => {
    expect(issues(card()('<div class="root helper"></div>'))).toEqual([])
  })

  it('reports an undeclared slot', () => {
    expect(issues(card()('<div class="root"><slot name="icn" /></div>'))).toEqual([
      expect.stringMatching(
        /^T4009 4:\d+ Slot "icn" is not declared in the contract\. \| Add "icn" to "slots" in <contract>\.$/,
      ),
    ])
    expect(
      issues(
        card({ slots: '"default": "x", "icon": "i"' })(
          '<div class="root"><slot name="ico" /></div>',
        ),
      ),
    ).toEqual([
      expect.stringMatching(
        /Slot "ico" is not declared in the contract\. \| Did you mean "icon"\?$/,
      ),
    ])
    expect(issues(card()('<div class="root"><slot>fallback</slot></div>'))).toEqual([])
  })
})

describe('using components', () => {
  const toolbar = (inner: string, script = "import Button from './Button.tess'") =>
    card({ script })(`<div class="root">${inner}</div>`)
  const withButton = (inner: string, script?: string) =>
    issues(toolbar(inner, script), { components: resolver })

  it('accepts valid usage', () => {
    expect(
      withButton('<Button tone="danger" size="md" @press="emit(\'change\')">Save</Button>'),
    ).toEqual([])
  })

  it('reports an unknown component with a suggestion', () => {
    expect(withButton('<Buton>x</Buton>')).toEqual([
      expect.stringMatching(
        /^T4007 \d+:\d+ Unknown component <Buton>\. \| Did you mean <Button>\?$/,
      ),
    ])
    expect(issues(toolbar('<Thing></Thing>', ''), { components: resolver })).toEqual([
      expect.stringMatching(
        /^T4007 \d+:\d+ Unknown component <Thing>\. \| Import it in <script>, for example: import Thing from "\.\/Thing\.tess"$/,
      ),
    ])
  })

  it('reports an invalid variant value with the closest valid one, in the spec wording', () => {
    const source = toolbar('<Button tone="dangr">Delete</Button>')
    const result = compile(source, { file: 'Card.tess', components: resolver })
    const line = source.split('\n').findIndex((l) => l.includes('dangr'))
    const column = source.split('\n')[line]!.indexOf('dangr') + 1
    expect(formatDiagnostic(result.diagnostics[0]!)).toBe(
      [
        `ERROR  T4008  Card.tess:${line + 1}:${column}`,
        '  Button.tone has no value "dangr".',
        '  Did you mean "danger"?',
        '  Run `tessera explain T4008` for details.',
      ].join('\n'),
    )
    expect(withButton('<Button size="xl">x</Button>')).toEqual([
      expect.stringMatching(/Button\.size has no value "xl"\. \| Allowed values: "sm", "md"\.$/),
    ])
  })

  it('does not check dynamic variant values', () => {
    expect(
      withButton(
        '<Button :tone="whatever">x</Button>',
        "import Button from './Button.tess'\nconst whatever = 'danger'",
      ),
    ).toEqual([])
  })

  it('reports unknown events and slots', () => {
    expect(withButton('<Button @pres="emit(\'change\')">x</Button>')).toEqual([
      expect.stringMatching(
        /^T4010 \d+:\d+ Button has no event "pres"\. \| Did you mean "press"\?$/,
      ),
    ])
    expect(withButton('<Button><i slot="icn"></i></Button>')).toEqual([
      expect.stringMatching(/^T4009 \d+:\d+ Button has no slot "icn"\. \| Did you mean "icon"\?$/),
    ])
  })

  it('imports components that the template uses but the script does not import', () => {
    const code = compile(toolbar('<Button>x</Button>', ''), {
      file: 'Card.tess',
      components: resolver,
    }).code
    expect(code).toContain('import Button from "./Button.tess"')
    const explicit = compile(toolbar('<Button>x</Button>'), {
      file: 'Card.tess',
      components: resolver,
    }).code
    expect(explicit.match(/import Button from/g)).toHaveLength(1)
  })

  it('builds props, events and slots for the call', () => {
    const code = compile(
      toolbar(
        '<Button tone="danger" :disabled="true" @press="emit(\'change\')"><b slot="icon">!</b>Go</Button>',
      ),
      { file: 'Card.tess', components: resolver },
    ).code
    expect(code).toContain(
      'Button({ props: { "tone": $constant("danger"), "disabled": $derived(() => (true)) }, events: { "press": ($event: any) => { emit(\'change\') } }, slots: { "icon": () => [$r.el("b", {}, "!")], "default": () => ["Go"] } })',
    )
  })
})

describe('generated module', () => {
  const toolbar = fixture('Toolbar.tess')

  it('hoists imports, imports only the APIs the script uses, and names the component', () => {
    const code = compile(toolbar, { file: 'Toolbar.tess', components: resolver }).code
    expect(code.split('\n')[0]).toBe(
      'import { defineComponent as $defineComponent, getRenderer as $getRenderer, constant as $constant, derived as $derived, unwrap as $u, state } from "@pixelscriptio/tessera/core"',
    )
    expect(code).toContain("import Button from './Button.tess'")
    expect(code).toContain('export default $defineComponent("Toolbar", {}, ($ctx')
    expect(code).toContain('return $ctx.root(')
  })

  it('keeps script lines in place by blanking hoisted imports', () => {
    const code = compile(toolbar, { file: 'Toolbar.tess', components: resolver }).code
    const body = code.split('\n')
    const emitLine = body.findIndex((l) => l === '  const emit = $ctx.emit')
    const sourceLines = toolbar.split('\n')
    const tagLine = sourceLines.findIndex((l) => l === '<script>')
    for (const text of ['const saves = state(0)', 'function save() {']) {
      const sourceLine = sourceLines.findIndex((l) => l === text)
      expect(body[emitLine + 1 + (sourceLine - tagLine)]).toBe(text)
    }
    // The import line itself is blanked, not removed.
    const importLine = sourceLines.findIndex((l) => l.startsWith('import Button'))
    expect(body[emitLine + 1 + (importLine - tagLine)]?.trim()).toBe('')
  })

  it('adds hot-update support only when asked', () => {
    expect(compile(toolbar, { file: 'Toolbar.tess', components: resolver }).code).not.toContain(
      'import.meta.hot',
    )
    const hot = compile(toolbar, {
      file: 'Toolbar.tess',
      components: resolver,
      hmrId: 'x/Toolbar.tess',
    }).code
    expect(hot).toContain('}, "x/Toolbar.tess")')
    expect(hot).toContain('if (import.meta.hot) import.meta.hot.accept()')
  })

  it('exposes component imports and contracts for hosts', () => {
    expect(listImports(toolbar)).toEqual([
      { local: 'Button', imported: 'default', source: './Button.tess' },
    ])
    expect(extractContract(toolbar, 'Toolbar.tess')?.name).toBe('Toolbar')
  })

  it('returns no code when there are errors, and does not throw on garbage', () => {
    const bad = compile('<template><div></template>', { file: 'x.tess' })
    expect(bad.ok).toBe(false)
    expect(bad.code).toBe('')
    expect(() => compile('', { file: 'x.tess' })).not.toThrow()
    expect(() => compile('<<<>>> {{{ <script>`', { file: 'x.tess' })).not.toThrow()
  })
})

describe('browser-safe core', () => {
  it('uses no Node APIs outside the Node entries (vite.ts, mock-server.ts, node.ts, project.ts, config-file.ts)', () => {
    const roots = ['../src', '../../contract/src', '../../core/src']
    for (const root of roots) {
      const dir = fileURLToPath(new URL(root, import.meta.url))
      for (const name of readdirSync(dir).filter(
        (n) =>
          n.endsWith('.ts') &&
          !['vite.ts', 'mock-server.ts', 'node.ts', 'project.ts', 'config-file.ts'].includes(n),
      )) {
        const text = readFileSync(`${dir}/${name}`, 'utf8')
        expect(text, `${root}/${name}`).not.toMatch(/from ['"]node:|require\(|process\./)
      }
    }
  })
})

describe('token references in styles', () => {
  const tokens = ['color.action.primary.bg', 'color.action.primary.fg', 'space.4']
  const withStyle = (css: string) =>
    card()('<div class="root"></div>') + `\n<style>\n${css}\n</style>`

  it('reports an unknown token with the closest match, in the spec format', () => {
    const source = withStyle('.root {\n  background: $color.action.primry.bg;\n}')
    const result = compile(source, { file: 'Card.tess', tokens })
    expect(result.diagnostics.map(formatDiagnostic)).toEqual([
      [
        'ERROR  T2104  Card.tess:7:15',
        '  Unknown token "$color.action.primry.bg"',
        '  Did you mean "$color.action.primary.bg"?',
        '  Run `tessera explain T2104` for details.',
      ].join('\n'),
    ])
  })

  it('accepts known tokens, ignores comments, and is off when no tokens are given', () => {
    const css = '.root { padding: $space.4; /* $nope.nothing */ color: $color.action.primary.fg; }'
    expect(issues(withStyle(css), { tokens })).toEqual([])
    expect(issues(withStyle('.root { padding: $space.9; }'))).toEqual([])
  })
})
