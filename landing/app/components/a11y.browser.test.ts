/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { defineA11ySuites } from '@pixelscriptio/tessera/a11y'
import { CODE_TABS, PANES } from '../data/code'

// Every component in this folder that has a contract gets accessibility tests generated from it. Adding a
// component adds its tests; there is nothing to register.
defineA11ySuites({
  components: import.meta.glob('./*.tess', { eager: true, import: 'default' }),
  sources: import.meta.glob('./*.tess', { query: '?raw', eager: true, import: 'default' }),
  // Components that are given what they show by their parent, as a page gives it.
  fixtures: { CodeTabs: { props: { tabs: CODE_TABS, panes: PANES } } },
})
