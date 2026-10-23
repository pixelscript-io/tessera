import type { Plan, PlanFile } from '../edit/plan'

/**
 * The system manager's side of the docs app: forms that ask the server to prepare a change, a panel that shows
 * what it would do (the files as a diff, the compiler's verdict, what it means for the people using the system),
 * and the buttons that save, discard and undo. The server decides everything; this only asks and shows.
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

  for (const u of plan.usage) {
    panel.append(
      h(
        'div',
        { class: 'docs-plan-usage' },
        h('h4', null, u.label),
        u.uses.length
          ? h('ul', null, ...u.uses.map((x) => h('li', null, `${x.file} (${x.count})`)))
          : h('p', { class: 'docs-muted' }, 'No uses found.'),
      ),
    )
  }
  if (plan.codemod) {
    panel.append(
      h(
        'p',
        null,
        `Saving also rewrites ${plan.codemod.edits} ${plan.codemod.edits === 1 ? 'use' : 'uses'} in ${plan.codemod.files} ${plan.codemod.files === 1 ? 'file' : 'files'}.`,
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
const textarea = (value = '') => {
  const el = h('textarea', { rows: 3 }) as HTMLTextAreaElement
  el.value = value
  return el
}

interface ComponentLike {
  name: string
  description?: string
  since?: string
  deprecated?: string
  variants: Array<{ name: string; values: string[]; default: string }>
  slots: Record<string, string>
  events: Record<string, string>
  deprecatedValues?: Record<string, Record<string, string>>
}

/** The editing section of a component page. `show` receives the plan panel to put on the page. */
export function componentEditor(
  c: ComponentLike,
  show: (panel: HTMLElement | null) => void,
  hooks: PanelHooks,
): HTMLElement {
  const root = h('div', { class: 'docs-editor' })
  const errorLine = h('p', { class: 'docs-error-line', role: 'alert' })

  const preview = async (op: unknown) => {
    errorLine.textContent = ''
    try {
      const plan = await api<Plan>('POST', 'plan', { kind: 'contract', component: c.name, op })
      show(
        planPanel(plan, {
          saved: hooks.saved,
          discarded: () => {
            show(null)
            hooks.discarded()
          },
        }),
      )
    } catch (error) {
      show(null)
      errorLine.textContent = error instanceof Error ? error.message : String(error)
    }
  }
  const button = (label: string, onclick: () => void) =>
    h('button', { class: 'docs-button', type: 'button', onclick }, label)

  // About: description, version, deprecation.
  const description = textarea(c.description ?? '')
  const since = input(c.since ?? '', '1.0.0')
  const deprecated = input(c.deprecated ?? '', 'What to use instead')
  root.append(
    h(
      'fieldset',
      null,
      h('legend', null, 'About this component'),
      field('Description', description),
      button('Preview description change', () =>
        preview({ kind: 'description', value: description.value }),
      ),
      field('Introduced in version', since),
      button('Preview version change', () => preview({ kind: 'since', value: since.value.trim() })),
      field(
        'Deprecated: say what to use instead (leave empty if it is not deprecated)',
        deprecated,
      ),
      button('Preview deprecation change', () =>
        preview({
          kind: 'deprecated',
          value: deprecated.value.trim() === '' ? null : deprecated.value,
        }),
      ),
    ),
  )

  // Variants.
  for (const v of c.variants) {
    const value = h(
      'select',
      null,
      ...v.values.map((x) => h('option', { value: x }, x + (x === v.default ? ' (default)' : ''))),
    ) as HTMLSelectElement
    const action = h(
      'select',
      null,
      h('option', { value: 'default' }, 'Make the default'),
      h('option', { value: 'rename' }, 'Rename to…'),
      h('option', { value: 'deprecate' }, 'Deprecate…'),
      h('option', { value: 'undeprecate' }, 'Remove the deprecation'),
      h('option', { value: 'remove' }, 'Remove'),
    ) as HTMLSelectElement
    const extra = input('', 'New name, or what to use instead')
    const add = input('', 'A new value')
    root.append(
      h(
        'fieldset',
        null,
        h('legend', null, `Variant: ${v.name}`),
        h(
          'p',
          { class: 'docs-muted' },
          `Values: ${v.values.join(', ')}. The first is the default.`,
        ),
        field('Value', value),
        field('Do this', action),
        field('Name or message (for Rename and Deprecate)', extra),
        button(`Preview change to ${v.name}`, () => {
          const base = { variant: v.name, value: value.value }
          switch (action.value) {
            case 'default':
              return preview({ kind: 'setDefault', ...base })
            case 'rename':
              return preview({
                kind: 'renameValue',
                variant: v.name,
                from: value.value,
                to: extra.value.trim(),
              })
            case 'deprecate':
              return preview({ kind: 'deprecateValue', ...base, message: extra.value })
            case 'undeprecate':
              return preview({ kind: 'deprecateValue', ...base, message: null })
            default:
              return preview({ kind: 'removeValue', ...base })
          }
        }),
        field('Add a value', add),
        button(`Preview adding the value to ${v.name}`, () =>
          preview({ kind: 'addValue', variant: v.name, value: add.value.trim() }),
        ),
      ),
    )
  }
  const variantName = input('', 'size')
  const variantValues = input('', 'sm, md, lg')
  root.append(
    h(
      'fieldset',
      null,
      h('legend', null, 'Add a variant'),
      field('Name', variantName),
      field('Values, separated by commas (the first is the default)', variantValues),
      button('Preview adding the variant', () =>
        preview({
          kind: 'addVariant',
          variant: variantName.value.trim(),
          values: variantValues.value
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        }),
      ),
    ),
  )

  // Slots and events: their descriptions.
  for (const group of ['slot', 'event'] as const) {
    const items = Object.entries(group === 'slot' ? c.slots : c.events)
    const fieldset = h('fieldset', null, h('legend', null, group === 'slot' ? 'Slots' : 'Events'))
    for (const [name, text] of items) {
      const box = input(text)
      fieldset.append(
        field(`${name}: what it is for`, box),
        button(`Preview change to ${name}`, () =>
          preview({ kind: group, name, description: box.value }),
        ),
      )
    }
    const newName = input('', group === 'slot' ? 'icon' : 'change')
    const newText = input('', 'What it is for')
    fieldset.append(
      field(`Add a ${group}: name`, newName),
      field('What it is for', newText),
      button(`Preview adding the ${group}`, () =>
        preview({ kind: group, name: newName.value.trim(), description: newText.value }),
      ),
    )
    root.append(fieldset)
  }
  root.append(errorLine)
  return root
}

/** "Add a component": a form for the overview. */
export function newComponentForm(
  show: (panel: HTMLElement | null) => void,
  hooks: PanelHooks,
): HTMLElement {
  const name = input('', 'UserCard')
  const description = input('', 'What it is for')
  const error = h('p', { class: 'docs-error-line', role: 'alert' })
  const go = h(
    'button',
    {
      class: 'docs-button',
      type: 'button',
      onclick: async () => {
        error.textContent = ''
        try {
          const plan = await api<Plan>('POST', 'plan', {
            kind: 'newComponent',
            name: name.value.trim(),
            description: description.value,
          })
          show(
            planPanel(plan, {
              saved: hooks.saved,
              discarded: () => {
                show(null)
                hooks.discarded()
              },
            }),
          )
        } catch (e) {
          show(null)
          error.textContent = e instanceof Error ? e.message : String(e)
        }
      },
    },
    'Preview the new component',
  )
  return h(
    'fieldset',
    null,
    h('legend', null, 'Add a component'),
    field('Name (PascalCase)', name),
    field('Description', description),
    go,
    error,
  )
}

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
