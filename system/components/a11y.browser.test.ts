/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { defineA11ySuites } from '@tessera/a11y'

// Every component in this folder gets accessibility tests generated from its contract. Adding a component
// adds its tests; there is nothing to register.
defineA11ySuites({
  components: import.meta.glob('./*.tess', { eager: true, import: 'default' }),
  sources: import.meta.glob('./*.tess', { query: '?raw', eager: true, import: 'default' }),
})
