// The script of the Tessera UI pages. It is bundled by `live.ts` with the examples; it runs in the reader's browser.
// Everything here is an addition to pages that already read without it: the previews, the copy buttons, the theme
// button, the search and the folded menu. With no script the pages are complete.

type Example = () => Promise<{ default: () => Node }>

const THEME_KEY = 'tessera-ui-theme'
const THEMES = ['auto', 'light', 'dark'] as const
type Theme = (typeof THEMES)[number]

function note(slot: Element, message: string): void {
  const p = document.createElement('p')
  p.className = 'nojs'
  p.textContent = message
  slot.replaceChildren(p)
}

function previews(
  examples: Record<string, Example>,
  createRoot: (fn: () => void) => unknown,
): void {
  for (const slot of document.querySelectorAll<HTMLElement>('[data-live]')) {
    const load = examples[slot.dataset.live ?? '']
    if (!load) continue
    load()
      .then((mod) => createRoot(() => slot.replaceChildren(mod.default())))
      .catch((error: unknown) =>
        note(
          slot,
          'This preview could not run: ' + (error instanceof Error ? error.message : String(error)),
        ),
      )
  }
}

function copyButtons(): void {
  for (const block of document.querySelectorAll('figure.code')) {
    const pre = block.querySelector('pre')
    if (!pre) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy'
    button.textContent = 'Copy'
    button.addEventListener('click', () => {
      navigator.clipboard.writeText(pre.textContent ?? '').then(
        () => {
          button.textContent = 'Copied'
          setTimeout(() => (button.textContent = 'Copy'), 1500)
        },
        () => (button.textContent = 'Press Ctrl+C'),
      )
    })
    block.append(button)
  }
}

function currentTheme(): Theme {
  const set = document.documentElement.getAttribute('data-theme')
  return set === 'light' || set === 'dark' ? set : 'auto'
}

/** The theme button: auto (the system's scheme), then light, then dark. The choice is kept; auto keeps nothing. */
function themeButton(): void {
  const button = document.querySelector<HTMLButtonElement>('button.theme')
  if (!button) return
  const show = (theme: Theme) => {
    button.textContent = 'Theme: ' + theme[0]!.toUpperCase() + theme.slice(1)
    button.setAttribute('aria-label', `Theme: ${theme}. Change it.`)
  }
  show(currentTheme())
  button.hidden = false
  button.addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]!
    document.documentElement.setAttribute('data-theme', next)
    try {
      if (next === 'auto') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, next)
    } catch {
      // No storage: the choice lasts until the page is closed.
    }
    show(next)
  })
}

interface Entry {
  title: string
  description: string
  url: string
  section: string
  keywords?: string
}

/** Rank an entry for what was typed: a title that starts with it, then one that has it, then the words, then the description. */
function score(entry: Entry, words: string[]): number {
  const title = entry.title.toLowerCase()
  const keywords = (entry.keywords ?? '').toLowerCase()
  const description = entry.description.toLowerCase()
  let total = 0
  for (const word of words) {
    if (title.startsWith(word)) total += 100
    else if (title.includes(word)) total += 60
    else if (keywords.split(' ').some((k) => k === word)) total += 30
    else if (keywords.includes(word)) total += 15
    else if (description.includes(word)) total += 8
    else return 0
  }
  return total
}

/** The search: a dialog with a box and the pages that match, found by the name or by a word of the contract. */
function search(): void {
  const open = document.querySelector<HTMLButtonElement>('button.search')
  if (!open) return
  open.hidden = false
  let dialog: HTMLDialogElement | undefined
  let entries: Entry[] | undefined
  let input: HTMLInputElement
  let results: HTMLUListElement
  let status: HTMLParagraphElement

  const render = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean)
    const found = words.length
      ? (entries ?? [])
          .map((entry) => ({ entry, score: score(entry, words) }))
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
          .slice(0, 12)
          .map((m) => m.entry)
      : (entries ?? []).filter((e) => e.section === 'Get started')
    results.replaceChildren(
      ...found.map((entry) => {
        const li = document.createElement('li')
        const a = document.createElement('a')
        a.href = entry.url
        a.textContent = entry.title
        const small = document.createElement('small')
        small.textContent = `${entry.section}: ${entry.description}`
        a.append(small)
        li.append(a)
        return li
      }),
    )
    status.textContent = words.length
      ? found.length
        ? `${found.length} ${found.length === 1 ? 'result' : 'results'}`
        : 'No results'
      : ''
  }

  const build = () => {
    dialog = document.createElement('dialog')
    dialog.className = 'search-dialog'
    dialog.setAttribute('aria-label', 'Search the docs')
    input = document.createElement('input')
    input.type = 'search'
    input.placeholder = 'Search components and pages'
    input.setAttribute('aria-label', 'Search')
    input.autocomplete = 'off'
    status = document.createElement('p')
    status.className = 'status'
    status.setAttribute('role', 'status')
    results = document.createElement('ul')
    dialog.append(input, status, results)
    document.body.append(dialog)
    input.addEventListener('input', render)
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog!.close()
    })
    // Down moves from the box into the results and between them; Up goes back; Enter in the box takes the first.
    dialog.addEventListener('keydown', (event) => {
      const links = [...results.querySelectorAll('a')]
      const at = links.indexOf(document.activeElement as HTMLAnchorElement)
      // A search box clears itself on Escape and leaves the dialog open: here Escape always closes it.
      if (event.key === 'Escape') {
        event.preventDefault()
        dialog!.close()
      } else if (event.key === 'ArrowDown' && links.length) {
        event.preventDefault()
        links[Math.min(at + 1, links.length - 1)]!.focus()
      } else if (event.key === 'ArrowUp' && at >= 0) {
        event.preventDefault()
        if (at === 0) input.focus()
        else links[at - 1]!.focus()
      } else if (event.key === 'Enter' && document.activeElement === input && links[0]) {
        event.preventDefault()
        links[0].click()
      }
    })
  }

  const show = async () => {
    if (!dialog) build()
    if (!entries) {
      try {
        entries = (await (await fetch('/search.json')).json()) as Entry[]
      } catch {
        entries = []
      }
    }
    if (!dialog!.open) dialog!.showModal()
    input.value = ''
    render()
    input.focus()
  }

  open.addEventListener('click', () => void show())
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null
    const typing =
      !!target && (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable)
    if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || (event.key === '/' && !typing)) {
      event.preventDefault()
      void show()
    }
  })
}

/** The menu is open for a reader with no script. On a phone it starts folded away. */
function foldMenu(): void {
  const menu = document.querySelector('details.menu')
  if (menu && window.matchMedia('(max-width: 860px)').matches) menu.removeAttribute('open')
}

export function start(
  examples: Record<string, Example>,
  createRoot: (fn: () => void) => unknown,
): void {
  previews(examples, createRoot)
  copyButtons()
  themeButton()
  search()
  foldMenu()
}
