import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { main } from '../src'
import { COMMANDS_DOC } from '../src/commands-doc'
import { renderCommandHelp, renderHelp } from '../src/help'
import { Cancelled, chooseByKeys, type Io, type KeyInput } from '../src/io'
import { createUi, detectUi, plainUi, stripAnsi, visibleLength } from '../src/ui'
import { VERSION } from '../src/version'
import { component, page, project } from './helpers'

const pretty = createUi({ color: true, unicode: true, width: 100, truecolor: true })
const calm = createUi({ color: false, unicode: true, width: 100 })

/** Run the CLI as it runs in a terminal: with a look. */
async function runPretty(cwd: string, ui = pretty, ...argv: string[]) {
  let out = ''
  let err = ''
  const io: Io = { cwd, ui, out: (t) => void (out += t + '\n'), err: (t) => void (err += t + '\n') }
  const code = await main(argv, io)
  return { code, out, err }
}

describe('the look', () => {
  it('paints with ANSI codes and nothing else when color is on, and not at all when it is off', () => {
    expect(pretty.red('x')).toBe('\u001b[31mx\u001b[39m')
    expect(pretty.accent('x')).toBe('\u001b[38;2;92;196;138mx\u001b[39m')
    const ansi256 = createUi({ color: true, unicode: true, width: 80 }).accent('x')
    expect(ansi256.startsWith('\u001b[38;5;')).toBe(true)
    expect(ansi256.endsWith('mx\u001b[39m')).toBe(true)
    expect(calm.red('x')).toBe('x')
    expect(plainUi.accent('x')).toBe('x')
  })

  it('has ASCII stand-ins for its symbols, for terminals that cannot draw them', () => {
    expect(plainUi.ok('done')).toBe('+ done')
    expect(plainUi.fail('no')).toBe('x no')
    expect(plainUi.sym.arrow).toBe('->')
    expect(calm.ok('done')).toBe('✓ done')
  })

  it('measures what is seen, so color does not break alignment', () => {
    expect(visibleLength(pretty.red('abc'))).toBe(3)
    expect(stripAnsi(pretty.bold(pretty.accent('abc')))).toBe('abc')
    const table = pretty.columns([
      [pretty.accent('a'), 'first'],
      [pretty.accent('long'), 'second'],
    ])
    expect(stripAnsi(table).split('\n')).toEqual(['  a     first', '  long  second'])
  })

  it('draws a bar in proportion, and clamps it', () => {
    expect(stripAnsi(calm.bar(0.5, 10))).toBe('█████░░░░░')
    expect(stripAnsi(calm.bar(2, 4))).toBe('████')
    expect(stripAnsi(calm.bar(-1, 4))).toBe('░░░░')
    expect(plainUi.bar(0.25, 4)).toBe('#...')
  })

  it('wraps text to the terminal and indents every line', () => {
    const wrapped = createUi({ color: false, unicode: false, width: 40 }).wrap(
      'one two three four five six seven eight nine ten eleven twelve',
      2,
    )
    for (const line of wrapped.split('\n')) {
      expect(line.startsWith('  ')).toBe(true)
      expect(line.length).toBeLessThanOrEqual(40)
    }
  })

  it('has a mark of four squares, one of them the accent', () => {
    const [top, bottom] = pretty.mark()
    expect(stripAnsi(top)).toBe('■ ■')
    expect(stripAnsi(bottom)).toBe('■ ■')
    expect(top).toContain('38;2;92;196;138')
  })
})

