import { CONTRACT_CODES } from '@tessera/contract'
import { TOKEN_CODES } from '@tessera/tokens'
import { COMPILER_CODES } from './diagnostics'

/**
 * Something that produces the code when run, so the example on a reference page is real: a test runs every
 * one and checks the code comes out, and the generated page shows the actual message.
 */
export type Example =
  | {
      kind: 'tess'
      /** The file name the compiler sees. Its folder decides whether it is a component, page or layout. */
      file: string
      source: string
      /** Make `<Button>` and `<Link>` known, as they are in a project. */
      uses?: Array<'Button' | 'Link'>
      /** Other components the example's project has, by name and `.tess` source (a deprecated one, say). */
      components?: Array<{ name: string; source: string }>
      /** Tokens to treat as deprecated in this example, by path. */
      deprecatedTokens?: string[]
      /** Names of the apis the project has (files in `app/apis`), such as `github`. */
      apis?: string[]
      options?: {
        routes?: string[]
        layouts?: string[]
        autoImports?: boolean
        contract?: 'required' | 'optional'
        today?: string
      }
    }
  | { kind: 'tokens'; base: Array<[string, unknown]>; themes?: Array<[string, unknown]> }
  | { kind: 'import'; files: Array<[string, unknown]> }
  | { kind: 'routes'; files: string[] }
  | { kind: 'apis'; files: string[] }
  | { kind: 'ts'; file: string; source: string }
  | { kind: 'config'; config: Record<string, unknown> }
  | { kind: 'registry'; files: Array<{ file: string; source: string }> }

export interface Explanation {
  /** Why it happens. */
  cause: string
  /** How to fix it. */
  fix: string
  example: Example
  /** What the fixed example looks like, for codes where a corrected snippet helps. */
  fixed?: string
}

const colorToken = { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0] } }

const component = (
  name: string,
  parts: string,
  style = '',
  template = '<div class="root"></div>',
) =>
  `<contract>
{ "name": "${name}", "role": "group", "parts": ${parts} }
</contract>
<template>${template}</template>${style ? `\n<style>\n${style}\n</style>` : ''}
`

const page = (head: string, body = '<h1>Hi</h1>') =>
  `${head}<template><main>${body}</main></template>\n`

const style = (css: string, name = 'Card') => component(name, '["root"]', css)

const tess = (
  source: string,
  extra: Partial<Extract<Example, { kind: 'tess' }>> = {},
): Example => ({ kind: 'tess', file: 'app/components/Card.tess', source, ...extra })

const pageExample = (
  source: string,
  extra: Partial<Extract<Example, { kind: 'tess' }>> = {},
): Example => ({ kind: 'tess', file: 'app/pages/about.tess', source, ...extra })

