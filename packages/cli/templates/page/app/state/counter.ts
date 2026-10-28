import { state } from '@pixelscriptio/tessera/core'

// Shared state: every .tess file can use this one as `counter`, with no import and no provider.
// Read it in a template as {counter.count}, call it as counter.bump(). More state: one file per topic in app/state.
export const count = state(0)

export function bump() {
  count.value++
}
