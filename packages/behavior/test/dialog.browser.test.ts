import { userEvent } from '@vitest/browser/context'
import { afterEach, describe, expect, it } from 'vitest'
import { createDomAdapter } from '@tessera/core'
import { attachDialog } from '../src'
import { dialogConformance, domDialogHarness } from '../src/conformance'

const adapter = createDomAdapter(document)
let cleanups: Array<() => void> = []

afterEach(() => {
  for (const c of cleanups) c()
  cleanups = []
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('style')
})

/** An opener, and a `<dialog>` with a name and two buttons, as the Dialog component makes one. */
function page() {
  const opener = document.createElement('button')
  opener.textContent = 'Open'
  const dialog = document.createElement('dialog')
  dialog.setAttribute('aria-labelledby', 'title')
  dialog.style.padding = '0'
  const panel = document.createElement('div')
  panel.style.cssText = 'padding: 24px; width: 300px;'
  panel.innerHTML = '<h2 id="title">Title</h2><button>One</button><button>Two</button>'
  dialog.append(panel)
  document.body.append(opener, dialog)
  return { opener, dialog }
}

describe('dialog conformance: a native <dialog> that follows data-open', () => {
  for (const testCase of dialogConformance) {
    it(testCase.name, async () => {
      const { opener, dialog } = page()
      const dismissals: Array<{ reason: string }> = []
      cleanups.push(
        attachDialog(adapter, dialog, {
          onDismiss: (detail) => {
            dismissals.push({ reason: detail.reason })
            // What a component does: its state moves, and the attribute follows.
            dialog.removeAttribute('data-open')
          },
        }),
      )
      const harness = domDialogHarness(dialog, opener, userEvent, {
        dismissals,
        setOpen: (open) => {
          if (open) dialog.setAttribute('data-open', 'true')
          else dialog.removeAttribute('data-open')
        },
      })
      await testCase.run(harness)
    })
  }
})

describe('what dialog does that the conformance suite does not say', () => {
  it('opens at once when it is attached to a dialog that already says it is open', async () => {
    const { dialog } = page()
    dialog.setAttribute('data-open', 'true')
    cleanups.push(attachDialog(adapter, dialog, { onDismiss() {} }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(dialog.open).toBe(true)
  })

  it('stays open when dismissed if its owner does not let it close', async () => {
    const { dialog } = page()
    const dismissals: string[] = []
    dialog.setAttribute('data-open', 'true')
    cleanups.push(attachDialog(adapter, dialog, { onDismiss: (d) => dismissals.push(d.reason) }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    await userEvent.keyboard('{Escape}')
    expect(dismissals).toEqual(['escape'])
    expect(dialog.open).toBe(true)
  })

  it('shares one scroll lock between dialogs, and the page unlocks when the last closes', async () => {
    const a = page()
    const b = page()
    cleanups.push(attachDialog(adapter, a.dialog, { onDismiss() {} }))
    cleanups.push(attachDialog(adapter, b.dialog, { onDismiss() {} }))
    a.dialog.setAttribute('data-open', 'true')
    await new Promise((resolve) => setTimeout(resolve, 30))
    b.dialog.setAttribute('data-open', 'true')
    await new Promise((resolve) => setTimeout(resolve, 30))
    a.dialog.removeAttribute('data-open')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(getComputedStyle(document.documentElement).overflow).toBe('hidden')
    b.dialog.removeAttribute('data-open')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(getComputedStyle(document.documentElement).overflow).not.toBe('hidden')
  })

  it('closes and unlocks when it is detached while open', async () => {
    const { dialog } = page()
    dialog.setAttribute('data-open', 'true')
    const detach = attachDialog(adapter, dialog, { onDismiss() {} })
    await new Promise((resolve) => setTimeout(resolve, 30))
    detach()
    expect(dialog.open).toBe(false)
    expect(getComputedStyle(document.documentElement).overflow).not.toBe('hidden')
  })

  it('reports a close the browser made by itself, so the owner can follow', async () => {
    const { dialog } = page()
    const dismissals: string[] = []
    dialog.setAttribute('data-open', 'true')
    cleanups.push(attachDialog(adapter, dialog, { onDismiss: (d) => dismissals.push(d.reason) }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    dialog.close()
    // The browser reports a close in a task of its own.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(dismissals).toEqual(['native'])
  })
})
