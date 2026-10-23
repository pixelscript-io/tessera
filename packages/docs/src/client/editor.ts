import type { Plan, PlanFile } from '../edit/plan'

/**
 * The token exchange of the docs app. Export needs no server: it offers files the docs data already holds. Import
 * (system manager, write mode) asks the server to prepare a change, shows what it would do (the files as a diff, the
 * compiler's verdict, what it means for the people using the system), and has the buttons that save, discard and
 * undo. The server decides everything; this only asks and shows.
 */

type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | number | boolean | undefined | ((e: any) => void)>

function h(tag: string, attrs: Attrs | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value)
    } else if (key === 'class') el.className = String(value)
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(child)
  }
  return el
}

// --- talking to the server --------------------------------------------------------------------------------

const KEY = 'tessera-editor-key'

/** The key from the address the command printed. It is kept for the tab and taken out of the address bar. */
export function readKey(): string | null {
  try {
    const url = new URL(location.href)
    const given = url.searchParams.get('key')
    if (given) {
      sessionStorage.setItem(KEY, given)
      url.searchParams.delete('key')
      history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/__tessera/${path}`, {
    method,
    headers: {
      'x-tessera-key': readKey() ?? '',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok)
    throw new ApiError(payload.error ?? `The editor answered ${response.status}.`, response.status)
  return payload as T
}

// --- the change panel -------------------------------------------------------------------------------------

/** A line diff, with the unchanged parts around each change kept short. */
export function diffLines(
  before: string,
  after: string,
): Array<{ kind: ' ' | '+' | '-' | '~'; text: string }> {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  // A longest-common-subsequence table for the part that differs; a huge difference is shown as removed then added.
  const ops: Array<{ kind: ' ' | '+' | '-'; text: string }> = []
  if (midA.length * midB.length > 2_000_000) {
    for (const line of midA) ops.push({ kind: '-', text: line })
    for (const line of midB) ops.push({ kind: '+', text: line })
  } else {
    const table: number[][] = Array.from({ length: midA.length + 1 }, () =>
      new Array<number>(midB.length + 1).fill(0),
    )
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i]![j] =
          midA[i] === midB[j]
            ? table[i + 1]![j + 1]! + 1
            : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        ops.push({ kind: ' ', text: midA[i]! })
        i++
        j++
      } else if (i < midA.length && (j === midB.length || table[i + 1]![j]! >= table[i]![j + 1]!)) {
        // A removed line comes before the line that replaces it.
        ops.push({ kind: '-', text: midA[i++]! })
      } else ops.push({ kind: '+', text: midB[j++]! })
    }
  }
  const context = 2
  const out: Array<{ kind: ' ' | '+' | '-' | '~'; text: string }> = []
  const lead = a.slice(Math.max(0, start - context), start)
  if (start > context) out.push({ kind: '~', text: `${start - context} unchanged lines` })
  for (const line of lead) out.push({ kind: ' ', text: line })
  out.push(...ops)
  const tail = a.slice(endA, endA + context)
  for (const line of tail) out.push({ kind: ' ', text: line })
  const rest = a.length - endA - tail.length
  if (rest > 0) out.push({ kind: '~', text: `${rest} unchanged lines` })
  return out
}

function fileDiff(file: PlanFile): HTMLElement {
  const title =
    file.before === null
      ? `${file.file} (new file)`
      : file.after === null
        ? `${file.file} (deleted)`
        : file.file
  const lines = diffLines(file.before ?? '', file.after ?? '')
  const body = h('pre', {
    class: 'docs-diff',
    tabindex: 0,
    'aria-label': `Changes to ${file.file}`,
  })
  for (const line of lines) {
    const row = h('span', {
      class: `docs-diff-${line.kind === '+' ? 'add' : line.kind === '-' ? 'del' : line.kind === '~' ? 'skip' : 'same'}`,
    })
    // The sign is text, not only color, so the change reads without seeing the color.
    row.textContent = line.kind === '~' ? `  … ${line.text}` : `${line.kind} ${line.text}`
    body.append(row, '\n')
  }
  return h(
    'details',
    { class: 'docs-diff-file', open: lines.length < 60 },
    h('summary', null, title),
    body,
  )
}

const KIND_TITLE: Record<string, string> = {
  breaking: 'Breaking',
  additive: 'Added',
  cosmetic: 'Changed',
}

export interface PanelHooks {
  /** Called after the change is saved. */
  saved(): void
  discarded(): void
}

/** Show a plan: what the compiler says, what it means, the files, and the buttons. */
export function planPanel(plan: Plan, hooks: PanelHooks): HTMLElement {
  const panel = h('section', { class: 'docs-plan', 'aria-labelledby': 'plan-title' })
  panel.append(h('h3', { id: 'plan-title' }, plan.summary))

  if (plan.blocking.length) {
    panel.append(
      h(
        'div',
        { class: 'docs-plan-block', role: 'alert' },
        h('strong', null, 'This change cannot be saved, because it would break the project:'),
        h(
          'ul',
          null,
          ...plan.blocking.map((p) =>
            h(
              'li',
              null,
              h('span', null, `${p.file ? p.file + ': ' : ''}${p.message}`),
              p.hint ? h('div', { class: 'docs-muted' }, p.hint) : null,
            ),
          ),
        ),
      ),
    )
  }

  for (const kind of ['breaking', 'additive', 'cosmetic']) {
    const items = plan.changes.filter((c) => c.kind === kind && !c.deprecation)
    const deprecations = kind === 'additive' ? plan.changes.filter((c) => c.deprecation) : []
    if (!items.length && !deprecations.length) continue
    panel.append(
      h(
        'div',
        { class: `docs-plan-kind docs-plan-${kind}` },
        h(
          'h4',
          null,
          kind === 'breaking' ? 'Breaking for people using the system' : KIND_TITLE[kind],
        ),
        h(
          'ul',
          null,
          ...[...items, ...deprecations].map((c) =>
            h(
              'li',
              null,
              c.message,
              c.codemod
                ? h(
                    'span',
                    { class: 'docs-muted' },
                    ' (the codemod updates every use in this save)',
                  )
                : null,
            ),
          ),
        ),
      ),
    )
  }
  if (!plan.changes.length && !plan.blocking.length) {
    panel.append(
      h(
        'p',
        { class: 'docs-muted' },
        'No change to what other people see: no variant, token, or component changes.',
      ),
    )
  }

  if (plan.notes.length) {
    panel.append(
      h(
        'div',
        { class: 'docs-plan-notes' },
        h('h4', null, 'Notes'),
        h('ul', null, ...plan.notes.map((n) => h('li', null, n))),
      ),
    )
  }

  panel.append(h('h4', null, `Files (${plan.files.length})`))
  if (!plan.files.length) panel.append(h('p', { class: 'docs-muted' }, 'Nothing would be written.'))
  for (const f of plan.files) panel.append(fileDiff(f))

  const status = h('p', { class: 'docs-plan-status', role: 'status' })
  const save = h(
    'button',
    {
      class: 'docs-button docs-primary',
      type: 'button',
      disabled: plan.blocking.length > 0 || plan.files.length === 0,
      onclick: async () => {
        save.setAttribute('disabled', '')
        status.textContent = 'Saving…'
        try {
          await api('POST', 'apply', { id: plan.id })
          status.textContent = 'Saved.'
          hooks.saved()
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error)
          save.removeAttribute('disabled')
        }
      },
    },
    'Save this change',
  )
  const discard = h(
    'button',
    { class: 'docs-button', type: 'button', onclick: () => hooks.discarded() },
    'Discard',
  )
  panel.append(h('div', { class: 'docs-tools' }, save, discard), status)
  return panel
}

// --- forms ------------------------------------------------------------------------------------------------

let nextId = 0
const uid = (prefix: string) => `${prefix}-${nextId++}`

function field(label: string, input: HTMLElement): HTMLElement {
  if (!input.id) input.id = uid('f')
  return h('div', { class: 'docs-field' }, h('label', { for: input.id }, label), input)
}

const input = (value = '', placeholder = '') =>
  h('input', { type: 'text', value, placeholder }) as HTMLInputElement
/** The token import page: choose the files of an export, preview, save. */
export function importPage(hooks: PanelHooks): HTMLElement {
  const region = h('div', { 'aria-live': 'polite' })
  const error = h('p', { class: 'docs-error-line', role: 'alert' })
  const picker = h('input', {
    type: 'file',
    multiple: true,
    accept: '.json,application/json',
  }) as HTMLInputElement
  // A whole folder keeps its structure, which a Resolver document needs to find the files it names.
  const folder = h('input', { type: 'file', webkitdirectory: true }) as HTMLInputElement
  const format = h(
    'select',
    null,
    h('option', { value: 'auto' }, 'Detect it'),
    h('option', { value: 'dtcg' }, 'DTCG (with a Resolver)'),
    h('option', { value: 'tokens-studio' }, 'Tokens Studio or Penpot'),
  ) as HTMLSelectElement
  const go = h(
    'button',
    {
      class: 'docs-button',
      type: 'button',
      onclick: async () => {
        error.textContent = ''
        region.replaceChildren()
        const chosen = [...(picker.files ?? []), ...(folder.files ?? [])].filter((f) =>
          f.name.endsWith('.json'),
        )
        if (!chosen.length) {
          error.textContent = 'Choose the files of a token export first.'
          return
        }
        try {
          const files = await Promise.all(
            chosen.map(async (f) => ({
              path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
              content: await f.text(),
            })),
          )
          const plan = await api<Plan>('POST', 'plan', {
            kind: 'tokenImport',
            files,
            format: format.value,
          })
          region.replaceChildren(
            planPanel(plan, {
              saved: hooks.saved,
              discarded: () => {
                region.replaceChildren()
                hooks.discarded()
              },
            }),
          )
        } catch (e) {
          error.textContent = e instanceof Error ? e.message : String(e)
        }
      },
    },
    'Preview the import',
  )
  return h(
    'div',
    null,
    h('h1', null, 'Bring in a token export'),
    h(
      'p',
      { class: 'docs-lead' },
      'Tokens are edited in your design tool. Export them (as DTCG with its resolver file, or as Tokens Studio or Penpot files), choose the files here, and see what would change before anything is saved.',
    ),
    h(
      'fieldset',
      null,
      h('legend', null, 'The export'),
      field('Files (choose all of them)', picker),
      field('Or choose the whole export folder', folder),
      field('Format', format),
      go,
      error,
    ),
    region,
  )
}

// --- token export -----------------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A ZIP of the files, stored without compression (token files are small), so no library is needed. */
export function zipFiles(files: Array<{ path: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder()
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (view: DataView, at: number, v: number) => view.setUint16(at, v, true)
  const u32 = (view: DataView, at: number, v: number) => view.setUint32(at, v, true)
  for (const file of files) {
    const name = encoder.encode(file.path)
    const data = encoder.encode(file.content)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    u32(lv, 0, 0x04034b50)
    u16(lv, 4, 20)
    u16(lv, 6, 0x0800) // names are UTF-8
    u16(lv, 10, time)
    u16(lv, 12, date)
    u32(lv, 14, crc)
    u32(lv, 18, data.length)
    u32(lv, 22, data.length)
    u16(lv, 26, name.length)
    local.set(name, 30)
    const entry = new Uint8Array(46 + name.length)
    const ev = new DataView(entry.buffer)
    u32(ev, 0, 0x02014b50)
    u16(ev, 4, 20)
    u16(ev, 6, 20)
    u16(ev, 8, 0x0800)
    u16(ev, 12, time)
    u16(ev, 14, date)
    u32(ev, 16, crc)
    u32(ev, 20, data.length)
    u32(ev, 24, data.length)
    u16(ev, 28, name.length)
    u32(ev, 42, offset)
    entry.set(name, 46)
    chunks.push(local, data)
    central.push(entry)
    offset += local.length + data.length
  }
  const size = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const dv = new DataView(end.buffer)
  u32(dv, 0, 0x06054b50)
  u16(dv, 8, files.length)
  u16(dv, 10, files.length)
  u32(dv, 12, size)
  u32(dv, 16, offset)
  const all = [...chunks, ...central, end]
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const part of all) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function download(name: string, type: string, bytes: Uint8Array | string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const link = h('a', { href: url, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const EXPORT_FORMATS: Array<{ id: 'dtcg' | 'tokens-studio'; label: string; help: string }> = [
  {
    id: 'dtcg',
    label: 'DTCG (with a Resolver)',
    help: 'The W3C Design Tokens format: one file per set plus a resolver file. Figma variables and most token tools read it.',
  },
  {
    id: 'tokens-studio',
    label: 'Tokens Studio or Penpot',
    help: 'The files the Tokens Studio plugin and Penpot read: one file per set, with $themes.json and $metadata.json.',
  },
]

/** The token export page: choose a format, see the files, download them one by one or as a zip. */
export function exportPage(
  project: string,
  exports: Partial<Record<'dtcg' | 'tokens-studio', Array<{ path: string; content: string }>>>,
): HTMLElement {
  const available = EXPORT_FORMATS.filter((f) => exports[f.id]?.length)
  const region = h('div', { 'aria-live': 'polite' })
  const select = h(
    'select',
    null,
    ...available.map((f) => h('option', { value: f.id }, f.label)),
  ) as HTMLSelectElement
  const show = () => {
    const format = available.find((f) => f.id === select.value)
    const files = (format && exports[format.id]) || []
    const slug = project.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'tokens'
    region.replaceChildren(
      h('p', { class: 'docs-muted' }, format?.help),
      h(
        'button',
        {
          class: 'docs-button docs-primary',
          type: 'button',
          onclick: () =>
            download(`${slug}-${select.value}.zip`, 'application/zip', zipFiles(files)),
        },
        'Download all as a zip',
      ),
      h('h2', null, `Files (${files.length})`),
      h(
        'ul',
        { class: 'docs-export-files' },
        ...files.map((f) =>
          h(
            'li',
            null,
            h('code', null, f.path),
            ' ',
            h(
              'button',
              {
                class: 'docs-button',
                type: 'button',
                'aria-label': `Download ${f.path}`,
                onclick: () => download(f.path.split('/').pop()!, 'application/json', f.content),
              },
              'Download',
            ),
          ),
        ),
      ),
    )
  }
  select.addEventListener('change', show)
  show()
  return h(
    'div',
    null,
    h('h1', null, 'Send tokens to your design tool'),
    h(
      'p',
      { class: 'docs-lead' },
      'The tokens in this project, as files a design tool reads. Edit them there, then bring the export back in with “Bring in tokens”.',
    ),
    h('fieldset', null, h('legend', null, 'Format'), field('Format', select)),
    region,
  )
}

/** The git panel: what changed, and "propose this change". */
export async function gitPanel(hooks: { proposed(branch: string): void }): Promise<HTMLElement> {
  const state = await api<{
    repo: boolean
    branch: string | null
    status: Array<{ code: string; path: string }>
    changed: string[]
  }>('GET', 'git')
  const panel = h(
    'section',
    { class: 'docs-git', 'aria-labelledby': 'git-title' },
    h('h2', { id: 'git-title' }, 'Changes in this project'),
  )
  if (!state.repo) {
    panel.append(
      h(
        'p',
        { class: 'docs-muted' },
        'This project is not in a git repository, so changes are written to the files only.',
      ),
    )
    return panel
  }
  panel.append(h('p', null, `On branch ${state.branch}.`))
  panel.append(
    state.status.length
      ? h('ul', null, ...state.status.map((s) => h('li', null, `${s.code} ${s.path}`)))
      : h('p', { class: 'docs-muted' }, 'Nothing is changed.'),
  )
  if (state.changed.length) {
    const message = input('', 'Describe the change')
    const out = h('p', { role: 'status' })
    panel.append(
      h('p', null, `The manager changed: ${state.changed.join(', ')}.`),
      field('Message for the change', message),
      h(
        'button',
        {
          class: 'docs-button',
          type: 'button',
          onclick: async () => {
            try {
              const r = await api<{ branch: string; commit: string }>('POST', 'propose', {
                message: message.value,
              })
              out.textContent = `Committed ${r.commit} on the new branch ${r.branch}. Nothing was pushed.`
              hooks.proposed(r.branch)
            } catch (e) {
              out.textContent = e instanceof Error ? e.message : String(e)
            }
          },
        },
        'Propose this change (new branch and commit)',
      ),
      out,
    )
  }
  return panel
}

/** The bar at the top in edit mode: it says editing is on, and offers undo for the last save. */
export async function editBar(onUndone: () => void): Promise<HTMLElement> {
  const state = await api<{ undo: { summary: string } | null }>('GET', 'state')
  const bar = h(
    'div',
    { class: 'docs-editbar', role: 'region', 'aria-label': 'Editing' },
    h('strong', null, 'Editing is on.'),
    ' ',
    'Changes are checked by the compiler before they are saved.',
  )
  if (state.undo) {
    const status = h('span', { role: 'status' })
    bar.append(
      ' Last saved: ',
      state.undo.summary,
      '. ',
      h(
        'button',
        {
          class: 'docs-button',
          type: 'button',
          onclick: async () => {
            try {
              await api('POST', 'undo', {})
              status.textContent = 'Undone.'
              onUndone()
            } catch (e) {
              status.textContent = e instanceof Error ? e.message : String(e)
            }
          },
        },
        'Undo',
      ),
      ' ',
      status,
    )
  }
  return bar
}