describe('when the look is used', () => {
  const tty = { isTTY: true, columns: 120 }

  it('is not used when the output is not a terminal, so pipes and CI get plain text', () => {
    expect(detectUi({}, { isTTY: false })).toBeUndefined()
    expect(detectUi({}, {})).toBeUndefined()
    expect(detectUi({ TERM: 'dumb' }, tty)).toBeUndefined()
  })

  it('is used in a terminal, at its width', () => {
    const ui = detectUi({}, tty, 'linux')!
    expect(ui.color).toBe(true)
    expect(ui.width).toBe(120)
    expect(ui.unicode).toBe(true)
  })

  it('keeps the layout and drops the color with NO_COLOR', () => {
    const ui = detectUi({ NO_COLOR: '1' }, tty, 'linux')!
    expect(ui.color).toBe(false)
    expect(ui.red('x')).toBe('x')
    expect(ui.sym.ok).toBe('✓')
  })

  it('can be forced on where there is no terminal', () => {
    expect(detectUi({ FORCE_COLOR: '1' }, { isTTY: false }, 'linux')?.color).toBe(true)
    expect(detectUi({ FORCE_COLOR: '0' }, { isTTY: false })).toBeUndefined()
  })

  it('uses ASCII on an old Windows console, and symbols in the new terminals', () => {
    expect(detectUi({}, tty, 'win32')!.unicode).toBe(false)
    expect(detectUi({ WT_SESSION: 'x' }, tty, 'win32')!.unicode).toBe(true)
    expect(detectUi({ TERM_PROGRAM: 'vscode' }, tty, 'win32')!.unicode).toBe(true)
  })

  it('uses 24-bit color only where the terminal says it has it', () => {
    expect(detectUi({ COLORTERM: 'truecolor' }, tty, 'linux')!.accent('x')).toContain('38;2;')
    expect(detectUi({}, tty, 'linux')!.accent('x')).toContain('38;5;')
  })
})

describe('help', () => {
  it('is the plain text it always was without a terminal', () => {
    expect(renderHelp(undefined)).toContain('Usage: tessera <command> [options]')
    expect(renderHelp(undefined)).not.toContain('\u001b')
  })

  it('is grouped, with a banner and the version, in a terminal, and names every command', () => {
    const text = stripAnsi(renderHelp(pretty))
    expect(text).toContain(`Tessera ${VERSION}`)
    for (const heading of [
      'USAGE',
      'START',
      'CHECK',
      'TOKENS AND COMPONENTS',
      'DOCS AND AI TOOLS',
      'OPTIONS',
    ])
      expect(text, heading).toContain(heading)
    for (const command of COMMANDS_DOC) expect(text, command.name).toContain(command.name)
    expect(text).toContain('--no-color')
  })

  it('says what one command does, with its options', () => {
    const text = stripAnsi(renderCommandHelp('init', pretty)!)
    expect(text).toContain('tessera init')
    expect(text).toContain('USAGE')
    expect(text).toContain('--preset <name>')
    expect(renderCommandHelp('init', undefined)).toContain('tessera init: Start a project')
    expect(renderCommandHelp('nope', pretty)).toBeUndefined()
  })

  it('is reached as help <command>, <command> --help and bare help', async () => {
    const dir = project({})
    for (const argv of [
      ['help', 'check'],
      ['check', '--help'],
      ['check', '-h'],
    ]) {
      const { code, out } = await runPretty(dir, pretty, ...argv)
      expect(code, argv.join(' ')).toBe(0)
      expect(stripAnsi(out)).toContain('tessera check')
    }
    expect((await runPretty(dir, pretty, 'help')).code).toBe(0)
    expect((await runPretty(dir, pretty)).code).toBe(1)
  })
})

describe('the top of the command line', () => {
  it('prints its version', async () => {
    const dir = project({})
    expect((await runPretty(dir, undefined, '--version')).out.trim()).toBe(VERSION)
    expect((await runPretty(dir, undefined, '-v')).out.trim()).toBe(VERSION)
  })

  it('says what it did not understand, and what was probably meant', async () => {
    const dir = project({})
    const plain = await (async () => {
      let err = ''
      const code = await main(['chek'], {
        cwd: dir,
        out: () => {},
        err: (t) => void (err += t + '\n'),
      })
      return { code, err }
    })()
    expect(plain.code).toBe(1)
    expect(plain.err).toContain('Unknown command "chek".\n  Did you mean "check"?')
    const styled = await runPretty(dir, pretty, 'chek')
    expect(styled.code).toBe(1)
    expect(stripAnsi(styled.err)).toContain('✗ Unknown command "chek".')
    expect(stripAnsi(styled.err)).toContain('Did you mean "check"?')
    expect(stripAnsi((await runPretty(dir, pretty, 'zzzzzz')).err)).not.toContain('Did you mean')
  })

  it('drops the color with --no-color and keeps the layout', async () => {
    const dir = project({ 'app/pages/index.tess': page() })
    const { out } = await runPretty(dir, pretty, 'check', '--no-color')
    expect(out).not.toContain('\u001b')
    expect(out).toContain('✓ No problems')
  })
})

