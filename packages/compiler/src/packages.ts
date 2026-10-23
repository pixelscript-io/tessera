/**
 * The import specifiers users see. The framework is published as one package, `@pixelscriptio/tessera`, with a
 * subpath per part; the `@tessera/*` packages in this repository are internal and bundled into it. Everything
 * the compiler writes into a user's code, or tells a user to import, comes from here.
 */
export const PUBLIC_PACKAGES = {
  core: '@pixelscriptio/tessera/core',
  router: '@pixelscriptio/tessera/router',
  behavior: '@pixelscriptio/tessera/behavior',
  tokens: '@pixelscriptio/tessera/tokens',
} as const
