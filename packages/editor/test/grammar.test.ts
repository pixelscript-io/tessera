import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma'
import { INITIAL, Registry, parseRawGrammar, type IGrammar } from 'vscode-textmate'
import { beforeAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const grammarPath = fileURLToPath(
  new URL('../vscode/syntaxes/tess.tmLanguage.json', import.meta.url),
)

// Grammars for the embedded languages come from VS Code itself; stubs are enough to prove the regions.
const stubs: Record<string, object> = {
  'source.ts': {
    scopeName: 'source.ts',
    patterns: [],
    repository: { expression: { patterns: [] } },
  },
  'source.css': { scopeName: 'source.css', patterns: [] },
  'source.json.comments': { scopeName: 'source.json.comments', patterns: [] },
}

let grammar: IGrammar

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'))
  await loadWASM(
    wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
  )
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scopeName) => {
      if (scopeName === 'source.tess') {
        return parseRawGrammar(readFileSync(grammarPath, 'utf8'), grammarPath)
      }
      const stub = stubs[scopeName]
      return stub ? parseRawGrammar(JSON.stringify(stub), `${scopeName}.json`) : null
    },
  })
  grammar = (await registry.loadGrammar('source.tess'))!
})

const SOURCE = `<contract>
{ "name": "Counter", "role": "group" } // comment
</contract>

<script lang="ts">
const count = state(0)
</script>

<template>
  <div class="root" :title="label" @click="count++">
    <!-- note -->
    <slot name="icon" />
    <Button tone="danger" @press="save">Save {count}</Button>
    <p if="count > 2">Many</p>
    <p else>Few</p>
    <li each="todo in todos" key="todo.id">{todo.text}</li>
    <input bind:value="name" />
  </div>
</template>

<style>
.root {
  /* $nope.nothing */
  padding: $space.4;
  margin: raw(13px, "legacy");
}
</style>
`

const LINES = SOURCE.split('\n')

/** Tokenize the whole file and return, for each line, the tokens with their scope stacks. */
function tokenize() {
  let stack = INITIAL
  return LINES.map((line) => {
    const result = grammar.tokenizeLine(line, stack)
    stack = result.ruleStack
    return result.tokens.map((t) => ({
      text: line.slice(t.startIndex, t.endIndex),
      scopes: t.scopes,
    }))
  })
}

/** Scopes of the first token on `lineIndex` whose text equals `text`. */
function scopesOf(lineIndex: number, text: string): string[] {
  const token = tokenize()[lineIndex]!.find((t) => t.text === text)
  if (!token) {
    const seen = tokenize()
      [lineIndex]!.map((t) => JSON.stringify(t.text))
      .join(' ')
    throw new Error(`No token "${text}" on line ${lineIndex + 1}. Tokens: ${seen}`)
  }
  return token.scopes
}

const lineOf = (needle: string) => LINES.findIndex((l) => l.includes(needle))

