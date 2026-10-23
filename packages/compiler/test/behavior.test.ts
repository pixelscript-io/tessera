import { describe, expect, it } from 'vitest'
import { compile } from '../src'

const component = (
  template: string,
  contract = '"behavior": "press", "events": { "press": "p" }',
) =>
  `<contract>
{ "name": "Card", "role": "button", "parts": ["root"], ${contract} }
</contract>
<script>
const { disabled } = props({ disabled: false })
</script>
<template>${template}</template>`

const issues = (source: string) =>
  compile(source, { file: 'Card.tess' }).diagnostics.map(
    (d) => `${d.code} ${d.line}:${d.column} ${d.message}${d.hint ? ` | ${d.hint}` : ''}`,
  )

describe('wiring a behavior event in a template', () => {
  it('attaches press to a native button, and imports the behavior', () => {
    const { code, diagnostics } = compile(
      component('<button class="root" :disabled="disabled" @press="emit(\'press\')"></button>'),
      { file: 'Card.tess' },
    )
    expect(diagnostics).toEqual([])
    expect(code.split('\n')[1]).toBe(
      'import { attachPress as $attachPress } from "@pixelscriptio/tessera/behavior"',
    )
    expect(code).toContain(
      'use: [($el: any) => $attachPress($r.adapter, $el, { onPress: ($event: any) => { emit(\'press\') }, native: true, role: "button" })]',
    )
    // The press event is the behavior's, so it is not also a DOM listener.
    expect(code).not.toContain('on: {')
  })

  it('tells the behavior when the element is not natively pressable', () => {
    const div = compile(component('<div class="root" @press="emit(\'press\')"></div>'), {
      file: 'Card.tess',
    }).code
    expect(div).toContain('native: false')
    const anchor = compile(component('<a class="root" href="/x" @press="emit(\'press\')"></a>'), {
      file: 'Card.tess',
    }).code
    expect(anchor).toContain('native: true')
    const bareAnchor = compile(component('<a class="root" @press="emit(\'press\')"></a>'), {
      file: 'Card.tess',
    }).code
    expect(bareAnchor).toContain('native: false')
    const input = compile(
      component('<input class="root" type="submit" @press="emit(\'press\')" />'),
      { file: 'Card.tess' },
    ).code
    expect(input).toContain('native: true')
  })

  it('keeps ordinary DOM events as DOM listeners, next to a behavior', () => {
    const { code } = compile(
      component('<button class="root" @press="emit(\'press\')" @focus="disabled"></button>'),
      {
        file: 'Card.tess',
      },
    )
    expect(code).toContain('on: { "focus":')
    expect(code).toContain('use: [')
  })

  it('merges several handlers for one behavior event', () => {
    const { code } = compile(
      component('<button class="root" @press="emit(\'press\')" @press="disabled"></button>'),
      {
        file: 'Card.tess',
      },
    )
    expect(code).toContain('onPress: ($e: any) => {')
  })

  it('does not import the behavior when no element uses it', () => {
    const { code } = compile(component('<div class="root"></div>'), { file: 'Card.tess' })
    expect(code).not.toContain('@tessera/behavior')
  })

  it('errors when the contract does not declare the behavior, with the fix', () => {
    const source = component(
      '<button class="root" @press="emit(\'press\')"></button>',
      '"events": { "press": "p" }',
    )
    expect(issues(source)).toEqual([
      expect.stringMatching(
        /^T4015 \d+:\d+ @press is an event of the "press" behavior, but this component's contract does not declare it\. \| Add "behavior": "press" to <contract>\.$/,
      ),
    ])
  })

  it('errors for a page, which has no contract', () => {
    const result = compile('<template><button @press="1"></button></template>', {
      file: 'Index.tess',
      kind: 'page',
    })
    expect(result.diagnostics.map((d) => [d.code, d.hint])).toEqual([
      ['T4015', 'Behaviors belong to components with a contract.'],
    ])
  })

  it('errors for a behavior that exists only as a name', () => {
    const source = component(
      '<button class="root" @toggle="emit(\'toggle\')"></button>',
      '"behavior": "toggle", "events": { "toggle": "t" }',
    )
    expect(issues(source)).toEqual([
      expect.stringMatching(/^T4015 \d+:\d+ The "toggle" behavior is not built yet\.$/),
    ])
  })

  it('validates the contract against the behavior requirements', () => {
    const source = `<contract>
{ "name": "Card", "role": "button", "parts": ["root"], "behavior": "press" }
</contract>
<template><button class="root"></button></template>`
    expect(issues(source)).toEqual([
      expect.stringContaining(
        'Behavior "press" requires the event "press", which is not in events.',
      ),
    ])
  })

  it("leaves @press on a component tag as that component's event", () => {
    const button = {
      contract: {
        name: 'Button',
        role: 'button',
        parts: ['root'],
        variants: {},
        states: [],
        slots: {},
        events: { press: 'p' },
        contrast: [],
      },
      importPath: './Button.tess',
    }
    const { code, diagnostics } = compile(
      `<contract>
{ "name": "Card", "role": "group", "parts": ["root"], "events": { "change": "c" } }
</contract>
<script>
import Button from './Button.tess'
</script>
<template><div class="root"><Button @press="emit('change')"></Button></div></template>`,
      {
        file: 'Card.tess',
        components: {
          resolve: (t) => (t === 'Button' ? button : undefined),
          names: () => ['Button'],
        },
      },
    )
    expect(diagnostics).toEqual([])
    expect(code).toContain('events: { "press": ($event: any) => { emit(\'change\') } }')
    expect(code).not.toContain('attachPress')
  })
})
