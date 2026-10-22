import { defineConfig } from 'vite'
import { tessera } from '@tessera/compiler/vite'

export default defineConfig({ plugins: [tessera()] })
