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

  it('attaches toggle the same way, with its own event and import', () => {
    const { code, diagnostics } = compile(
      component(
        `<button class="root" role="checkbox" @toggle="emit('toggle', $event.checked)"></button>`,
        '"behavior": "toggle", "events": { "toggle": "t" }',
      ),
      { file: 'Card.tess' },
    )
    expect(diagnostics).toEqual([])
    expect(code).toContain(
      'import { attachToggle as $attachToggle } from "@pixelscriptio/tessera/behavior"',
    )
    expect(code).toContain('$attachToggle($r.adapter, $el, { onToggle: ')
  })

  it('attaches disclosure to its trigger through the expand event', () => {
    const { code, diagnostics } = compile(
      `<contract>
{ "name": "Card", "role": "generic", "parts": ["root", "trigger", "content"], "behavior": "disclosure", "events": { "expand": "e" } }
</contract>
<template><div class="root"><button class="trigger" @expand="emit('expand', $event)"></button><div class="content"></div></div></template>`,
      { file: 'Card.tess' },
    )
    expect(diagnostics).toEqual([])
    expect(code).toContain('$attachDisclosure($r.adapter, $el, { onExpand: ')
  })

  it('errors when the event belongs to a behavior the contract does not declare', () => {
    const source = component(
      `<button class="root" @toggle="emit('toggle')"></button>`,
      '"behavior": "press", "events": { "press": "p", "toggle": "t" }',
    )
    expect(issues(source)).toEqual([
      expect.stringContaining(
        '@toggle is an event of the "toggle" behavior, but this component\'s contract does not declare it.',
      ),
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