export const EXPLANATIONS: Record<string, Explanation> = {
  // --- tokens -----------------------------------------------------------------------------------------
  T1001: {
    cause:
      'A token file must be a JSON object of groups and tokens, and this one is something else (an array, a string, or a number).',
    fix: 'Make the top level of the file an object. Groups nest objects; a token is an object with `$value`.',
    example: { kind: 'tokens', base: [['base.tokens.json', []]] },
  },
  T1002: {
    cause:
      'Token names become CSS custom properties (`--t-space-4`), so they may only contain letters, numbers, `-` and `_`.',
    fix: 'Rename the group or token without spaces or other punctuation.',
    example: { kind: 'tokens', base: [['base.tokens.json', { 'a b': colorToken }]] },
  },
  T1003: {
    cause:
      'Every token needs a `$type`, set on the token or inherited from a parent group, so its value can be checked and written as CSS.',
    fix: 'Add `"$type"` to the token, or to the group that holds it.',
    example: {
      kind: 'tokens',
      base: [
        ['base.tokens.json', { a: { $value: { colorSpace: 'srgb', components: [0, 0, 0] } } }],
      ],
    },
  },
  T1004: {
    cause:
      'The token has a `$type` Tessera does not support. Supported: color, dimension, duration, number, fontFamily, fontWeight, cubicBezier, strokeStyle, shadow, border and transition.',
    fix: 'Split a composite such as typography into tokens of supported types (a fontFamily, a dimension, a number).',
    example: {
      kind: 'tokens',
      base: [['base.tokens.json', { t: { $type: 'typography', $value: {} } }]],
    },
  },
  T1005: {
    cause:
      'The value does not have the shape its `$type` requires: a color is an object with `colorSpace` and `components`, a dimension is `{ "value": 16, "unit": "px" }`, and so on.',
    fix: 'Write the value in the strict DTCG form for the type. The message says which part is wrong.',
    example: {
      kind: 'tokens',
      base: [['base.tokens.json', { c: { $type: 'color', $value: 'red' } }]],
    },
  },
  T1006: {
    cause: 'An alias such as `{color.blue.50}` names a token that does not exist.',
    fix: 'Fix the name. The hint suggests the nearest existing token.',
    example: {
      kind: 'tokens',
      base: [
        [
          'base.tokens.json',
          {
            color: {
              $type: 'color',
              blue: { 500: { $value: colorToken.$value } },
              bad: { $value: '{color.blue.50}' },
            },
          },
        ],
      ],
    },
  },
  T1007: {
    cause: 'Tokens refer to each other in a loop, so none of them has a value.',
    fix: 'Break the loop: one of the tokens in the chain must hold a real value.',
    example: {
      kind: 'tokens',
      base: [
        [
          'base.tokens.json',
          {
            $type: 'color',
            a: { $value: '{b}' },
            b: { $value: '{a}' },
          },
        ],
      ],
    },
  },
  T1008: {
    cause: 'An alias points at a token of a different type than the token that uses it.',
    fix: 'Alias a token of the same type, or give the aliasing token the type it really has.',
    example: {
      kind: 'tokens',
      base: [
        [
          'base.tokens.json',
          { n: { $type: 'number', $value: 1 }, c: { $type: 'color', $value: '{n}' } },
        ],
      ],
    },
  },
  T1009: {
    cause:
      'The file uses a DTCG feature Tessera does not support yet, such as group `$extends` or a JSON Pointer `$ref`. Unsupported features are reported instead of being ignored silently.',
    fix: 'Write the tokens out in the group, or use a `{group.token}` alias.',
    example: { kind: 'tokens', base: [['base.tokens.json', { g: { $extends: '{other}' } }]] },
  },
  T1010: {
    cause:
      'A theme file must say which base it overrides with `"$extends"`, and that must be the base token set.',
    fix: 'Add `"$extends": "base"` (or the name of your base set) to the theme file.',
    example: {
      kind: 'tokens',
      base: [['base.tokens.json', { primary: colorToken }]],
      themes: [['dark.tokens.json', {}]],
    },
  },
  T1011: {
    cause:
      'A theme can only override tokens that already exist in the base, so every theme exposes the same set of names.',
    fix: 'Add the token to the base first, or fix the typo (the hint suggests the nearest name).',
    example: {
      kind: 'tokens',
      base: [['base.tokens.json', { primary: colorToken }]],
      themes: [['dark.tokens.json', { $extends: 'base', primry: colorToken }]],
    },
  },
  T1012: {
    cause: 'A theme gives a token a different `$type` than the base does.',
    fix: 'Keep the type the base declares; only the value changes in a theme.',
    example: {
      kind: 'tokens',
      base: [['base.tokens.json', { primary: colorToken }]],
      themes: [['dark.tokens.json', { $extends: 'base', primary: { $type: 'number', $value: 1 } }]],
    },
  },
  T1013: {
    cause: 'Two token files define the same token, so it is unclear which value wins.',
    fix: 'Define each token once.',
    example: {
      kind: 'tokens',
      base: [
        ['a.tokens.json', { n: colorToken }],
        ['b.tokens.json', { n: colorToken }],
      ],
    },
  },
  T1014: {
    cause:
      'A theme file sets `$attribute` or `$auto` to something invalid. `$attribute` is a lowercase name (`theme`, `density`); `$auto` is a media feature such as `prefers-color-scheme: dark`.',
    fix: 'Use a lowercase attribute name, and a full media feature for `$auto`.',
    example: {
      kind: 'tokens',
      base: [['base.tokens.json', { primary: colorToken }]],
      themes: [['dark.tokens.json', { $extends: 'base', $attribute: 'Theme' }]],
    },
  },
  T1015: {
    cause: 'Two theme files have the same name for the same attribute.',
    fix: 'Rename one theme, or give it a different `$attribute`.',
    example: {
      kind: 'tokens',
      base: [['base.tokens.json', { primary: colorToken }]],
      themes: [
        ['a/dark.tokens.json', { $extends: 'base' }],
        ['b/dark.tokens.json', { $extends: 'base' }],
      ],
    },
  },

  T1016: {
    cause:
      'An import (`tessera tokens import`) left something out or changed it, so that what it wrote builds. A type Tessera does not support (a gradient, a typography composite) is skipped and kept under `$extensions.tessera.skipped`; a unitless number is read as pixels; a name with spaces is rewritten. It is a warning: nothing is lost silently, and `tessera tokens export` puts skipped tokens back.',
    fix: 'Read the note and, if the token matters, express it in a type Tessera supports (for a typography composite, separate font family, size and weight tokens).',
    example: {
      kind: 'import',
      files: [
        [
          'brand.json',
          {
            fancy: {
              $type: 'gradient',
              $value: [{ color: { colorSpace: 'srgb', components: [0, 0, 0] }, position: 0 }],
            },
          },
        ],
      ],
    },
  },
  T1017: {
    cause:
      'An import could not read what it was given: a file that is not JSON, or a DTCG Resolver document that names a file that was not provided or a set or modifier it does not have.',
    fix: 'Check the path. `tessera tokens import` reads the files a Resolver names from beside it, so keep them together.',
    example: {
      kind: 'import',
      files: [
        [
          'tokens.resolver.json',
          {
            version: '2025.10',
            sets: { base: { sources: [{ $ref: 'colors.json' }] } },
            resolutionOrder: [{ $ref: '#/sets/base' }],
          },
        ],
      ],
    },
  },

  // --- style rules ------------------------------------------------------------------------------------
  T2101: {
    cause:
      'A color is written by hand (a hex value, `rgb()`, a named color) where the design system expects a token.',
    fix: 'Use the color token the hint names. `tessera check --fix` applies it when the match is exact.',
    example: tess(style('.root { color: #ff0000; }')),
    fixed: '.root {\n  color: $color.text.default;\n}',
  },
  T2102: {
    cause:
      'A governed property (spacing, radius, font size, opacity, motion, shadow) has a value that is not on the token scale.',
    fix: 'Use the nearest scale step the hint names, or `raw(value, "reason", "expiry")` for a one-off.',
    example: tess(style('.root { padding: 13px; }')),
    fixed: '.root {\n  padding: $space.3;\n}',
  },
  T2103: {
    cause:
      'A token of the wrong type or group is used for the property, such as a color token for `padding`.',
    fix: 'Use a token of the kind the property takes (a spacing token for padding, a color token for `color`).',
    example: tess(style('.root { padding: $color.text.default; }')),
  },
  T2104: {
    cause: 'The `$token` does not exist in the design tokens.',
    fix: 'Fix the name. The hint suggests the nearest token.',
    example: tess(style('.root { padding: $space.99; }')),
  },
  T2105: {
    cause:
      'A primitive token (a raw palette value) is used in a component. Components should use semantic tokens so themes can change meaning.',
    fix: 'Use a semantic token. Set `primitives` in `tessera.config.ts` to change this rule (`warn` by default).',
    example: tess(style('.root { color: $color.neutral.800; }')),
  },
  T2106: {
    cause: 'The `<style>` block is not valid CSS the compiler can read.',
    fix: 'Fix the syntax the message points at (an unclosed brace, a missing value).',
    example: tess(style('.root { padding: $space.2;')),
  },
  T2107: {
    cause:
      'Text and its background do not have enough contrast in some theme, state or variant, by the WCAG ratio set in `contrast` (4.5:1 by default).',
    fix: 'Pick tokens that are far enough apart in every theme. The message names the pair and the ratio in each theme.',
    example: tess(style('.root { color: $color.text.default; background: $color.text.default; }')),
  },
  T2108: {
    cause:
      'A `raw()` escape is malformed: it needs a value and a quoted reason, and an optional quoted `YYYY-MM-DD` expiry.',
    fix: 'Write `raw(13px, "why it is needed", "2027-03-01")`.',
    example: tess(style('.root { padding: raw(13px); }')),
    fixed: '.root {\n  padding: raw(13px, "legacy modal spacing", "2027-03-01");\n}',
  },
  T2109: {
    cause:
      'The contract pairs two parts for a contrast check, but the style does not set a color or background token on one of them, so the pairing cannot be checked.',
    fix: 'Set the missing token in `<style>`, or remove the pairing from the contract.',
    example: tess(
      `<contract>
{ "name": "Card", "role": "group", "parts": ["root", "label"], "contrast": [{ "foreground": "label", "background": "root" }] }
</contract>
<template><div class="root"><span class="label"></span></div></template>
<style>
.root { padding: $space.2; }
.label { padding: $space.1; }
</style>
`,
    ),
  },
  T2110: {
    cause:
      'A `raw()` escape had an expiry date and it has passed, so the exemption is now an error.',
    fix: 'Replace the value with a token, or extend the date with a new reason.',
    example: tess(style('.root { padding: raw(13px, "legacy modal spacing", "2020-01-01"); }'), {
      options: { today: '2026-10-22' },
    }),
  },
  T2111: {
    cause:
      'A `raw()` escape is in use. It is allowed, but it is a warning and is counted in `tessera report`.',
    fix: 'Replace it with a token when you can. Add an expiry date so it cannot last forever.',
    example: tess(style('.root { padding: raw(13px, "legacy modal spacing"); }')),
  },
  T2112: {
    cause:
      'A `severity` rule in `tessera.config.ts` is invalid: lowering a rule to `warn` or `off` needs a `reason`, and `expires` must be a date like `2027-03-01`.',
    fix: 'Add a reason saying why the path is exempt, and a valid expiry date.',
    example: {
      kind: 'config',
      config: { severity: [{ files: 'app/legacy/**', rules: '*', level: 'off' }] },
    },
    fixed:
      "severity: [{ files: 'app/legacy/**', rules: '*', level: 'warn', reason: 'old screens', expires: '2027-03-01' }]",
  },
  T2113: {
    cause:
      'A style uses a token that is marked deprecated (`$extensions.tessera.deprecated`). It still works; the warning says what to use instead, so it can be removed safely later.',
    fix: 'Use the token the message names. `tessera report` lists every remaining use.',
    example: tess(style('.root { color: $color.text.muted; }'), {
      deprecatedTokens: ['color.text.muted'],
    }),
  },
  T2114: {
    cause:
      'A `[data-variant="value"]` selector names a value the contract does not declare for that variant, so it could never match.',
    fix: 'Use one of the declared values (the hint suggests the nearest), or add the value to the contract.',
    example: tess(
      `<contract>
{ "name": "Card", "role": "group", "parts": ["root"], "variants": { "tone": ["neutral", "danger"] } }
</contract>
<template><div class="root"></div></template>
<style>
.root {
  &[data-tone='dnager'] {
    padding: $space.2;
  }
}
</style>
`,
    ),
  },

  // --- contracts --------------------------------------------------------------------------------------
  T3001: {
    cause:
      'The `<contract>` block is not valid JSON. Comments and trailing commas are allowed, but keys must be quoted.',
    fix: 'Fix the syntax the message points at.',
    example: tess(
      '<contract>\n{ name: "Card" }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3002: {
    cause: 'The contract has a field Tessera does not know, usually a typo.',
    fix: 'Use one of the known fields. The hint suggests the nearest.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"], "descripton": "A card" }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3003: {
    cause:
      'A contract field has the wrong shape or an invalid value (a string where an array is needed, a bad name).',
    fix: 'Fix the field the message names.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"], "variants": { "tone": "primary" } }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3004: {
    cause:
      'The contract `name` must equal the file name, so a component is found by one name everywhere.',
    fix: 'Rename the contract or the file.',
    example: tess(
      '<contract>\n{ "name": "Other", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3005: {
    cause: 'The `role` is not a valid ARIA or native element role.',
    fix: 'Use a real role. The hint suggests the nearest.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "buton", "parts": ["root"] }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3006: {
    cause: "The parts list must include `root`, the part the component's root element carries.",
    fix: 'Add `"root"` to `parts`.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["icon"] }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3007: {
    cause: 'A name or value is listed twice (a field, part, variant, state, or variant value).',
    fix: 'Remove the duplicate.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root", "root"] }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3008: {
    cause: 'The `behavior` is not one Tessera provides.',
    fix: 'Use a known behavior. The hint suggests the nearest.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "button", "parts": ["root"], "behavior": "prss" }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3009: {
    cause:
      'A behavior needs the contract to declare certain states or events (the press behavior needs a `press` event), and they are missing.',
    fix: 'Add what the message names to the contract.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "button", "parts": ["root"], "behavior": "press" }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3010: {
    cause: 'A contrast pairing names a part the contract does not declare.',
    fix: 'Use a declared part, or add the part to `parts`.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"], "contrast": [{ "foreground": "label", "background": "root" }] }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3011: {
    cause:
      'A part is declared in the contract, but no element in the template has that class, so the contract promises something the component does not do.',
    fix: 'Add an element with that class, or remove the part.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root", "icon"] }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3012: {
    cause:
      'A required contract field is missing (`name`, `role` and `parts` are required), or a pairing is missing its `foreground` or `background`.',
    fix: 'Add the field the message names.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group" }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3014: {
    cause:
      '"deprecatedValues" and "renamedValues" describe the life of a variant value. A deprecated value must still be in "variants" (it is allowed, with a warning); a renamed value must not be (it is gone), and its replacement must be.',
    fix: 'Keep a deprecated value in "variants". For a rename, remove the old value from "variants" and map it to the new one in "renamedValues".',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"], "variants": { "tone": ["info", "warn"] }, "renamedValues": { "tone": { "info": "warn" } } }\n</contract>\n<template><div class="root"></div></template>\n',
    ),
  },
  T3013: {
    cause:
      'The template\'s root element must carry `class="root"`, because the root part is how styles, tests and docs find the component.',
    fix: 'Add `class="root"` to the outermost element.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<template><div></div></template>\n',
    ),
  },

  // --- templates --------------------------------------------------------------------------------------
  T4001: {
    cause:
      'A `.tess` file contains only `<contract>`, `<script>`, `<template>`, `<style>` and `<page>` blocks, each at most once, and each closed.',
    fix: 'Move stray text into a block, close the block, or remove the duplicate.',
    example: tess('hello\n<template><div class="root"></div></template>\n', {
      options: { contract: 'optional' },
    }),
  },
  T4002: {
    cause: 'The file has no `<template>` block, so there is nothing to render.',
    fix: 'Add a `<template>` with one root element.',
    example: tess('<script>\nconst a = 1\n</script>\n', { options: { contract: 'optional' } }),
  },
  T4003: {
    cause:
      'The template markup is malformed: an unclosed or mismatched tag, an attribute without a closing quote, or an unclosed `{`.',
    fix: 'Fix the tag the message points at. Write a literal brace as `{"{"}`.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root"></template>\n',
    ),
  },
  T4004: {
    cause:
      'A template must have exactly one root element, and the root cannot use `if`, `each` or other directives.',
    fix: 'Wrap everything in one element such as `<div class="root">`.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root"></div><div></div></template>\n',
    ),
  },
  T4005: {
    cause:
      'An expression in `{ }` or a directive is not valid JavaScript, or has more than one expression.',
    fix: 'Write one valid expression, such as `{count + 1}`.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<script>\nconst count = state(0)\n</script>\n<template><div class="root">{count +}</div></template>\n',
    ),
  },
  T4006: {
    cause:
      'The template uses a name that is not declared in `<script>` and is not a loop variable.',
    fix: 'Declare it in `<script>`, or fix the typo (the hint suggests the nearest name).',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root">{nope}</div></template>\n',
    ),
  },
  T4007: {
    cause:
      'The tag is not a known component. Components are found by contract name across `system/components` and `app/components`.',
    fix: 'Fix the tag (the hint suggests the nearest component), or create the component.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root"><Buton>Go</Buton></div></template>\n',
      { uses: ['Button'] },
    ),
  },
  T4008: {
    cause: "A variant attribute has a value the component's contract does not declare.",
    fix: 'Use one of the declared values. The hint suggests the nearest.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root"><Button tone="dangr">Go</Button></div></template>\n',
      { uses: ['Button'] },
    ),
  },
  T4009: {
    cause:
      'Content goes to a slot the component does not declare, or the component has no default slot.',
    fix: "Use a declared slot, or add the slot to the component's contract.",
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<template><div class="root"><Button><span slot="nope">x</span></Button></div></template>\n',
      { uses: ['Button'] },
    ),
  },
  T4010: {
    cause:
      'The component does not declare the event you listen for, or your component emits an event its contract does not declare.',
    fix: 'Use a declared event (the hint suggests the nearest), or add it to the contract.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<script>\nfunction go() {}\n</script>\n<template><div class="root"><Button @click="go">Go</Button></div></template>\n',
      { uses: ['Button'] },
    ),
  },
  T4011: {
    cause:
      'A template directive (`if`, `else-if`, `else`, `each`, `key`, `bind:value`, `ref`, `@event`) is used wrongly: `each` needs a `key`, `else` needs a preceding `if`, `ref` names a `state()`, and so on.',
    fix: 'Follow the message. A list is `<li each="item in items" key="item.id">`.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<script>\nconst items = state([])\n</script>\n<template><div class="root"><li each="item in items">x</li></div></template>\n',
    ),
  },
  T4012: {
    cause:
      'A signal is nested inside an object, and templates only unwrap top-level signals. `{s.count}` would show the signal itself, not its value.',
    fix: 'Destructure it to a top-level binding, or read `.value` in the script.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<script>\nconst s = { count: state(0) }\n</script>\n<template><div class="root">{s.count}</div></template>\n',
    ),
  },
  T4013: {
    cause:
      'Components need a `<contract>`, while pages and layouts must not have one, and only pages may have a `<page>` block.',
    fix: 'Add a contract to the component, or remove the block that does not belong.',
    example: tess('<template><div class="root"></div></template>\n'),
  },
  T4015: {
    cause:
      "A behavior event such as `@press` is used, but this component's contract does not declare the behavior that provides it.",
    fix: 'Add `"behavior": "press"` (and its events) to the contract, or use a native event such as `@click`.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"], "events": { "press": "x" } }\n</contract>\n<script>\nfunction go() {}\n</script>\n<template><div class="root" @press="go"></div></template>\n',
    ),
  },

  // --- auto-imports -----------------------------------------------------------------------------------
  T5001: {
    cause:
      'Two components have the same name. Names are global across `system/components` and `app/components`, and there is no shadowing.',
    fix: 'Rename one, or wrap or eject the system component under a new name (`tessera eject`).',
    example: {
      kind: 'registry',
      files: [
        { file: 'system/components/Card.tess', source: component('Card', '["root"]') },
        { file: 'app/components/Card.tess', source: component('Card', '["root"]') },
      ],
    },
  },
  T5002: {
    cause:
      'A plain `.ts` file calls an auto-imported name such as `useRoute()` or `state()` without importing it. Auto-imports only exist inside `.tess` files.',
    fix: 'Import it where the message says.',
    example: {
      kind: 'ts',
      file: 'app/utils/nav.ts',
      source: 'export const here = () => useRoute().path\n',
    },
    fixed:
      "import { useRoute } from '@pixelscriptio/tessera/router'\n\nexport const here = () => useRoute().path",
  },
  T5003: {
    cause:
      'With `autoImports: false`, a script API such as `state` must be imported, and it is not.',
    fix: 'Add the import the hint gives, or turn auto-imports back on.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<script>\nconst n = state(0)\n</script>\n<template><div class="root">{n}</div></template>\n',
      { options: { autoImports: false } },
    ),
  },

  T5004: {
    cause:
      'A script calls `name.get(...)`, `name.post(...)` or another data call on a name that is not an api, and is close to the name of one. It is probably a typo, and would fail when the page runs, with a ReferenceError.',
    fix: 'Use the name the hint gives. An api is a file in `app/apis`, named after the file.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<script>\nconst user = gihub.get(\'/users/octocat\')\n</script>\n<template><div class="root">{user.data}</div></template>\n',
      { apis: ['github'] },
    ),
  },
  T5005: {
    cause:
      'A file in `app/apis` is an api, named after the file, so the file name has to be a name a script can use: letters, numbers and underscores, starting with a letter, and not a word JavaScript reserves or one Tessera already uses (`get`, `post`, `state`, ...).',
    fix: 'Rename the file, for example `my-api.ts` to `myApi.ts`.',
    example: { kind: 'apis', files: ['my-api.ts'] },
  },

  // --- pages, routing, layouts ------------------------------------------------------------------------
  T6001: {
    cause:
      'Two page files map to the same route (`blog.tess` and `blog/index.tess` are both `/blog`; `[id]` and `[slug]` in one folder are the same shape). It is unclear which should win, so neither is routed.',
    fix: 'Keep one of them.',
    example: { kind: 'routes', files: ['blog.tess', 'blog/index.tess'] },
  },
  T6002: {
    cause:
      'A page file name cannot be a route: a space or other character, a catch-all `[...rest]`, a repeated parameter, or a `404.tess` below the top of `app/pages`.',
    fix: 'Rename the file to letters, numbers, `-` and `_`, or `[name]` for a parameter. Put `404.tess` at the top.',
    example: { kind: 'routes', files: ['my page.tess'] },
  },
  T6003: {
    cause: "A page's `<page>` block names a layout that does not exist in `app/layouts/`.",
    fix: 'Use the name of a file in `app/layouts` (the hint suggests the nearest), `false` for none, or create the layout.',
    example: pageExample(page('<page>\n{ "layout": "defualt" }\n</page>\n'), {
      options: { layouts: ['default'] },
    }),
  },
  T6004: {
    cause:
      'A `<Link to="...">` with a literal path matches none of the app\'s routes. Dynamic `:to` values are not checked.',
    fix: 'Fix the path (the hint suggests the nearest route), or add the page.',
    example: pageExample(page('', '<Link to="/abuot">About</Link>'), {
      uses: ['Link'],
      options: { routes: ['/', '/about'] },
    }),
  },
  T6005: {
    cause:
      'The `<page>` block is not an object of known fields: `title` (a string) and `layout` (a name or `false`).',
    fix: 'Fix the field the message names.',
    example: pageExample(page('<page>\n{ "titel": "About" }\n</page>\n')),
  },
  T6006: {
    cause: 'A layout has no default `<slot />`, so pages would have nowhere to render.',
    fix: 'Add `<slot />` where the page should appear.',
    example: {
      kind: 'tess',
      file: 'app/layouts/default.tess',
      source: '<template><div class="root"></div></template>\n',
    },
    fixed: '<template>\n  <div class="root"><slot /></div>\n</template>',
  },

  // --- warnings ---------------------------------------------------------------------------------------
  W4101: {
    cause:
      '`derived()` should compute a value from other signals without side effects, and this one writes a signal or calls something impure.',
    fix: 'Move the side effect into `effect()`.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<script>\nconst a = state(0)\nconst b = state(0)\nconst d = derived(() => {\n  b.value = 1\n  return a.value\n})\n</script>\n<template><div class="root">{d}</div></template>\n',
    ),
  },
  W4102: {
    cause:
      'A `:class` binding builds class names at runtime, and the compiler cannot scope names it cannot see, so they will not match your `<style>`.',
    fix: 'Use `class` with static names and `data-` attributes for state, which are scoped and checked.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<script>\nconst c = state("a")\n</script>\n<template><div class="root" :class="c"></div></template>\n',
    ),
  },
  W4105: {
    cause:
      'A template shows the data of a read (`get`) but never shows `loading` or `error` (or one of them). A read is empty while the answer is on its way, and `error` is set when it fails, so a page that shows neither is blank while it waits and says nothing when the server does not answer.',
    fix: 'Show the state, usually before the data: `<p if="tasks.loading">Loading...</p>` and `<p else-if="tasks.error">Could not load.</p>`. If a path is not ready to handle it, a severity rule in `tessera.config.ts` can turn the warning off for it, with a reason and an expiry, or make it an error that a baseline can hold.',
    example: tess(
      '<contract>\n{ "name": "Card", "role": "group", "parts": ["root"] }\n</contract>\n<script>\nconst tasks = get(\'/tasks\')\n</script>\n<template><div class="root">{tasks.data}</div></template>\n',
    ),
    fixed:
      '<template>\n  <div class="root">\n    <p if="tasks.loading">Loading...</p>\n    <p else-if="tasks.error">Could not load.</p>\n    <p else>{tasks.data}</p>\n  </div>\n</template>',
  },
  W4103: {
    cause:
      'The template uses a component whose contract says `"deprecated"`. It still works; the warning carries the reason, usually what to use instead.',
    fix: 'Switch to the component the message names. `tessera report` lists every remaining use, so a maintainer can see who still depends on it.',
    example: pageExample('<template><main><Old /></main></template>\n', {
      components: [
        {
          name: 'Old',
          source:
            '<contract>\n{ "name": "Old", "role": "group", "parts": ["root"], "deprecated": "Use Card instead." }\n</contract>\n<template><div class="root"></div></template>\n',
        },
      ],
    }),
  },
  W4104: {
    cause:
      'The template sets a variant to a value the contract lists in "deprecatedValues". It still works; the warning carries the reason.',
    fix: 'Use the value the message names.',
    example: pageExample('<template><main><Tag tone="loud" /></main></template>\n', {
      components: [
        {
          name: 'Tag',
          source:
            '<contract>\n{ "name": "Tag", "role": "group", "parts": ["root"], "variants": { "tone": ["calm", "loud"] }, "deprecatedValues": { "tone": { "loud": "Use calm." } } }\n</contract>\n<template><div class="root"></div></template>\n',
        },
      ],
    }),
  },
}

