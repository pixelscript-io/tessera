import { describe, expect, it } from 'vitest'
import { parseCss, selectorClasses, type CssNode } from '../src/style/css'

/** A compact view of the tree for assertions. */
const shape = (nodes: CssNode[]): unknown[] =>
  nodes.map((n) =>
    n.type === 'decl'
      ? `${n.prop}: ${n.value}`
      : n.type === 'rule'
        ? { [n.selector]: shape(n.children) }
        : { [`@${n.name} ${n.params}`.trim()]: n.children ? shape(n.children) : null },
  )

describe('parseCss', () => {
  it('parses rules and declarations', () => {
    const { nodes, errors } = parseCss('.a { color: red; padding: 1px 2px }\n.b { margin: 0 }', 0)
    expect(errors).toEqual([])
    expect(shape(nodes)).toEqual([
      { '.a': ['color: red', 'padding: 1px 2px'] },
      { '.b': ['margin: 0'] },
    ])
  })

  it('parses nesting, with & and attribute selectors', () => {
    const { nodes } = parseCss(
      '.root { color: red; &[data-tone="danger"] { color: blue; } &:hover { color: green } .icon { margin: 0 } }',
      0,
    )
    expect(shape(nodes)).toEqual([
      {
        '.root': [
          'color: red',
          { '&[data-tone="danger"]': ['color: blue'] },
          { '&:hover': ['color: green'] },
          { '.icon': ['margin: 0'] },
        ],
      },
    ])
  })

  it('parses at-rules with and without blocks', () => {
    const { nodes } = parseCss(
      '@import "x.css";\n@media (min-width: 40rem) { .a { color: red } }\n@layer a, b;',
      0,
    )
    expect(shape(nodes)).toEqual([
      { '@import "x.css"': null },
      { '@media (min-width: 40rem)': [{ '.a': ['color: red'] }] },
      { '@layer a, b': null },
    ])
  })

  it('keeps semicolons and braces inside strings, urls and functions', () => {
    const { nodes, errors } = parseCss(
      '.a { background: url("data:image/svg+xml;utf8,<svg>{}</svg>") no-repeat; content: "a;b}"; width: calc(1px + (2px * 3)) }',
      0,
    )
    expect(errors).toEqual([])
    expect(shape(nodes)).toEqual([
      {
        '.a': [
          'background: url("data:image/svg+xml;utf8,<svg>{}</svg>") no-repeat',
          'content: "a;b}"',
          'width: calc(1px + (2px * 3))',
        ],
      },
    ])
  })

  it('skips comments', () => {
    const { nodes } = parseCss('/* a */ .a { /* b */ color: red; /* c */ }', 0)
    expect(shape(nodes)).toEqual([{ '.a': ['color: red'] }])
  })

  it('records absolute offsets for selectors, properties and values', () => {
    const css = '.a { padding: 8px; }'
    const { nodes } = parseCss(css, 100)
    const rule = nodes[0] as Extract<CssNode, { type: 'rule' }>
    expect(rule.selectorStart).toBe(100)
    const decl = rule.children[0] as Extract<CssNode, { type: 'decl' }>
    expect(css.slice(decl.propStart - 100, decl.propStart - 100 + 7)).toBe('padding')
    expect(css.slice(decl.valueStart - 100, decl.valueStart - 100 + 3)).toBe('8px')
  })

  it('separates !important from the value', () => {
    const { nodes } = parseCss('.a { color: red !important }', 0)
    const rule = nodes[0] as Extract<CssNode, { type: 'rule' }>
    expect(rule.children[0]).toMatchObject({ value: 'red', important: true })
  })

  it('handles custom properties and values with colons', () => {
    const { nodes } = parseCss('.a { --x: 4px; background: url(http://x/y) }', 0)
    expect(shape(nodes)).toEqual([{ '.a': ['--x: 4px', 'background: url(http://x/y)'] }])
  })

  it('reports unbalanced braces and junk', () => {
    expect(parseCss('.a { color: red', 5).errors).toEqual([
      { offset: 20, message: 'A "{" is never closed.' },
    ])
    expect(parseCss('.a { } }', 0).errors).toEqual([{ offset: 7, message: 'Unexpected "}".' }])
    expect(parseCss('.a { oops; }', 0).errors).toEqual([
      { offset: 5, message: 'Expected a declaration like "property: value", found "oops".' },
    ])
    expect(parseCss('/* open', 0).errors).toEqual([{ offset: 0, message: 'Unterminated comment.' }])
  })
})

describe('selectorClasses', () => {
  it('finds classes, including inside :not() and lists', () => {
    expect(selectorClasses('.a.b > .c:not(.d), .e', 0).map((c) => c.name)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ])
  })

  it('ignores dots in attribute values, strings and escapes', () => {
    expect(selectorClasses('[href$=".pdf"] .a', 0).map((c) => c.name)).toEqual(['a'])
    expect(selectorClasses('.a\\.b', 0).map((c) => c.name)).toEqual(['a'])
    expect(selectorClasses('&:hover', 0)).toEqual([])
  })

  it('reports where the name starts', () => {
    expect(selectorClasses('  .root:hover', 10)).toEqual([{ name: 'root', start: 13 }])
  })
})
