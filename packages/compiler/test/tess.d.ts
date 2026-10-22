declare module '*.tess' {
  import type { Component } from '@tessera/core'
  const component: Component
  export default component
}
declare module '*.tess?raw' {
  const source: string
  export default source
}
