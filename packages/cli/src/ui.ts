/**
 * How the command line looks when a person is watching: a little color, a few symbols, aligned columns, and a mark.
 * There is no dependency: this is a handful of ANSI escape codes and some string padding.
 *
 * It is on only when the output is a terminal (or `FORCE_COLOR` is set), so a pipe, a log file and CI get the plain
 * text they always got. `NO_COLOR` keeps the layout and drops the color. Commands ask `io.ui`; when it is missing
 * they print the plain form.
 */

export interface UiOptions {
  /** Paint with ANSI colors. */
  color: boolean
  /** Use symbols such as ✓ and │; otherwise ASCII stand-ins. */
  unicode: boolean
  /** Columns of the terminal. */
  width: number
  /** 24-bit color is available; otherwise the nearest of 256. */
  truecolor?: boolean
}

type Paint = (text: string) => string

export interface Ui {
  readonly color: boolean
  readonly unicode: boolean
  readonly width: number
  readonly bold: Paint
  readonly dim: Paint
  readonly underline: Paint
  readonly red: Paint
  readonly yellow: Paint
  readonly green: Paint
  readonly cyan: Paint
  readonly gray: Paint
  /** The brand green. */
  readonly accent: Paint
  readonly sym: {
    ok: string
    fail: string
    warn: string
    info: string
    arrow: string
    bullet: string
    bar: string
    filled: string
    empty: string
  }
  /** `✓ text` in green. */
  ok(text: string): string
  /** `✗ text` in red. */
  fail(text: string): string
  /** `! text` in yellow. */
  warn(text: string): string
  /** The four-square mark, as two lines (the second square is the accent). */
  mark(): [string, string]
  /** The mark beside a title and a subtitle. */
  banner(title: string, subtitle?: string): string
  /** A heading in a list of sections: small, bold capitals. */
  heading(text: string): string
  /** Columns aligned to the widest cell of each column but the last. Cells may carry color. */
  columns(rows: string[][], options?: { indent?: number; gap?: number }): string
  /** A bar of `width` cells, filled in proportion to `fraction` (0 to 1). */
  bar(fraction: number, width?: number): string
  /** Text wrapped to the terminal, with every line indented. */
  wrap(text: string, indent?: number): string
}

const ESC = '\u001b['

/** The brand green (oklch 0.78 0.13 155), which reads on dark and on light terminals. */
const ACCENT = [92, 196, 138] as const

/** The length of text with its color codes taken out. */
export const visibleLength = (text: string): number =>
  // eslint-disable-next-line no-control-regex
  [...text.replace(/\u001b\[[0-9;]*m/g, '')].length

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

function nearest256([r, g, b]: readonly [number, number, number]): number {
  const level = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)))
  return 16 + 36 * level(r) + 6 * level(g) + level(b)
}

export function createUi(options: UiOptions): Ui {
  const wrapCode = (open: string, close: string): Paint =>
    options.color ? (text) => `${ESC}${open}m${text}${ESC}${close}m` : (text) => text
  const bold = wrapCode('1', '22')
  const dim = wrapCode('2', '22')
  const underline = wrapCode('4', '24')
  const red = wrapCode('31', '39')
  const yellow = wrapCode('33', '39')
  const green = wrapCode('32', '39')
  const cyan = wrapCode('36', '39')
  const gray = wrapCode('90', '39')
  const accent: Paint = options.color
    ? options.truecolor
      ? (text) => `${ESC}38;2;${ACCENT.join(';')}m${text}${ESC}39m`
      : (text) => `${ESC}38;5;${nearest256(ACCENT)}m${text}${ESC}39m`
    : (text) => text

  const sym = options.unicode
    ? {
        ok: '✓',
        fail: '✗',
        warn: '!',
        info: 'i',
        arrow: '→',
        bullet: '•',
        bar: '│',
        filled: '█',
        empty: '░',
      }
    : {
        ok: '+',
        fail: 'x',
        warn: '!',
        info: 'i',
        arrow: '->',
        bullet: '-',
        bar: '|',
        filled: '#',
        empty: '.',
      }

  const square = options.unicode ? '■' : '#'
  const mark = (): [string, string] => [
    `${bold(square)} ${accent(square)}`,
    `${bold(square)} ${bold(square)}`,
  ]

  const wrap = (text: string, indent = 0): string => {
    const room = Math.max(30, Math.min(options.width, 100) - indent)
    const pad = ' '.repeat(indent)
    const lines: string[] = []
    for (const paragraph of text.split('\n')) {
      let line = ''
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && visibleLength(line) + 1 + visibleLength(word) > room) {
          lines.push(pad + line)
          line = word
        } else line = line ? `${line} ${word}` : word
      }
      lines.push(pad + line)
    }
    return lines.join('\n')
  }

  return {
    color: options.color,
    unicode: options.unicode,
    width: options.width,
    bold,
    dim,
    underline,
    red,
    yellow,
    green,
    cyan,
    gray,
    accent,
    sym,
    ok: (text) => `${green(sym.ok)} ${text}`,
    fail: (text) => `${red(sym.fail)} ${text}`,
    warn: (text) => `${yellow(sym.warn)} ${text}`,
    mark,
    banner(title, subtitle) {
      const [top, bottom] = mark()
      return [
        `${top}  ${bold(title)}`,
        `${bottom}  ${subtitle ? dim(subtitle) : ''}`.trimEnd(),
      ].join('\n')
    },
    heading: (text) => bold(dim(text.toUpperCase())),
    columns(rows, { indent = 2, gap = 2 } = {}) {
      const widths: number[] = []
      for (const row of rows)
        row.slice(0, -1).forEach((cell, i) => {
          widths[i] = Math.max(widths[i] ?? 0, visibleLength(cell))
        })
      return rows
        .map(
          (row) =>
            ' '.repeat(indent) +
            row
              .map((cell, i) =>
                i === row.length - 1
                  ? cell
                  : cell + ' '.repeat((widths[i] ?? 0) - visibleLength(cell) + gap),
              )
              .join('')
              .trimEnd(),
        )
        .join('\n')
    },
    bar(fraction, width = 20) {
      const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
      return accent(sym.filled.repeat(filled)) + gray(sym.empty.repeat(width - filled))
    },
    wrap,
  }
}

/** What the output looks like when nobody is watching: no color, ASCII, the text it always was. */
export const plainUi: Ui = createUi({ color: false, unicode: false, width: 80 })

/**
 * The look for this terminal, or undefined when the output is not one (a pipe, a file, CI), which is the signal
 * to print plain text. `NO_COLOR` keeps the layout and drops the color; `FORCE_COLOR` turns it on anywhere.
 */
export function detectUi(
  env: Record<string, string | undefined>,
  stream: { isTTY?: boolean; columns?: number },
  platform: string = process.platform,
): Ui | undefined {
  const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== ''
  if (!stream.isTTY && !forced) return undefined
  if (env.TERM === 'dumb') return undefined
  const color = env.NO_COLOR === undefined || env.NO_COLOR === '' ? true : false
  // Old Windows consoles draw the checkmarks and boxes as question marks; the newer terminals do not.
  const unicode =
    platform !== 'win32' ||
    !!env.WT_SESSION ||
    env.TERM_PROGRAM === 'vscode' ||
    env.ConEmuANSI === 'ON' ||
    env.TERM_PROGRAM === 'Hyper'
  const truecolor = env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' || !!env.WT_SESSION
  return createUi({ color, unicode, width: stream.columns ?? 80, truecolor })
}
