import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import './tokens.css'
import './tessera.css'

/** The site's light and dark switch is VitePress's `.dark` class; Tessera's themes are `data-theme`. Keep them in step. */
function syncTheme() {
  const root = document.documentElement
  if (root.classList.contains('dark')) root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')
}

export default {
  extends: DefaultTheme,
  enhanceApp() {
    if (typeof document === 'undefined') return
    syncTheme()
    new MutationObserver(syncTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
  },
} satisfies Theme
