import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { AGENT_GUIDE } from '../src/agent-guide'

const KITCHEN_SINK = fileURLToPath(new URL('../../../examples/kitchen-sink', import.meta.url))

/** The ```xml tess samples of the guide: what a model will copy. */
function samples(markdown: string): Array<{ code: string; line: number; kind: string }> {
  const found: Array<{ code: string; line: number; kind: string }> = []
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = /^```xml tess(?: kind=(\w+))?\s*$/.exec(lines[i]!)
    if (!open) continue
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && !lines[j]!.startsWith('```')) body.push(lines[j++]!)
    found.push({ code: body.join('\n') + '\n', line: i + 1, kind: open[1] ?? 'component' })
    i = j
  }
  return found
}

describe('the language guide in AGENTS.md', () => {
  it('has the samples a model copies, and every one compiles in a real project', () => {
    const project = new Project(KITCHEN_SINK)
    const all = samples(AGENT_GUIDE)
    expect(all.length).toBeGreaterThanOrEqual(3)
    for (const sample of all) {
      const name = /"name":\s*"(\w+)"/.exec(sample.code)?.[1]
      const path =
        sample.kind === 'page' || !name
          ? join(KITCHEN_SINK, 'app', 'pages', 'GuideSample.tess')
          : join(KITCHEN_SINK, 'app', 'components', `${name}.tess`)
      const checked = project.compileFile(path, sample.code, { baseline: null })
      expect(
        checked.diagnostics.map((d) => `${d.code} ${d.message}`),
        `the sample at line ${sample.line}`,
      ).toEqual([])
    }
  })

  it('covers each thing a model needs to build an app', () => {
    for (const heading of [
      '### A component',
      '### The template',
      '### Styles',
      '### A page and routing',
      '### Data from a server',
      '### State that components share',
      '### The loop',
      '### Keeping data after a reload',
      '### Forms',
      '### Changing the tokens',
    ])
      expect(AGENT_GUIDE, heading).toContain(heading)
  })

  it('says what a template expression may be, and what it may not, from what the compiler accepts', () => {
    expect(AGENT_GUIDE).toContain('Any JavaScript expression works')
    expect(AGENT_GUIDE).toContain('{title.slice(0, 80)}')
    expect(AGENT_GUIDE).toContain('Browser globals')
    expect(AGENT_GUIDE).toContain('T4006')
    // What a handler receives.
    expect(AGENT_GUIDE).toContain('$event')
    expect(AGENT_GUIDE).toContain('@input="setName($event)"')
  })

  it('says how to keep data after a reload, since there is no persist yet', () => {
    expect(AGENT_GUIDE).toContain("typeof localStorage !== 'undefined'")
    expect(AGENT_GUIDE).toMatch(/no built-in `persist`/i)
  })

  it('says how to clear a field, which only works when the state follows what is typed', () => {
    expect(AGENT_GUIDE).toContain('`:value="draft"`')
    expect(AGENT_GUIDE).toContain('@input="draft = $event"')
    expect(AGENT_GUIDE).toMatch(/already has does nothing/i)
    expect(AGENT_GUIDE).toContain('trim()')
  })

  it('says how to run and stop the dev server, take its address from the output, and refresh AGENTS.md after an API', () => {
    expect(AGENT_GUIDE).toContain('the "App" line')
    expect(AGENT_GUIDE).toContain('Ctrl+C')
    expect(AGENT_GUIDE).toContain('agent-files')
    expect(AGENT_GUIDE).toMatch(/without one the calls work and are not checked/i)
  })

  it('says how a form is put together: a key links a field to its rule, a field keeps its own text, no success tone', () => {
    expect(AGENT_GUIDE).toMatch(/fields have no `name`/i)
    expect(AGENT_GUIDE).toContain('keeps what is typed')
    expect(AGENT_GUIDE).toMatch(/no success tone/i)
    expect(AGENT_GUIDE).toContain('Enter')
  })

  it('says where a token is changed or added, that a theme keeps its own value, and the contrast it must keep', () => {
    expect(AGENT_GUIDE).toContain('themes/dark.tokens.json')
    expect(AGENT_GUIDE).toContain('"$value": { "value": 4.5, "unit": "rem" }')
    expect(AGENT_GUIDE).toMatch(/does not change it in dark/i)
    expect(AGENT_GUIDE).toContain('T2107')
    expect(AGENT_GUIDE).toContain('setTheme')
  })

  it('says that passing check is not the feature working, and what to do about it', () => {
    expect(AGENT_GUIDE).toMatch(/does not show that the feature works/i)
    expect(AGENT_GUIDE).toContain('npm run dev')
  })

  it('says what is a layout’s and what is a page’s, and how to space a component’s children', () => {
    expect(AGENT_GUIDE).toMatch(/layout[^.]*every page/i)
    expect(AGENT_GUIDE).toMatch(/wrap them in an element of your own/i)
  })

  it('says to give a second server a file of its own, and to write a description only from its real answers', () => {
    expect(AGENT_GUIDE).toMatch(/leave `default.ts` alone/i)
    expect(AGENT_GUIDE).toMatch(/real answers/i)
  })

  it('is the same file that ships, with no placeholder left in it', () => {
    const source = readFileSync(
      join(fileURLToPath(new URL('../src', import.meta.url)), 'agent-guide.md'),
      'utf8',
    )
    expect(AGENT_GUIDE).toBe(source)
    expect(AGENT_GUIDE).not.toMatch(/TODO|FIXME|XXX/)
  })
})
