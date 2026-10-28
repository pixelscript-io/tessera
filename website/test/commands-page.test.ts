import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMMANDS_DOC } from '../../packages/cli/src/commands-doc'

// The "Every command" page is written by hand, so a test keeps it whole: every command the CLI has is on it, with a
// section of its own, and nothing on it names a flag the CLI does not have.
const page = readFileSync(
  fileURLToPath(new URL('../content/guide/commands.md', import.meta.url)),
  'utf8',
)
const config = readFileSync(
  fileURLToPath(new URL('../content/.vitepress/config.ts', import.meta.url)),
  'utf8',
)

const GLOBAL_FLAGS = ['--root', '--no-color', '--help', '--version']

describe('the Every command page', () => {
  it('is in the guide sidebar, next to the command line guide', () => {
    expect(config).toContain("{ text: 'Every command', link: '/guide/commands' }")
  })

  it('has a section for each command, named as the command is written', () => {
    for (const command of COMMANDS_DOC)
      expect(page, command.name).toContain(`### \`tessera ${command.name}\``)
  })

  it('lists each command once in the table at the top, linking to its section', () => {
    for (const command of COMMANDS_DOC) {
      const anchor = `tessera-${command.name.replaceAll(' ', '-')}`
      expect(page, command.name).toContain(`[\`tessera ${command.name}\`](#${anchor})`)
    }
  })

  it('says what each command is for in the words of the help text, so the two cannot disagree', () => {
    const table = page.slice(page.indexOf('## At a glance'), page.indexOf('## Start and run'))
    for (const command of COMMANDS_DOC) {
      const row = table.split('\n').find((l) => l.includes(`[\`tessera ${command.name}\`]`))!
      expect(row, command.name).toBeTruthy()
    }
  })

  it('does not have a command the CLI does not', () => {
    const named = [...page.matchAll(/^### `tessera ([a-z0-9 -]+)`$/gm)].map((m) => m[1]!)
    expect(named.sort()).toEqual(COMMANDS_DOC.map((c) => c.name).sort())
  })

  it('names only flags the CLI has', () => {
    const known = new Set(GLOBAL_FLAGS)
    for (const command of COMMANDS_DOC) {
      for (const option of command.options ?? [])
        for (const flag of option.flag.matchAll(/--[a-z][a-z-]*/g)) known.add(flag[0])
      for (const flag of command.usage.matchAll(/--[a-z][a-z-]*/g)) known.add(flag[0])
    }
    const used = new Set([...page.matchAll(/(?<![\w(-])--(?!t-)[a-z][a-z-]*/g)].map((m) => m[0]))
    for (const flag of used) expect(known.has(flag), flag).toBe(true)
  })

  it('has a bash example for each command, which runs a command the CLI has', () => {
    const names = COMMANDS_DOC.map((c) => c.name)
    for (const command of COMMANDS_DOC) {
      const section = page.slice(page.indexOf(`### \`tessera ${command.name}\``))
      const end = section.indexOf('\n### ', 5)
      const body = end < 0 ? section : section.slice(0, end)
      expect(body, command.name).toMatch(/```bash\n[\s\S]*?```/)
      const commands = [...body.matchAll(/(?:npx tessera|npm run) ([a-z0-9:-]+(?: [a-z]+)?)/g)].map(
        (m) => m[1]!,
      )
      for (const used of commands)
        expect(
          names.some((n) => used === n || used.startsWith(`${n} `)) ||
            ['dev', 'build', 'preview', 'check', 'test:a11y'].includes(used),
          `${command.name}: ${used}`,
        ).toBe(true)
    }
  })
})