describe('TextMate grammar', () => {
  it('loads', () => {
    expect(grammar).toBeTruthy()
  })

  it('highlights the block tags', () => {
    for (const name of ['contract', 'script', 'template', 'style']) {
      const line = lineOf(`<${name}`)
      expect(scopesOf(line, name)).toContain('entity.name.tag.block.tess')
      expect(scopesOf(line, '<')).toContain('punctuation.definition.tag.begin.tess')
    }
    expect(scopesOf(LINES.indexOf('</style>'), 'style')).toContain('entity.name.tag.block.tess')
  })

  it('marks each block body as the right embedded language region', () => {
    const contract = tokenize()[lineOf('"name": "Counter"')]!
    expect(contract.every((t) => t.scopes.includes('meta.embedded.block.contract'))).toBe(true)
    expect(contract.every((t) => t.scopes.includes('meta.block.contract.tess'))).toBe(true)

    const script = tokenize()[lineOf('const count')]!
    expect(script.every((t) => t.scopes.includes('meta.embedded.block.script'))).toBe(true)

    const style = tokenize()[lineOf('padding:')]!
    expect(style.some((t) => t.scopes.includes('meta.embedded.block.style'))).toBe(true)

    const template = tokenize()[lineOf('<slot')]!
    expect(template.every((t) => t.scopes.includes('meta.embedded.block.template'))).toBe(true)
  })

  it('highlights html tags, component tags and slots differently', () => {
    expect(scopesOf(lineOf('<div'), 'div')).toContain('entity.name.tag.html.tess')
    expect(scopesOf(lineOf('<Button'), 'Button')).toContain('entity.name.tag.component.tess')
    expect(scopesOf(lineOf('<Button'), 'Button')).toContain('support.class.component.tess')
    expect(scopesOf(lineOf('<slot'), 'slot')).toContain('entity.name.tag.slot.tess')
    // The closing tag of a component is highlighted like its opening tag.
    const buttons = tokenize()[lineOf('<Button')]!.filter((t) => t.text === 'Button')
    expect(buttons).toHaveLength(2)
    expect(buttons[1]!.scopes).toContain('entity.name.tag.component.tess')
  })

  it('highlights directives and gives their values an expression region', () => {
    const line = lineOf('<div')
    expect(scopesOf(line, 'title')).toContain('entity.other.attribute-name.directive.tess')
    expect(scopesOf(line, ':')).toContain('punctuation.definition.directive.tess')
    expect(scopesOf(line, 'click')).toContain('entity.other.attribute-name.directive.tess')
    expect(scopesOf(line, 'label')).toContain('meta.embedded.expression.tess')
    expect(scopesOf(line, 'count++')).toContain('meta.embedded.expression.tess')
    expect(scopesOf(lineOf('bind:value'), 'value')).toContain(
      'entity.other.attribute-name.directive.tess',
    )
    expect(scopesOf(lineOf('@press'), 'press')).toContain(
      'entity.other.attribute-name.directive.tess',
    )
  })

  it('highlights if, else-if, else, each and key as control attributes', () => {
    expect(scopesOf(lineOf('<p if='), 'if')).toContain('keyword.control.directive.tess')
    expect(scopesOf(lineOf('count > 2'), 'count > 2')).toContain('meta.embedded.expression.tess')
    expect(scopesOf(lineOf('<p else'), 'else')).toContain('keyword.control.directive.tess')
    const each = lineOf('each=')
    expect(scopesOf(each, 'each')).toContain('keyword.control.directive.tess')
    expect(scopesOf(each, 'key')).toContain('keyword.control.directive.tess')
    expect(scopesOf(each, 'todo in todos')).toContain('meta.embedded.expression.tess')
  })

  it('does not mistake data-if or class="else" for control attributes', () => {
    const text = '<div data-if="x" class="else">'
    const { tokens } = grammar.tokenizeLine(text, INITIAL)
    expect(tokens.some((t) => t.scopes.includes('keyword.control.directive.tess'))).toBe(false)
  })

  it('puts text interpolations in an expression region', () => {
    const line = lineOf('Save {count}')
    expect(scopesOf(line, '{')).toContain('punctuation.definition.interpolation.begin.tess')
    expect(scopesOf(line, 'count')).toContain('meta.embedded.expression.tess')
    expect(scopesOf(line, '}')).toContain('punctuation.definition.interpolation.end.tess')
    expect(scopesOf(lineOf('{todo.text}'), 'todo.text')).toContain('meta.embedded.expression.tess')
  })

  it('highlights html comments and plain attributes', () => {
    expect(scopesOf(lineOf('note'), '<!--')).toContain('comment.block.html')
    expect(scopesOf(lineOf('<div'), 'class')).toContain('entity.other.attribute-name.html')
    expect(scopesOf(lineOf('<div'), '"root"')).toContain('string.quoted.html')
    expect(scopesOf(lineOf('tone='), 'tone')).toContain('entity.other.attribute-name.html')
  })

  it('highlights $tokens and raw() in styles', () => {
    expect(scopesOf(lineOf('padding:'), '$space.4')).toContain('variable.other.token.tess')
    expect(scopesOf(lineOf('raw('), 'raw')).toContain('support.function.raw.tess')
  })

  it('leaves the style region after </style>', () => {
    const lines = tokenize()
    expect(
      lines[LINES.indexOf('</style>')]!.every((t) => t.scopes.includes('meta.block.style.tess')),
    ).toBe(true)
    expect(lines[LINES.length - 1]!.every((t) => !t.scopes.includes('meta.block.style.tess'))).toBe(
      true,
    )
  })
})
