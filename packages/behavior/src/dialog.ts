import type { RendererAdapter } from '@tessera/core'

/** What a `dismiss` event carries. */
export interface DismissDetail {
  /** Why the person asked to close it: the Escape key, a click outside the panel, or the browser closing it itself. */
  reason: 'escape' | 'backdrop' | 'native'
  /** The DOM event that caused it. */
  event: unknown
}

export interface DialogOptions {
  onDismiss: (detail: DismissDetail) => void
  /** Accepted for the compiler's uniform call. A dialog is always a native `<dialog>`. */
  native?: boolean
  role?: string
}

/** What can take focus inside a dialog. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** How many dialogs have the page's scroll locked. The page unlocks when the last one closes. */
const locks = new WeakMap<Document, { count: number; overflow: string; padding: string }>()

function lockScroll(doc: Document): void {
  const held = locks.get(doc)
  if (held) {
    held.count++
    return
  }
  const root = doc.documentElement
  const view = doc.defaultView
  // Hiding the scrollbar makes the page wider, so the width it took is added back as padding and nothing jumps.
  const scrollbar = view ? view.innerWidth - root.clientWidth : 0
  locks.set(doc, { count: 1, overflow: root.style.overflow, padding: root.style.paddingRight })
  root.style.overflow = 'hidden'
  if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`
}

function unlockScroll(doc: Document): void {
  const held = locks.get(doc)
  if (!held) return
  held.count--
  if (held.count > 0) return
  locks.delete(doc)
  doc.documentElement.style.overflow = held.overflow
  doc.documentElement.style.paddingRight = held.padding
}

/**
 * Dialog: a modal dialog on a native `<dialog>` element.
 *
 * The browser does the hard parts of a modal: `showModal()` makes everything behind it inert, keeps focus inside, moves
 * focus in, and gives it back to what opened it on close. The behavior adds what it does not:
 *
 * - **It follows `data-open`.** The component owns whether it is open and binds `data-open="true"` to its state; the
 *   behavior shows the dialog modally when that is set and closes it when it is removed.
 * - **Dismissing is a request.** Escape (the browser's `cancel`), a click outside the panel and the browser closing the
 *   dialog by itself are reported as `dismiss` with a reason, and the dialog stays as it is until the component moves
 *   its state. A component that wants to confirm first can refuse.
 * - **Tab stays inside.** Tab on the last control goes to the first, and Shift+Tab on the first goes to the last, so focus
 *   cannot leave through the browser's own controls.
 * - **The page does not scroll behind it**, and the scrollbar's width is kept so nothing shifts. Nested dialogs share one lock.
 *
 * Returns a function that removes everything it added and closes the dialog.
 */
export function attachDialog<N, E extends N>(
  adapter: RendererAdapter<N, E>,
  el: E,
  options: DialogOptions,
): () => void {
  const dialog = el as unknown as HTMLDialogElement
  let locked = false

  const sync = () => {
    // Before the element is in the page it cannot be shown. It is tried again once it is.
    if (!dialog.isConnected) return
    const wanted = adapter.getAttribute(el, 'data-open') === 'true'
    if (wanted && !dialog.open) {
      dialog.showModal()
      if (!locked) {
        lockScroll(dialog.ownerDocument)
        locked = true
      }
    } else if (!wanted && dialog.open) {
      dialog.close()
    }
    if (!wanted && locked) {
      unlockScroll(dialog.ownerDocument)
      locked = false
    }
  }

  const onCancel = (event: { preventDefault(): void }) => {
    // The component decides whether it closes; the browser must not close it behind the component's back.
    event.preventDefault()
    options.onDismiss({ reason: 'escape', event })
  }

  const onClick = (event: { target: unknown; clientX: number; clientY: number }) => {
    // A click on the backdrop is reported with the dialog itself as its target, at a point outside its box.
    if (event.target !== dialog) return
    const box = dialog.getBoundingClientRect()
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    if (outside) options.onDismiss({ reason: 'backdrop', event })
  }

  // A modal dialog keeps the page behind it inert but lets Tab leave through the browser's own controls. Tab and
  // Shift+Tab wrap inside instead.
  const onKeydown = (event: { key?: string; shiftKey?: boolean; preventDefault(): void }) => {
    if (event.key !== 'Tab' || !dialog.open) return
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (item) => item.getClientRects().length > 0,
    )
    const current = dialog.ownerDocument.activeElement
    if (!items.length) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const first = items[0]!
    const last = items[items.length - 1]!
    if (event.shiftKey && (current === first || current === dialog)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && current === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const onClose = (event: unknown) => {
    // Closed by something else (a form with `method="dialog"`): tell the component, so its state follows.
    if (adapter.getAttribute(el, 'data-open') === 'true')
      options.onDismiss({ reason: 'native', event })
  }

  adapter.addListener(el, 'cancel', onCancel)
  adapter.addListener(el, 'click', onClick)
  adapter.addListener(el, 'keydown', onKeydown)
  adapter.addListener(el, 'close', onClose)
  const stop = adapter.observeAttribute?.(el, 'data-open', sync)
  sync()
  // The element may not be in the page yet when this runs; the next microtask is after it is inserted.
  queueMicrotask(sync)

  return () => {
    stop?.()
    adapter.removeListener(el, 'cancel', onCancel)
    adapter.removeListener(el, 'click', onClick)
    adapter.removeListener(el, 'keydown', onKeydown)
    adapter.removeListener(el, 'close', onClose)
    if (dialog.open) dialog.close()
    if (locked) {
      unlockScroll(dialog.ownerDocument)
      locked = false
    }
  }
}
