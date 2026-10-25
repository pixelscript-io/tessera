import { createApi } from '@pixelscriptio/tessera/core'

/** A server of tasks. Every `.tess` file can use it as `backend`, without importing it. */
export default createApi({ base: 'https://example.com/api' })
