import type { CodeLine, Kind } from './code'

const line = (...parts: Array<[string, Kind?] | string>): CodeLine => ({
  segs: parts.map((p) =>
    typeof p === 'string' ? { text: p, kind: '' as Kind } : { text: p[0], kind: p[1] ?? '' },
  ),
})

export interface Example {
  label: string
  title: string
  body: string
  lines: CodeLine[]
}

export const LINT: Example = {
  label: 'tessera lint',
  title: "Lint any project's CSS against your tokens.",
  body: "Run it in any project's folder, with your design tokens as DTCG files. It reads CSS files and the style blocks of .vue, .svelte, .astro and .html, and finds raw colors, off-scale values, wrong token kinds and failing contrast, in every theme. --fix applies the unambiguous ones; --baseline lets an existing project start at zero.",
  lines: [
    line(['$ ', 'com'], 'npx tessera lint --tokens design/tokens'),
    line(),
    line(['ERROR', 'err'], '  ', ['T2102', 'tag'], '  src/Card.module.css:2:12'),
    line('  Raw length "13px" in "padding" is off the scale.'),
    line('  Did you mean ', ['"var(--t-space-3)"', 'tok'], ' (12px)?'),
    line(),
    line('1 error, 0 warnings in 14 files.'),
  ],
}

export const ELEMENTS: Example = {
  label: 'tessera elements',
  title: 'The design system as custom elements.',
  body: 'Each component, with its tokens, themes and accessibility, built into a folder with no dependency on Tessera. React wrappers and types included. The tessera preset is 11 elements in about 9 kB of JavaScript and 3 kB of CSS, gzipped.',
  lines: [
    line(
      ['<link', 'tag'],
      ' rel=',
      ['"stylesheet"', 'str'],
      ' href=',
      ['"elements.css"', 'str'],
      ' ',
      ['/>', 'tag'],
    ),
    line(
      ['<script', 'tag'],
      ' type=',
      ['"module"', 'str'],
      ' src=',
      ['"elements.js"', 'str'],
      ['></script>', 'tag'],
    ),
    line(),
    line(['<t-button', 'tag'], ' tone=', ['"danger"', 'str'], ['>', 'tag'], 'Delete', [
      '</t-button>',
      'tag',
    ]),
    line(['<t-checkbox', 'tag'], ' checked', ['>', 'tag'], 'Send me product news', [
      '</t-checkbox>',
      'tag',
    ]),
  ],
}
