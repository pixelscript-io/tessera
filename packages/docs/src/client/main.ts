import raw from 'virtual:tessera-docs/data'
import { components, live } from 'virtual:tessera-docs/components'
import {
  createRoot,
  previewComponents,
  previewSlots,
  state,
  type PreviewContent,
} from 'virtual:tessera-docs/runtime'
import type { DocsComponent, DocsData } from '../data'
import { editBar, exportPage, gitPanel, importPage, readKey } from './editor'
import { STYLE } from './style'

const data = raw as DocsData

type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | number | boolean | undefined | ((e: any) => void)>

/** A tiny element builder. Text goes in as text, so nothing from the project is ever read as markup. */
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

const code = (text: string) => h('code', null, text)
const list = (items: Child[]) => h('ul', null, ...items.map((i) => h('li', null, i)))

function table(head: string[], rows: Child[][]): HTMLElement {
  return h(
    'table',
    null,
    h('thead', null, h('tr', null, ...head.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', null, ...rows.map((r) => h('tr', null, ...r.map((c) => h('td', null, c))))),
  )
}

// --- the page -------------------------------------------------------------------------------------------

const style = document.createElement('style')
style.textContent = STYLE
document.head.append(style)
const root = document.getElementById('docs')!

/** Write mode is on (the server says so) and this tab has the key. Everything below that edits is gated on it. */
const editing = data.edit === true && readKey() !== null

/** After a save the page reloads, so it shows the saved state; the server remembers what was saved. */
const afterSave = {
  saved: () => setTimeout(() => location.reload(), 600),
  discarded: () => {},
}

const tokenGroups = [...new Set(data.tokens.entries.map((t) => t.path.split('.')[0]!))]

function nav(current: string): HTMLElement {
  const link = (href: string, label: string) =>
    h(
      'li',
      null,
      h('a', { href: `#${href}`, 'aria-current': current === href ? 'page' : undefined }, label),
    )
  const origins: Array<[DocsComponent['origin'], string]> = [
    ['system', 'Design system'],
    ['app', 'This app'],
    ['router', 'Router'],
  ]
  return h(
    'nav',
    { class: 'docs-nav', 'aria-label': 'Documentation' },
    h('ul', null, link('/', 'Overview')),
    ...origins.flatMap(([origin, title]) => {
      const items = data.components.filter((c) => c.origin === origin)
      return items.length
        ? [
            h('h2', null, title),
            h('ul', null, ...items.map((c) => link(`/components/${c.name}`, c.name))),
          ]
        : []
    }),
    data.hasTokens
      ? h(
          'div',
          null,
          h('h2', null, 'Tokens'),
          h(
            'ul',
            null,
            ...tokenGroups.map((g) => link(`/tokens/${g}`, g)),
            link('/tokens/contrast', 'Contrast'),
            data.exports ? link('/export', 'Export') : null,
          ),
        )
      : null,
    editing
      ? h(
          'div',
          null,
          h('h2', null, 'Manage'),
          h('ul', null, link('/import', 'Bring in tokens'), link('/changes', 'Changes')),
        )
      : null,
  )
}

/** The theme and density switchers: one per attribute the tokens define, always visible. */
function switchers(): HTMLElement {
  const attributes = new Map<string, { names: string[]; auto: boolean }>()
  for (const t of data.manifest.tokens.themes) {
    const entry = attributes.get(t.attribute) ?? { names: [], auto: false }
    entry.names.push(t.name)
    entry.auto ||= !!t.auto
    attributes.set(t.attribute, entry)
  }
  const wrap = h('div', { class: 'docs-switch', role: 'group', 'aria-label': 'Preview settings' })
  for (const [attribute, { names, auto }] of attributes) {
    const id = `switch-${attribute}`
    const select = h(
      'select',
      {
        id,
        onchange: (e: Event) => {
          const value = (e.target as HTMLSelectElement).value
          if (value === '') document.documentElement.removeAttribute(`data-${attribute}`)
          else document.documentElement.setAttribute(`data-${attribute}`, value)
        },
      },
      h('option', { value: '' }, 'default'),
      ...(auto ? [h('option', { value: 'auto' }, 'auto')] : []),
      ...names.map((n) => h('option', { value: n }, n)),
    ) as HTMLSelectElement
    select.value = document.documentElement.getAttribute(`data-${attribute}`) ?? ''
    wrap.append(h('label', { for: id }, attribute), select)
  }
  return wrap
}

// --- overview: the coverage report ------------------------------------------------------------------------

interface ReportLike {
  today: string
  styles: {
    declarations: number
    tokenized: number
    raw: number
    ratio: number | null
    byDirectory: Record<
      string,
      { declarations: number; tokenized: number; raw: number; ratio: number | null }
    >
  }
  rawEscapes: Array<{
    file: string
    line: number
    value: string
    reason: string
    expires?: string
    expired: boolean
  }>
  exemptions: Array<{
    files: string[]
    rules: string[]
    level: string
    reason?: string
    expires?: string
    expired: boolean
  }>
  baseline: { violations: number; files: number; byRule: Record<string, number> }
  contracts: {
    components: number
    withContract: number
    withoutContract: string[]
    coverage: number | null
  }
  a11y: { generated: string[]; notGenerated: string[] }
  deprecated: Array<{
    component: string
    message: string
    usages: Array<{ file: string; count: number }>
  }>
  deprecatedValues?: Array<{
    component: string
    variant: string
    value: string
    message: string
    usages: Array<{ file: string; count: number }>
  }>
  deprecatedTokens?: Array<{
    token: string
    message: string
    usages: Array<{ file: string; count: number }>
  }>
  pendingRenames?: Array<{
    kind: string
    from: string
    to: string
    usages: Array<{ file: string; count: number }>
  }>
}

/** A color the way a person reads it: whole numbers in `rgb(...)`, not `236.999999`. */
const shown = (value: string) =>
  value.startsWith('rgb')
    ? value.replace(/\d+\.\d{3,}/g, (n) => (Number(n) >= 1 ? String(Math.round(Number(n))) : n))
    : value

const pct = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n * 100)}%`)
const card = (value: string, label: string) =>
  h('div', { class: 'docs-card' }, h('b', null, value), h('span', null, label))

function overview(): HTMLElement {
  const report = data.report as ReportLike | undefined
  const main = h(
    'div',
    null,
    h('p', { class: 'docs-eyebrow' }, 'Design system'),
    h('h1', null, data.project.name),
    h(
      'p',
      { class: 'docs-lead' },
      'Generated from the components and tokens of this project. Nothing on these pages is written by hand.',
    ),
  )
  main.append(
    h(
      'div',
      { class: 'docs-cards' },
      card(String(data.components.length), 'components'),
      card(String(data.tokens.entries.length), 'tokens'),
      card(String(data.manifest.tokens.themes.length), 'themes and densities'),
      card(String(data.manifest.routes.routes.length), 'routes'),
    ),
  )
  if (!report?.contracts || !report.styles) {
    main.append(
      h('p', { class: 'docs-muted' }, 'The coverage report is not available in this build.'),
    )
    return main
  }
  main.append(
    h('h2', null, 'Coverage'),
    h(
      'div',
      { class: 'docs-cards' },
      card(
        pct(report.contracts.coverage),
        `contract coverage (${report.contracts.withContract} of ${report.contracts.components})`,
      ),
      card(
        pct(report.styles.ratio),
        `of style declarations use tokens (${report.styles.tokenized} of ${report.styles.declarations})`,
      ),
      card(String(report.rawEscapes.length), 'raw() escapes'),
      card(
        String(report.baseline.violations),
        `violations in the baseline (${report.baseline.files} files)`,
      ),
    ),
    h(
      'div',
      { class: 'docs-tools' },
      h(
        'button',
        {
          class: 'docs-button',
          type: 'button',
          onclick: () => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
            )
            const a = h('a', { href: url, download: 'tessera-report.json' })
            a.click()
            URL.revokeObjectURL(url)
          },
        },
        'Download report.json',
      ),
      h(
        'span',
        { class: 'docs-muted' },
        `As of ${report.today}. The same data as tessera report --json.`,
      ),
    ),
    h('h2', null, 'Tokenized and hand-written declarations by directory'),
    table(
      ['Directory', 'Declarations', 'Tokens', 'Raw', 'Share'],
      Object.entries(report.styles.byDirectory).map(([dir, s]) => [
        dir,
        String(s.declarations),
        String(s.tokenized),
        String(s.raw),
        pct(s.ratio),
      ]),
    ),
    h('h2', null, 'Accessibility suites'),
    h(
      'p',
      { class: 'docs-muted' },
      'A component is listed when a generated accessibility suite covers it. This says the suite exists, not that it passes: run the tests for that.',
    ),
    table(
      ['Component', 'Generated suite'],
      [
        ...report.a11y.generated.map((n) => [n, 'yes']),
        ...report.a11y.notGenerated.map((n) => [n, 'no']),
      ],
    ),
  )
  if (report.rawEscapes.length) {
    main.append(
      h('h2', null, 'raw() escapes'),
      table(
        ['File', 'Value', 'Reason', 'Expires'],
        report.rawEscapes.map((r) => [
          `${r.file}:${r.line}`,
          code(r.value),
          r.reason,
          r.expires ? `${r.expires}${r.expired ? ' (expired)' : ''}` : 'never',
        ]),
      ),
    )
  }
  if (report.exemptions.length) {
    main.append(
      h('h2', null, 'Exemptions'),
      table(
        ['Files', 'Rules', 'Level', 'Reason', 'Expires'],
        report.exemptions.map((e) => [
          e.files.join(', '),
          e.rules.join(', '),
          e.level,
          e.reason ?? '',
          e.expires ? `${e.expires}${e.expired ? ' (expired)' : ''}` : 'never',
        ]),
      ),
    )
  }
  if (report.deprecated.length) {
    main.append(
      h('h2', null, 'Deprecated components in use'),
      table(
        ['Component', 'Message', 'Used in'],
        report.deprecated.map((d) => [
          d.component,
          d.message,
          d.usages.map((u) => `${u.file} (${u.count})`).join(', '),
        ]),
      ),
    )
  }
  const uses = (u: Array<{ file: string; count: number }>) =>
    u.length ? u.map((x) => `${x.file} (${x.count})`).join(', ') : 'no remaining uses'
  if (report.deprecatedValues?.length) {
    main.append(
      h('h2', null, 'Deprecated variant values'),
      table(
        ['Value', 'Message', 'Used in'],
        report.deprecatedValues.map((d) => [
          `${d.component}.${d.variant} "${d.value}"`,
          d.message,
          uses(d.usages),
        ]),
      ),
    )
  }
  if (report.deprecatedTokens?.length) {
    main.append(
      h('h2', null, 'Deprecated tokens'),
      table(
        ['Token', 'Message', 'Used in'],
        report.deprecatedTokens.map((d) => [code(`$${d.token}`), d.message, uses(d.usages)]),
      ),
    )
  }
  if (report.pendingRenames?.length) {
    main.append(
      h('h2', null, 'Renames not applied yet'),
      h('p', { class: 'docs-muted' }, 'Run tessera codemod --write to update these uses.'),
      table(
        ['Was', 'Now', 'Used in'],
        report.pendingRenames.map((r) => [code(r.from), code(r.to), uses(r.usages)]),
      ),
    )
  }
  return main
}

// --- a component page -------------------------------------------------------------------------------------

const NOT_AUTOMATED = [
  'Screen reader announcement quality',
  'Label and content quality',
  'Focus order in context',
  'Reduced-motion behavior',
]

/** Mount a project component in `into`. Returns a function that tears it down. */
async function mountComponent(
  name: string,
  into: HTMLElement,
  input: {
    props?: Record<string, unknown>
    events?: Record<string, (d?: unknown) => void>
    slots?: Record<string, () => unknown[]>
  },
): Promise<() => void> {
  const load = components[name]
  if (!load) throw new Error(`There is no component named ${name}.`)
  const mod = await load()
  return createRoot((dispose) => {
    into.replaceChildren(mod.default(input))
    return dispose
  })
}

function showError(into: HTMLElement, error: unknown) {
  into.replaceChildren(
    h(
      'div',
      { class: 'docs-error', role: 'alert' },
      error instanceof Error ? error.message : String(error),
    ),
  )
}

type ManifestComponent = (typeof data.manifest.components)[number]

/** A slot with no sample content still gets some, so a component never shows an empty hole where text belongs. */
function sampleFor(slot: string): string | undefined {
  if (slot === 'icon') return undefined
  return slot === 'default' ? 'Label' : slot[0]!.toUpperCase() + slot.slice(1)
}

/**
 * The part of the page that shows a component and lets a person try it. What it shows comes from the contract's
 * `preview` (sample props and slot content) and what it lets you change comes from the component itself: a control for
 * each variant, and for each prop whose default says what kind of value it takes.
 */
function preview(c: ManifestComponent): HTMLElement {
  const stage = h('div', { class: 'docs-stage', 'aria-live': 'polite' })
  const log = h('ol', { class: 'docs-events', 'aria-label': 'Events fired' })
  const sample = c.preview ?? {}
  const variantNames = new Set(c.variants.map((v) => v.name))

  // One signal for each thing a control can change: a variant, or a prop whose value is text, a number or on/off.
  const signals: Record<string, ReturnType<typeof state<any>>> = Object.fromEntries(
    c.variants.map((v) => [v.name, state<unknown>(sample.props?.[v.name] ?? v.default)]),
  )
  const editable: Array<{ name: string; type: 'boolean' | 'number' | 'string' }> = []
  for (const p of c.props) {
    if (variantNames.has(p.name)) continue
    const given = sample.props && p.name in sample.props ? sample.props[p.name] : p.default
    if (p.type === 'boolean' || p.type === 'number' || p.type === 'string') {
      // A prop that is null in the sample (an unknown value) is not editable as text.
      signals[p.name] = state<unknown>(given ?? p.default)
      editable.push({ name: p.name, type: p.type })
    } else signals[p.name] = state<unknown>(given)
  }
  // Props the sample gives that the script does not name still reach the component.
  for (const [name, value] of Object.entries(sample.props ?? {})) {
    if (!(name in signals)) signals[name] = state<unknown>(value)
  }
  if (c.states.includes('disabled') && !('disabled' in signals)) {
    signals.disabled = state<unknown>(false)
    editable.push({ name: 'disabled', type: 'boolean' })
  }

  // Slot content: the sample's, else some text of its own. A text slot has a control; the rest are fixed.
  const slotContent: Record<string, PreviewContent> = {}
  for (const slot of Object.keys(c.slots)) {
    const given = sample.slots?.[slot]
    const fallback = sampleFor(slot)
    if (given !== undefined) slotContent[slot] = given as PreviewContent
    else if (fallback !== undefined) slotContent[slot] = fallback
  }
  const textSlots = Object.keys(slotContent).filter((s) => typeof slotContent[s] === 'string')

  let dispose: (() => void) | undefined
  let generation = 0
  const remount = async () => {
    const mine = ++generation
    dispose?.()
    dispose = undefined
    try {
      // Components named in the content are loaded first, so building the content is synchronous.
      const names = previewComponents({ slots: slotContent })
      const loaded: Record<string, (input?: any) => any> = {}
      for (const name of names) {
        const load = components[name]
        if (!load) throw new Error(`The preview uses ${name}, which does not exist.`)
        loaded[name] = (await load()).default
      }
      if (mine !== generation) return
      const resolve = (name: string) => loaded[name]
      dispose = await mountComponent(c.name, stage, {
        props: signals,
        events: Object.fromEntries(
          Object.keys(c.events).map((e) => [
            e,
            (detail?: unknown) => {
              log.prepend(
                h('li', null, `${e}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`),
              )
              // A dialog the person closes (Escape, the backdrop) is closed in the controls too.
              if (e === 'dismiss' && 'open' in signals) {
                signals.open!.value = false
                const box = document.getElementById(`ctl-${c.name}-open`) as HTMLInputElement | null
                if (box) box.checked = false
              }
            },
          ]),
        ),
        slots: previewSlots(slotContent, resolve),
      })
    } catch (error) {
      showError(stage, error)
    }
  }
  void remount()

  const controls = h('div', { class: 'docs-controls' }, h('h3', null, 'Controls'))
  for (const v of c.variants) {
    const id = `ctl-${c.name}-${v.name}`
    const select = h(
      'select',
      {
        id,
        onchange: (e: Event) => (signals[v.name]!.value = (e.target as HTMLSelectElement).value),
      },
      ...v.values.map((value) => h('option', { value }, value)),
    ) as HTMLSelectElement
    select.value = String(signals[v.name]!.value)
    controls.append(h('label', { for: id }, v.name, select))
  }
  for (const p of editable) {
    const id = `ctl-${c.name}-${p.name}`
    const current = signals[p.name]!.value
    if (p.type === 'boolean') {
      controls.append(
        h(
          'label',
          { for: id },
          h(
            'span',
            null,
            p.name,
            ' ',
            h('input', {
              id,
              type: 'checkbox',
              ...(current === true ? { checked: true } : {}),
              onchange: (e: Event) =>
                (signals[p.name]!.value = (e.target as HTMLInputElement).checked),
            }),
          ),
        ),
      )
    } else {
      controls.append(
        h(
          'label',
          { for: id },
          p.name,
          h('input', {
            id,
            type: p.type === 'number' ? 'number' : 'text',
            value: current === null || current === undefined ? '' : String(current),
            oninput: (e: Event) => {
              const raw = (e.target as HTMLInputElement).value
              signals[p.name]!.value = p.type === 'number' ? (raw === '' ? null : Number(raw)) : raw
            },
          }),
        ),
      )
    }
  }
  for (const slot of textSlots) {
    const id = `ctl-${c.name}-slot${slot === 'default' ? '' : '-' + slot}`
    controls.append(
      h(
        'label',
        { for: id },
        slot === 'default' ? 'content' : slot,
        h('input', {
          id,
          type: 'text',
          value: String(slotContent[slot]),
          oninput: (e: Event) => {
            slotContent[slot] = (e.target as HTMLInputElement).value
            void remount()
          },
        }),
      ),
    )
  }
  if (c.parts.length > 1) {
    controls.append(
      h(
        'label',
        null,
        h(
          'span',
          null,
          'show parts',
          ' ',
          h('input', {
            type: 'checkbox',
            onchange: (e: Event) =>
              stage.classList.toggle('parts', (e.target as HTMLInputElement).checked),
          }),
        ),
      ),
    )
  }
  if (Object.keys(c.events).length) controls.append(h('h3', null, 'Events'), log)

  // A component that needs data or children, and does not say what to show them with, shows less than it can.
  const needsSample =
    !c.preview &&
    (c.props.some((p) => p.type === 'array' || p.type === 'object' || p.type === 'unknown') ||
      Object.keys(c.slots).some((s) => s !== 'default' && s !== 'icon'))
  // An overlay that opens and closes (a dialog) shows nothing until it is open, and when it is open it covers the page.
  // It gets a button that opens it, so the preview always has something to press.
  if ('open' in signals && 'dismiss' in c.events) {
    controls.prepend(
      h(
        'button',
        {
          type: 'button',
          class: 'docs-button docs-primary',
          id: `ctl-${c.name}-trigger`,
          onclick: () => {
            signals.open!.value = true
            const box = document.getElementById(`ctl-${c.name}-open`) as HTMLInputElement | null
            if (box) box.checked = true
          },
        },
        `Open the ${c.name.toLowerCase()}`,
      ),
    )
  }
  return h(
    'div',
    null,
    h('div', { class: 'docs-preview' }, stage, controls),
    needsSample
      ? h(
          'p',
          { class: 'docs-note' },
          'This preview uses only the defaults. Add a ',
          code('"preview"'),
          ' to the contract with sample props and slot content to show it fully.',
        )
      : null,
  )
}

function componentPage(name: string): HTMLElement {
  const c = data.components.find((x) => x.name === name)
  const m = data.manifest.components.find((x) => x.name === name)
  if (!c || !m)
    return h(
      'div',
      null,
      h('h1', null, 'Not found'),
      h('p', null, `There is no component named ${name}.`),
    )
  const main = h(
    'div',
    null,
    h(
      'p',
      { class: 'docs-eyebrow' },
      c.origin === 'system' ? 'Component' : c.origin === 'app' ? 'This app' : 'Router',
    ),
    h('h1', null, c.name),
  )
  if (m.description) main.append(h('p', { class: 'docs-lead' }, m.description))
  main.append(
    h(
      'div',
      { class: 'docs-badges' },
      h('span', { class: 'docs-badge' }, `role: ${m.role}`),
      m.behavior ? h('span', { class: 'docs-badge' }, `behavior: ${m.behavior}`) : null,
      m.since ? h('span', { class: 'docs-badge' }, `since ${m.since}`) : null,
      h(
        'span',
        { class: 'docs-badge' },
        c.origin === 'system' ? 'design system' : c.origin === 'app' ? 'this app' : 'router',
      ),
      m.deprecated !== undefined
        ? h(
            'span',
            { class: 'docs-badge warn' },
            `deprecated${m.deprecated ? `: ${m.deprecated}` : ''}`,
          )
        : null,
    ),
    h('h2', null, 'Preview'),
    preview(m),
  )

  if (c.prose) {
    const prose = h('div', { class: 'docs-prose' })
    prose.innerHTML = c.prose.html
    main.append(h('h2', null, 'Guidance'), prose)
    prose.querySelectorAll<HTMLElement>('[data-live]').forEach((slot) => {
      const block = c.prose!.live[Number(slot.dataset.live)]
      if (!block) return
      const load = live[block.module]
      if (!load) return
      load()
        .then((mod) => {
          createRoot(() => slot.replaceChildren(mod.default()))
        })
        .catch((error) => showError(slot, error))
    })
  }

  if (m.variants.length) {
    main.append(
      h('h2', null, 'Variants'),
      table(
        ['Variant', 'Values', 'Default'],
        m.variants.map((v) => [v.name, v.values.join(', '), code(v.default)]),
      ),
    )
  }
  main.append(
    h('h2', null, 'Anatomy'),
    table(
      ['Part', 'Style it with'],
      m.parts.map((p) => [code(p), code(`.${p}`)]),
    ),
  )
  if (m.states.length) main.append(h('h2', null, 'States'), h('p', null, m.states.join(', ')))
  const slots = Object.entries(m.slots)
  if (slots.length)
    main.append(
      h('h2', null, 'Slots'),
      table(
        ['Slot', 'For'],
        slots.map(([n, d]) => [code(n), d]),
      ),
    )
  const events = Object.entries(m.events)
  if (events.length)
    main.append(
      h('h2', null, 'Events'),
      table(
        ['Event', 'Meaning'],
        events.map(([n, d]) => [code(`@${n}`), d]),
      ),
    )
  if (m.contrast.length)
    main.append(
      h('h2', null, 'Contrast pairs'),
      table(
        ['Text', 'Background'],
        m.contrast.map((p) => [code(p.foreground), code(p.background)]),
      ),
    )

  main.append(
    h('h2', null, 'Usage'),
    ...m.usage.map((u) => h('pre', null, h('code', null, u))),
    h('h2', null, 'Accessibility'),
    h(
      'p',
      null,
      c.a11yGenerated === undefined
        ? 'Whether a generated suite covers this component is not known in this build.'
        : c.a11yGenerated
          ? 'A generated axe-core suite covers every variant and state in every theme. It checks the role, keyboard behavior, focus visibility and disabled semantics.'
          : 'No generated accessibility suite covers this component yet.',
    ),
    h('p', { class: 'docs-muted' }, 'Automation does not cover:'),
    list(NOT_AUTOMATED),
    h('h2', null, 'Tokens used'),
    c.usedTokens.length
      ? h(
          'ul',
          null,
          ...c.usedTokens.map((t) =>
            h('li', null, h('a', { href: `#/tokens/${t.split('.')[0]}` }, code(`$${t}`))),
          ),
        )
      : h('p', { class: 'docs-muted' }, 'This component’s styles use no tokens.'),
    h(
      'p',
      { class: 'docs-muted' },
      c.rawEscapes
        ? `${c.rawEscapes} raw() escape${c.rawEscapes === 1 ? '' : 's'} in its styles.`
        : '',
    ),
    h('h2', null, 'Source'),
    h('p', { class: 'docs-muted' }, c.file),
    h(
      'details',
      null,
      h('summary', null, 'Show the source'),
      h('pre', null, h('code', null, c.source)),
    ),
  )
  return main
}

