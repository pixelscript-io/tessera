/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { defineA11ySuites } from '@tessera/a11y'

// A list to choose from, for the components that need one. The first two share their opening letters ("ap"),
// which the combobox conformance types to narrow the list.
const options = [
  { value: 'apple', label: 'Apple' },
  { value: 'apricot', label: 'Apricot' },
  { value: 'banana', label: 'Banana' },
  { value: 'blueberry', label: 'Blueberry' },
]

// Every component in this folder gets accessibility tests generated from its contract. Adding a component
// adds its tests; there is nothing to register, except what a component needs to be shown with.
defineA11ySuites({
  components: import.meta.glob('./*.tess', { eager: true, import: 'default' }),
  sources: import.meta.glob('./*.tess', { query: '?raw', eager: true, import: 'default' }),
  fixtures: {
    Combobox: { props: { options } },
    Select: { props: { options } },
  },
})
