declare module 'virtual:tessera-docs/data' {
  // Typed as DocsData where it is read; an ambient module cannot import by a relative path.
  const data: unknown
  export default data
}

declare module 'virtual:tessera-docs/components' {
  export const components: Record<string, () => Promise<{ default: (input?: any) => any }>>
  export const live: Record<string, () => Promise<{ default: (input?: any) => any }>>
}

declare module 'virtual:tessera-docs/runtime' {
  export {
    state,
    createRoot,
    previewComponents,
    previewSlots,
    type PreviewContent,
  } from '@tessera/core'
}
