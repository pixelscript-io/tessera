// There are no design tokens yet, so there is no token CSS to load. When you add some (see system/README.md),
// uncomment this line to load them:
// import 'virtual:tessera/tokens.css'
import { createApp } from '@pixelscriptio/tessera/router/app'

// Switching themes (once you have a theme file) is one call:
// import { setTheme } from '@pixelscriptio/tessera/tokens'
// setTheme('dark')

createApp().mount('#app')
