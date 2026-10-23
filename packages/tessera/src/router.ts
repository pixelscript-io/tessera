export * from '@tessera/router'

// `RouteTypes` is declared here, not re-exported, because TypeScript merges a module augmentation only into the
// module that declares the interface. A project's generated `.tessera/routes.d.ts` augments this module, so
// `RoutePattern` lists the project's real routes. These two declarations replace the ones `export *` brings.

/**
 * The app's routes by pattern, with their parameters. Empty here; the build fills it in
 * (`.tessera/routes.d.ts`) so `RoutePattern` lists the real routes.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RouteTypes {}

/** One of the app's route patterns, such as `/blog/:slug`; any string until the build has generated them. */
export type RoutePattern = keyof RouteTypes extends never
  ? string
  : Extract<keyof RouteTypes, string>
