import { routes, notFound, layouts } from 'virtual:tessera/routes'
import { createRouter, type RouterOptions } from './router'

export interface App {
  /** Show the app in an element or a selector. Resolves once the first page is on screen. */
  mount(target: string | Element): Promise<() => void>
}

/**
 * The app: the pages of `app/pages`, routed by the History API. This is all `app/main.ts` needs:
 * `createApp().mount('#app')`. The routes come from the build (the \`virtual:tessera/routes\` module).
 */
export function createApp(options: Partial<RouterOptions> = {}): App {
  const router = createRouter({ routes, notFound, layouts, ...options })
  return {
    async mount(target) {
      const element = typeof target === 'string' ? document.querySelector(target) : target
      if (!element) throw new Error(`createApp().mount(): no element matches "${String(target)}".`)
      return router.mount(element)
    },
  }
}
