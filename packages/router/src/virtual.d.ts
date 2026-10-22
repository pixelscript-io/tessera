declare module 'virtual:tessera/routes' {
  import type { LayoutModule, RouteDefinition, PageModule } from './router'
  export const routes: RouteDefinition[]
  export const layouts: Record<string, () => Promise<LayoutModule>>
  export const notFound: (() => Promise<PageModule>) | undefined
}