// --- tokens ----------------------------------------------------------------------------------------------

function specimen(type: string, css: string): Child {
  if (type === 'color')
    return h('span', {
      class: 'docs-swatch',
      style: `background:${css}`,
      role: 'img',
      'aria-label': css,
    })
  if (type === 'dimension') {
    const n = parseFloat(css)
    return Number.isFinite(n) && n > 0 && n < 400
      ? h('span', { class: 'docs-bar', style: `width:${css.endsWith('rem') ? n * 16 : n}px` })
      : null
  }
  if (type === 'shadow') return h('span', { class: 'docs-shadow', style: `box-shadow:${css}` })
  if (type === 'fontFamily')
    return h('span', { style: `font-family:${css};margin-right:8px` }, 'Aa')
  if (type === 'fontWeight')
    return h('span', { style: `font-weight:${css};margin-right:8px` }, 'Aa')
  return null
}

function tokenPage(group: string): HTMLElement {
  if (group === 'contrast') return contrastPage()
  const entries = data.tokens.entries.filter((t) => t.path.split('.')[0] === group)
  const filter = h('input', {
    type: 'search',
    placeholder: 'Filter tokens',
    'aria-label': 'Filter tokens',
  }) as HTMLInputElement
  const body = h('tbody', null)
  const scopes = data.tokens.scopes
  const rows = entries.map((t) => ({
    t,
    tr: h(
      'tr',
      null,
      h(
        'td',
        null,
        code(`$${t.path}`),
        t.description ? h('div', { class: 'docs-muted' }, t.description) : null,
      ),
      h('td', null, t.type, h('div', { class: 'docs-muted' }, t.tier)),
      ...scopes.map((s) => {
        const v = t.values[s]
        return h(
          'td',
          null,
          v ? specimen(t.type, v.resolved) : null,
          v ? code(shown(v.resolved)) : null,
          v?.alias ? h('div', { class: 'docs-muted' }, `→ ${v.alias}`) : null,
        )
      }),
    ),
  }))
  for (const r of rows) body.append(r.tr)
  filter.addEventListener('input', () => {
    const q = filter.value.toLowerCase()
    for (const r of rows)
      r.tr.hidden = q !== '' && !`${r.t.path} ${r.t.description ?? ''}`.toLowerCase().includes(q)
  })
  return h(
    'div',
    null,
    h('p', { class: 'docs-eyebrow' }, 'Tokens'),
    h('h1', null, group),
    h(
      'p',
      { class: 'docs-lead' },
      `${entries.length} tokens, each with its value in every theme after aliases are followed.`,
    ),
    h('div', { class: 'docs-tools' }, filter),
    h(
      'table',
      null,
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { scope: 'col' }, 'Token'),
          h('th', { scope: 'col' }, 'Type'),
          ...scopes.map((s) => h('th', { scope: 'col' }, s)),
        ),
      ),
      body,
    ),
  )
}