/** Every code in every registry, with its short title. */
export const ALL_CODES: Record<string, string> = {
  ...TOKEN_CODES,
  ...COMPILER_CODES,
  ...CONTRACT_CODES,
}

/** The codes in registry order: tokens, style, contracts, templates, auto-imports, routing, warnings. */
export const CODE_ORDER: string[] = Object.keys(ALL_CODES).sort()

export const CODE_GROUPS: Array<{ title: string; test: (code: string) => boolean }> = [
  { title: 'Design tokens', test: (c) => c.startsWith('T1') },
  { title: 'Styles', test: (c) => c.startsWith('T21') },
  { title: 'Contracts', test: (c) => c.startsWith('T30') },
  { title: 'Templates and scripts', test: (c) => c.startsWith('T40') },
  { title: 'Components and auto-imports', test: (c) => c.startsWith('T50') },
  { title: 'Pages, routing and layouts', test: (c) => c.startsWith('T60') },
  { title: 'Warnings', test: (c) => c.startsWith('W') },
]

/** The text `tessera explain <code>` prints. */
export function explainText(code: string): string | undefined {
  const normalized = code.toUpperCase()
  const title = ALL_CODES[normalized]
  const e = EXPLANATIONS[normalized]
  if (!title || !e) return undefined
  const lines = [`${normalized}  ${title}`, '', 'Cause', `  ${e.cause}`, '', 'Fix', `  ${e.fix}`]
  const source = exampleSource(e.example)
  if (source) {
    lines.push(
      '',
      'Example',
      ...source
        .trimEnd()
        .split('\n')
        .map((l) => `  ${l}`),
    )
  }
  if (e.fixed) lines.push('', 'Fixed', ...e.fixed.split('\n').map((l) => `  ${l}`))
  return lines.join('\n') + '\n'
}

/** The example as the text a reader would write. */
export function exampleSource(example: Example): string {
  switch (example.kind) {
    case 'tess':
      return example.components?.length
        ? [
            ...example.components.map((c) => `// ${c.name}.tess\n${c.source}`),
            `// ${example.file}\n${example.source}`,
          ].join('\n')
        : example.source
    case 'ts':
      return example.source
    case 'tokens':
      return [...example.base, ...(example.themes ?? [])]
        .map(([file, content]) => `// ${file}\n${JSON.stringify(content, null, 2)}`)
        .join('\n\n')
    case 'import':
      return example.files
        .map(([file, content]) => `// ${file}\n${JSON.stringify(content, null, 2)}`)
        .join('\n\n')
    case 'routes':
      return example.files.map((f) => `app/pages/${f}`).join('\n')
    case 'apis':
      return example.files.map((f) => `app/apis/${f}`).join('\n')
    case 'config':
      return `export default ${JSON.stringify(example.config, null, 2)}`
    case 'registry':
      return example.files.map((f) => `// ${f.file}\n${f.source}`).join('\n')
  }
}