describe('check in a terminal', () => {
  const bad = (extra = '') =>
    project({
      'app/components/Card.tess': component('Card', '.root {\n  padding: 13px;\n}\n' + extra),
      'app/pages/index.tess': page(),
    })

  it('shows each problem with its place, the line it is on and a caret, and what to do', async () => {
    const { code, out } = await runPretty(bad(), pretty, 'check')
    expect(code).toBe(1)
    const text = stripAnsi(out)
    expect(text).toContain('app/components/Card.tess (1)')
    expect(text).toMatch(/✗ T2102 {2}\d+:\d+ {2}Raw length "13px" in "padding" is off the scale\./)
    expect(text).toMatch(/\d+ │ {3}padding: 13px;/)
    expect(text).toMatch(/│ +\^/)
    expect(text).toContain('→ Did you mean')
    expect(text).toMatch(/✗ 1 error, 0 warnings in \d+ files? \(\d+\.\d+s\)/)
    expect(text).toContain('Learn more about a code: tessera explain T2102')
    // The color is there for a terminal that has it.
    expect(out).toContain('\u001b[31m')
  })

  it('says it is clean, in one line, when it is', async () => {
    const { code, out } = await runPretty(
      project({ 'app/pages/index.tess': page() }),
      pretty,
      'check',
    )
    expect(code).toBe(0)
    expect(stripAnsi(out)).toMatch(/^✓ No problems in 1 file \(\d+\.\d+s\)\n$/)
  })

  it('has the same exit code and the same count as the plain form', async () => {
    const dir = bad()
    const styled = await runPretty(dir, pretty, 'check')
    let plain = ''
    const code = await main(['check'], {
      cwd: dir,
      out: (t) => void (plain += t + '\n'),
      err: () => {},
    })
    expect(code).toBe(styled.code)
    expect(plain).toContain('1 error, 0 warnings')
    expect(stripAnsi(styled.out)).toContain('1 error, 0 warnings')
  })

  it('shows token problems without a file', async () => {
    const dir = project(
      { 'app/pages/index.tess': page(), 'system/tokens/base.tokens.json': '{ nope' },
      'tokens: "system/tokens"',
    )
    const { code, out } = await runPretty(dir, pretty, 'check')
    expect(code).toBe(1)
    expect(stripAnsi(out)).toMatch(/^✗ ERROR/m)
  })
})

describe('other commands in a terminal', () => {
  it('explains a code under headings, with the example dimmed and the fix green', async () => {
    const dir = project({})
    const { out } = await runPretty(dir, pretty, 'explain', 'T2102')
    const text = stripAnsi(out)
    expect(text).toContain('T2102  Raw value off the token scale')
    expect(text).toContain('CAUSE')
    expect(text).toContain('EXAMPLE')
    expect(out).toContain('\u001b[2m') // dim
    expect(out).toContain('\u001b[32m') // green
    // Plain stays plain.
    let plain = ''
    await main(['explain', 'T2102'], { cwd: dir, out: (t) => void (plain += t), err: () => {} })
    expect(plain).toContain('Cause\n')
  })

  it('reports with a bar for the share of declarations that use a token', async () => {
    const dir = project({
      'app/components/Card.tess': component('Card', '.root {\n  padding: $space.4;\n}\n'),
      'app/pages/index.tess': page(),
    })
    const { out } = await runPretty(dir, pretty, 'report')
    const text = stripAnsi(out)
    expect(text).toContain('Tessera report')
    expect(text).toMatch(/█{10,}/)
    expect(text).toMatch(/✓ raw\(\) escapes: 0/)
  })

  it('says it made a component with a mark', async () => {
    const dir = project({ 'app/pages/index.tess': page() })
    const { out } = await runPretty(dir, pretty, 'new', 'component', 'Note')
    expect(stripAnsi(out)).toMatch(/^✓ Created app\/components\/Note\.tess/)
  })

  it('shows init as a banner, the folders it filled, and numbered next steps', async () => {
    const dir = project({})
    const { out } = await runPretty(dir, pretty, 'init', 'my-app', '--preset', 'none')
    const text = stripAnsi(out)
    expect(text).toContain(`Tessera ${VERSION}`)
    expect(text).toContain('✓ Started a Tessera project in my-app (none preset)')
    expect(text).toMatch(/app\/ +\d+ files/)
    expect(text).toContain('1  cd my-app')
    expect(text).toContain('2  npm install')
    expect(text).toContain('3  npm run dev')
  })
})

