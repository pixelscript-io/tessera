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
    ])
      expect(AGENT_GUIDE, heading).toContain(heading)
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
