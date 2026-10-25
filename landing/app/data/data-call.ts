import { highlight, type CodePane } from './code'

/** What the "Data" section shows: a call, the file that says where the server is, and what the compiler says about a mistake. */

export type DataTabId = 'call' | 'api' | 'check'

export const DATA_TABS: ReadonlyArray<{ id: DataTabId; label: string }> = [
  { id: 'call', label: 'profile.tess' },
  { id: 'api', label: 'app/apis/github.ts' },
  { id: 'check', label: 'tessera check' },
]

const SNIPPETS: Record<DataTabId, string[]> = {
  call: [
    `<script>
const user = github.get("/users/:name", {
  name: "octocat",
})
</script>

<template>
  <p if="user.loading">Loading...</p>
  <p else-if="user.error">{user.error.message}</p>
  <p else>{user.data.login}</p>
</template>`,
    `// No import, no key, no provider.
//
// user.loading  true until the first answer
// user.data     the user; follows the name if it changes
// user.error    an ApiError, with the status
//
// The same path and params are one request,
// shared by every page that asks.`,
  ],
  api: [
    `// app/apis/github.ts
import { createApi } from "@pixelscriptio/tessera/core"

export default createApi({
  base: "https://api.github.com",
})`,
    `// app/apis/github.api.json
// Optional. Made by: tessera api import openapi.json
{
  "types": { "User": { "login": "string" } },
  "paths": {
    "/users/:name": { "get": { "returns": "User" } }
  }
}`,
  ],
  check: [
    `$ npx tessera check

ERROR  T5006  app/pages/profile.tess:2:14
  The description of "github" has no GET /user/:name.
  Did you mean "/users/:name"?`,
    `ERROR  T5008  app/pages/profile.tess:9:21
  "user.data.logn" is not a field of User.
  Did you mean "login"?`,
  ],
}

export const DATA_PANES: Record<DataTabId, CodePane[]> = Object.fromEntries(
  Object.entries(SNIPPETS).map(([id, panes]) => [
    id,
    panes.map((source) => ({ lines: source.split('\n').map(highlight) })),
  ]),
) as Record<DataTabId, CodePane[]>

export const DATA_NOTES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Loading and errors, handled',
    body: 'Each call gives you loading, error and refreshing. Forget one and the compiler warns you.',
  },
  {
    title: 'Fast by default',
    body: 'Answers are cached and shared, retried when the network drops, and refreshed after a write.',
  },
  {
    title: 'Checked at compile time',
    body: 'Describe an API once, or import its OpenAPI file, and a wrong path, parameter or field is an error with the fix.',
  },
]