/** A terminal's input: keys are pushed in by the test. */
function keys(): KeyInput & PassThrough {
  const stream = new PassThrough() as KeyInput & PassThrough
  stream.isTTY = true
  stream.setRawMode = () => stream
  return stream
}

describe('choosing with the keys', () => {
  const choices = [
    { value: 'tessera', label: 'tessera: our own small system' },
    { value: 'tailwind', label: 'tailwind: from the Tailwind theme' },
    { value: 'none', label: 'none: nothing yet' },
  ]
  const choose = (send: (stdin: PassThrough) => void) => {
    const stdin = keys()
    const stdout = new PassThrough()
    let shown = ''
    stdout.on('data', (d) => (shown += String(d)))
    const answer = chooseByKeys('Which starting point?', choices, pretty, stdin, stdout)
    setTimeout(() => send(stdin), 5)
    return { answer, shown: () => stripAnsi(shown) }
  }

  it('takes the first with Enter', async () => {
    const { answer } = choose((s) => s.write('\r'))
    expect(await answer).toBe('tessera')
  })

  it('moves with the arrow keys, and wraps', async () => {
    expect(await choose((s) => s.write('\u001b[B\r')).answer).toBe('tailwind')
    expect(await choose((s) => s.write('\u001b[A\r')).answer).toBe('none')
    expect(await choose((s) => s.write('\u001b[B\u001b[B\u001b[B\r')).answer).toBe('tessera')
  })

  it('moves with j and k, and jumps with a number', async () => {
    expect(await choose((s) => s.write('j\r')).answer).toBe('tailwind')
    expect(await choose((s) => s.write('jjk\r')).answer).toBe('tailwind')
    expect(await choose((s) => s.write('3\r')).answer).toBe('none')
  })

  it('shows the list with a pointer, then collapses it to the answer', async () => {
    const { answer, shown } = choose((s) => s.write('\u001b[B\r'))
    await answer
    expect(shown()).toContain('? Which starting point?')
    expect(shown()).toContain('❯ tailwind')
    expect(shown()).toMatch(/✓ Which starting point\? tailwind\n$/)
  })

  it('is cancelled with Ctrl+C', async () => {
    const { answer } = choose((s) => s.write('\u0003'))
    await expect(answer).rejects.toBeInstanceOf(Cancelled)
  })

  it('ends a command with exit code 130 when it is cancelled', async () => {
    let err = ''
    const io: Io = {
      cwd: project({}),
      ui: pretty,
      out: () => {},
      err: (t) => void (err += t),
      choose: () => Promise.reject(new Cancelled('Cancelled.')),
    }
    expect(await main(['init'], io)).toBe(130)
    expect(stripAnsi(err)).toContain('Cancelled.')
  })
})

describe('help for commands with subcommands', () => {
  it('finds tokens import by its two words, in either form', async () => {
    const dir = project({})
    for (const argv of [
      ['help', 'tokens', 'import'],
      ['tokens', 'import', '--help'],
    ]) {
      const { code, out } = await runPretty(dir, pretty, ...argv)
      expect(code, argv.join(' ')).toBe(0)
      expect(stripAnsi(out)).toContain('tessera tokens import')
    }
  })

  it('lists them one to a line, with only short arguments', () => {
    const text = stripAnsi(renderHelp(pretty))
    expect(text).toMatch(/tokens import +Bring in tokens/)
    expect(text).toMatch(/new component <Name> +Scaffold/)
    // The long options belong to the command's own help.
    expect(text).not.toContain('--stdin-filepath')
  })
})