function contrastPage(): HTMLElement {
  const min = data.manifest.rules.contrastMinimum
  const rows = data.tokens.contrast
  return h(
    'div',
    null,
    h('p', { class: 'docs-eyebrow' }, 'Tokens'),
    h('h1', null, 'Contrast'),
    h(
      'p',
      { class: 'docs-lead' },
      `Text tokens on the background tokens they are used with, measured in each theme. The project requires ${min}:1.`,
    ),
    rows.length
      ? table(
          ['Text', 'Background', 'Theme', 'Ratio', ''],
          rows.map((r) => [
            code(`$${r.foreground}`),
            code(`$${r.background}`),
            r.scope,
            `${r.ratio}:1`,
            h(
              'span',
              { class: r.passes ? 'docs-pass' : 'docs-fail' },
              r.passes ? 'passes' : 'fails',
            ),
          ]),
        )
      : h('p', { class: 'docs-muted' }, 'No text and background token pairs were found.'),
  )
}

// --- routing ---------------------------------------------------------------------------------------------

function render() {
  const route = decodeURIComponent(location.hash.replace(/^#/, '') || '/')
  let page: HTMLElement
  const component = /^\/components\/(.+)$/.exec(route)
  const tokens = /^\/tokens\/(.+)$/.exec(route)
  const pageName =
    route === '/import'
      ? 'Bring in tokens'
      : route === '/changes'
        ? 'Changes'
        : route === '/export' && data.exports
          ? 'Export tokens'
          : undefined
  try {
    if (editing && route === '/import') page = importPage(afterSave)
    else if (editing && route === '/changes') page = changesPage()
    else if (route === '/export' && data.exports) page = exportPage(data.project.name, data.exports)
    else if (component) page = componentPage(component[1]!)
    else if (tokens) page = tokenPage(tokens[1]!)
    else page = overview()
  } catch (error) {
    page = h(
      'div',
      { class: 'docs-error', role: 'alert' },
      error instanceof Error ? error.message : String(error),
    )
  }
  const main = h('main', { class: 'docs-main', id: 'main' }, page)
  root.replaceChildren(
    h(
      'header',
      { class: 'docs-top' },
      h(
        'h1',
        null,
        h(
          'span',
          { class: 'docs-mark', 'aria-hidden': 'true' },
          h('span', null),
          h('span', null),
          h('span', null),
          h('span', null),
        ),
        `${data.project.name} docs`,
      ),
      switchers(),
    ),
    h('div', { class: 'docs-shell' }, nav(route), main),
  )
  if (editing) {
    editBar(() => setTimeout(() => location.reload(), 300)).then(
      (bar) => main.prepend(bar),
      () => {},
    )
  }
  document.title = `${pageName ?? (component ? component[1] : tokens ? tokens[1] : 'Overview')} – ${data.project.name} docs`
}

/** The changes page: what git says, and the button that proposes the manager's changes. */
function changesPage(): HTMLElement {
  const holder = h('div', null, h('h1', null, 'Changes'))
  gitPanel({ proposed: () => {} }).then(
    (panel) => holder.append(panel),
    (error) => holder.append(h('p', { class: 'docs-error-line', role: 'alert' }, String(error))),
  )
  return holder
}

// A theme that follows the system ($auto in the tokens) is how the docs start, so they follow it like the app does.
for (const t of data.manifest.tokens.themes) {
  const attribute = `data-${t.attribute}`
  if (t.auto && !document.documentElement.hasAttribute(attribute))
    document.documentElement.setAttribute(attribute, 'auto')
}

window.addEventListener('hashchange', render)
render()
