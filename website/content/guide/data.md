# Fetching data

Introduced in v0.6 (Milestones 27, 28 and 29).

`get` reads from a server, and `post`, `put`, `patch` and `del` write to it. There is nothing to set up and nothing to name: the request is the key.

```ts
import { get, post } from '@pixelscriptio/tessera/core'

const user = get('/users/:id', { id: 7 })

user.data.value // undefined, then the user
user.loading.value // true until the first answer
user.error.value // an ApiError if it failed

const add = post('/todos')
await add({ title: 'Buy milk' })
```

That is how it looks in any script. In a `.tess` file you do not import anything, and the template reads the results directly: see [In a `.tess` file](#in-a-tess-file). What makes it smarter than a fetch helper is that the compiler can check each call against a [description of your API](#describing-an-api-checked-calls). Prerendering the data comes later, and is listed [at the end](#what-is-not-built-yet).

## In a `.tess` file

`get`, `post`, `put`, `patch` and `del` need no import, like `state` and `derived`. A read or a write you keep in a `const` is known to the template, so its signals are unwrapped:

```xml tess
<contract>
{ "name": "TaskList", "role": "generic", "parts": ["root", "message", "list", "item", "reload"] }
</contract>

<script>
const tasks = get('/tasks')
</script>

<template>
  <div class="root">
    <p class="message" if="tasks.loading">Loading tasks...</p>
    <p class="message" else-if="tasks.error">Could not load the tasks: {tasks.error.message}</p>
    <ul class="list" else>
      <li class="item" each="task in tasks.data" key="task.id">{task.title}</li>
    </ul>
    <button class="reload" type="button" @click="tasks.refresh()">Reload</button>
  </div>
</template>
```

`tasks.data`, `tasks.error`, `tasks.loading` and `tasks.refreshing` are signals, and the template reads their values for you, the way it reads `count` for a `state(0)`. `tasks.refresh` is a function and is left alone. For a write, `add.pending`, `add.error` and `add.data` are the signals, and `add({ ... })` is the call.

You can also take a read apart, and each name is a signal as well:

```text
const { data: tasks, loading, error, refresh } = get('/tasks')
```

A type argument works (`get<Task[]>('/tasks')`). A read you hand to a function as a whole (`describe(tasks)`) is handed over as it is.

Only a call written as `get(...)`, `post(...)`, and so on is a read or a write. If the script defines its own `get`, or imports one, it is yours, and nothing here applies to it. `cache.get('x')` on a `Map` is not a read either: it is not one of Tessera's names.

### What to show: loading and error

A read is empty while its answer is on its way, and `error` is set when it fails. A page that shows the data and never shows either looks blank while it waits and says nothing when the server does not answer. So the compiler **warns** when a template shows the data of a read and does not show `loading` or `error` ([W4105](/reference/errors/W4105)):

```text
WARNING  W4105  app/pages/tasks.tess:3:15
  get('/tasks') can be slow and can fail, but this template never shows loading or error.
```

It is a warning, not an error: the page works. It is not raised when the template does not show the data (a button that only calls `refresh()`), or when the read is handed on as a whole, because what the receiver does with it is not known. To turn it off for a folder you are not ready to change, use a severity rule in `tessera.config.ts`, with a reason and an expiry like the style rules:

```ts
export default defineConfig({
  severity: [
    {
      files: 'app/pages/legacy/**',
      rules: 'W4105',
      level: 'off',
      reason: 'Moving to loading states in Q1',
      expires: '2027-03-31',
    },
  ],
})
```

Setting `level: 'error'` makes it an error, and then `tessera baseline` can record the ones that exist today so that only new ones fail.

## Several APIs: `app/apis`

Most apps call more than one server, and usually not their own. A script file in `app/apis` is an **API**, named after the file. It needs no import in a `.tess` file:

```ts
// app/apis/github.ts
import { createApi } from '@pixelscriptio/tessera/core'

export default createApi({
  base: 'https://api.github.com',
  headers: { accept: 'application/vnd.github+json' },
})
```

```text
<script>
const { data: user, loading, error } = github.get('/users/:name', { name: 'octocat' })
</script>
```

Each API has its own base URL, headers, retries and cache, with every option of [`configureApi`](#setting-it-up). The file name is the name: `weather.ts` is `weather`, and it must be a name a script can use ([T5005](/reference/errors/T5005)). Declaration files, tests (`github.test.ts`) and anything that is not a script (`github.api.json`, a README) are left out. A mistyped name is caught when it is close to an API that exists ([T5004](/reference/errors/T5004)):

```text
ERROR  T5004  app/pages/index.tess:3:14
  "gihub" is not an API.
  Did you mean "github"?
```

A file named `default.ts` is the API that plain `get`, `post`, `put`, `patch` and `del` use. With one, a script that calls `get('/tasks')` uses it, so an app with one server needs no name at all:

```ts
// app/apis/default.ts
import { createApi } from '@pixelscriptio/tessera/core'

export default createApi({ base: import.meta.env.VITE_API_URL })
```

Without a `default.ts`, plain `get` and the rest use the shared API that [`configureApi`](#setting-it-up) sets up, or a full URL in the path.

### Where an API's headers go

An API sends its `headers` and `credentials` only to its own origin: its base URL's, or the page's when there is no base. A path that is a full address on another site (`get(item.next)`) is sent without them, so a link in an answer cannot collect a token. A header named on the call itself is always sent. `allowOtherOrigins: true` sends them everywhere; use it only when every address is yours ([Security](/guide/security)). When `configure` changes the `headers`, `credentials` or `base` of an API, everything it remembers is forgotten, so a different person is not answered from the last one's memory. If your headers are a function that returns a new token by itself, call `clearApi()` when someone signs out.

### Keys and domains

The base URL and keys are best taken from environment variables, which Vite reads from `.env` files and from your host's build settings, so staging and production differ without code changes. Anything in a variable that starts with `VITE_` is in the built page, so **it is public**. A key that must stay private cannot be in a browser call at all, in any framework: it has to be added by a server. When the API you call needs a secret, or does not allow browsers to call it (CORS), put a small proxy that you control in front of it.

## Describing an API: checked calls

Next to an API file, a **description** says what the server has. It is a small JSON file named the same, `app/apis/github.api.json`, and with it the compiler checks every call on `github` before the app runs: that the endpoint exists, that the parameters are right, and that the fields a template reads are in the answer.

```json
{
  "base": "https://api.github.com",
  "types": {
    "User": { "login": "string", "name": "string | null", "followers": "number", "bio": "string?" }
  },
  "paths": {
    "/users/:name": {
      "get": { "returns": "User", "errors": { "404": "No such user" } }
    },
    "/users": {
      "get": { "query": { "since": "number?" }, "returns": "User[]" },
      "post": { "body": { "login": "string" }, "returns": "User" }
    }
  }
}
```

A mistake is an error with the fix suggested, in the editor, in `tessera check` and in the build:

```text
ERROR  T5006  app/pages/index.tess:2:14
  The description of "github" has no GET /user/:name.
  Did you mean "/users/:name"?

ERROR  T5008  app/pages/index.tess:7:21
  "user.logn" is not a field of User.
  Did you mean "login"?
```

**What it holds.**

| Key           | Meaning                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `base`        | The server's URL (the API file's `base` is what the app uses; this one is for documentation and tools).      |
| `description` | One line about the API.                                                                                      |
| `types`       | Named types, used by name below: `"Todo": { "id": "number", "title": "string" }`.                            |
| `paths`       | Each path, with `:name` for a part that varies, then each method: `get`, `post`, `put`, `patch` or `delete`. |

An endpoint has these keys, all optional: `query` (the parameters after the `?`), `body` (what a write sends), `returns` (the answer), `errors` (statuses that can go wrong, with a message) and `description`.

**Writing a type.** A type is a string, or an object of fields:

- `string`, `number`, `boolean`, `null`, `object` (any object) and `unknown` (anything; nothing is checked inside it).
- A name from `types`: `Todo`. A list: `Todo[]`.
- A choice: `'open' | 'done'` or `string | null`.
- An optional field has a `?` after its type (`"bio": "string?"`) or its name (`"bio?": "string"`).
- Objects can be written in place: `{ "id": "number", "owner": { "login": "string" } }`.

**What is checked.** A call on a described API is checked when its path is plain text (`github.get('/users/:name')`), and a parameter object is checked when it is written in the call (`{ name }`). A path built from a variable, a full URL, or an object that is a variable or a spread is left alone: the check only says what it knows. The fields are checked where a template reads them (`user.data.login`, or `each="u in users.data"` then `u.login`). In an API with no description nothing is checked, and a description does not change what is sent: it only lets the compiler help.

| Code                             | Meaning                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| [T5006](/reference/errors/T5006) | The endpoint is not in the description.                                  |
| [T5007](/reference/errors/T5007) | A parameter the endpoint does not take, or one it needs that is missing. |
| [T5008](/reference/errors/T5008) | A field the answer does not have.                                        |
| [T5009](/reference/errors/T5009) | The description itself is not valid.                                     |

### Making the description: `tessera api import`

Most APIs publish an OpenAPI file (a JSON file called `openapi.json` or `swagger.json`, often linked from their docs). Import it:

```text
tessera api import https://petstore3.swagger.io/api/v3/openapi.json --name pets
```

It writes `app/apis/pets.api.json`, and `app/apis/pets.ts` with the base URL if there is not one yet. Importing again later does not overwrite your description: it lists what changed (`breaking  POST /pets was removed`, `additive  GET /owners is new`) and replaces the file only with `--force`. What it cannot read, such as `oneOf`, becomes `unknown` and is listed. Only OpenAPI 3 in JSON is read: convert YAML or Swagger 2 first, which most API tools do in one step. The file is yours to edit, so you can also write a description by hand when the API has no OpenAPI file.

### For editors and AI tools

The compiler writes the types of every described API to `.tessera/apis.d.ts`, so TypeScript knows them too. The agent manifest (`.tessera/manifest.json`) lists each API with its endpoints, and the MCP server has two tools, `list_apis` and `get_endpoint`, that give an AI tool the exact path, parameters and answer type before it writes the call.

## Reading: `get`

`get(path, params?, options?)` returns a **resource**, which is four signals and a function:

| Name         | What it is                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------- |
| `data`       | The latest answer. Undefined until there is one, and it stays while a newer one is fetched. |
| `error`      | Why the latest try failed, as an `ApiError`. Cleared when one works.                        |
| `loading`    | Fetching, and there is nothing to show yet.                                                 |
| `refreshing` | Fetching, while the last answer is still shown.                                             |
| `refresh()`  | Ask again now. Resolves when it is done and never rejects: look at `error`.                 |

The difference between `loading` and `refreshing` is the point of having both. A spinner belongs to `loading`. When the data is only being checked, the page keeps showing it, and `refreshing` is there if you want a small hint.

A read starts when it is created. Created inside a component, it stops with the component.

### Parameters

A `:name` in the path takes its value from the params, and everything else in the params becomes the query string:

```ts
get('/users/:id/posts', { id: 7, page: 2, tags: ['a', 'b'] })
// /users/7/posts?page=2&tags=a&tags=b
```

Values are encoded, `undefined` and `null` are left out of the query, and the keys are sorted, so the same request is always the same URL.

A value can be a **signal**, and then the read follows it: when it changes the read fetches again, cancels the request it no longer needs and ignores a slow answer that arrives late. This is the whole of "refetch when something changes":

```ts
const id = state(1)
const user = get('/users/:id', { id })

id.value = 2 // fetches /users/2; the request for /users/1 is cancelled
```

The params can also be a function that returns the object, if you want to compute them:

```ts
get('/search', () => ({ q: query.value.trim(), page: page.value * 10 }))
```

### Waiting for a value

A `:name` that has no value yet (`undefined` or `null`) means there is nothing to ask for. The read stays idle, with no request, `loading` false and no data, and starts when the value arrives:

```ts
const selected = state<number | undefined>(undefined)
const details = get('/items/:id', { id: selected }) // nothing until something is selected
```

There is no `enabled: false` option. The parameter that is missing is the reason it is waiting.

## Sharing and freshness

Every read of the same URL shares one answer and one request. Ten components that show the same user make one request, and all ten update together.

An answer counts as **fresh** for 5 seconds (`staleAfter`). A new read of something fresh shows it at once and asks nothing. A new read of something older shows the old answer at once, asks again (`refreshing` is true) and updates when the new one arrives. This is the part that makes a page feel instant when you go back to it.

An answer is **kept** for 5 minutes (`keepFor`) after the last read that wanted it has gone, and a request that nothing is waiting for any more is cancelled.

Two more things keep data from going stale, both on by default:

- When the person comes back to the tab or the window, anything on screen that is old is asked again. Turn it off for one read with `refetchOnFocus: false`.
- `poll: 10_000` asks again every 10 seconds, while something is showing the read.

## Errors and retries

A reply that is not a success becomes an `ApiError`:

```ts
error.status // 404, or 0 if the server could not be reached
error.body // what the server sent: parsed if it was JSON, text if not
error.method // 'GET'
error.url // '/users/9'
```

A network failure and a server error (5xx, 408 or 429) are tried again, twice, after 300 ms and 600 ms. A 4xx is not: the request was wrong, and asking again will not change that. Change it with `retry: 5` or `retry: false`.

When asking again fails and there is an old answer, the old answer stays in `data` and `error` says what happened. The page keeps working, and can say that the data may be out of date.

## Writing: `post`, `put`, `patch`, `del`

A write is made once and called with what to send. It returns a function:

```ts
const save = put('/todos/:id')

await save({ id: 7, title: 'Buy oat milk', done: true })
// PUT /todos/7   with the body {"title":"Buy oat milk","done":true}
```

The same rule as for reads: a `:name` in the path takes its value from the object, and the rest of the object is the body, sent as JSON. If you pass an array, a string, `FormData`, a `Blob` or `URLSearchParams` instead of an object, it is the whole body. With nothing to send, there is no body:

```ts
const remove = del('/todos/:id')
await remove({ id: 7 }) // DELETE /todos/7
```

`del` is the one name that is not the verb, because `delete` is a reserved word.

The function that a write returns also says what is happening:

| Name      | What it is                                                  |
| --------- | ----------------------------------------------------------- |
| `pending` | True while any call is running.                             |
| `error`   | Why the last call failed. Cleared when the next one starts. |
| `data`    | The answer of the last call that worked.                    |
| `reset()` | Forget `data` and `error`.                                  |

A call resolves with the answer and rejects with an `ApiError`. You do not have to handle the rejection: a failure is in `error`, and ignoring the promise does not cause an unhandled rejection. Await it when the next step depends on it:

```ts
async function submit() {
  try {
    await add({ title })
    title.value = ''
  } catch {
    // add.error.value has the reason, and the form can show it
  }
}
```

A write is **not retried** unless you ask (`retry: 2`), because repeating a write is not always safe.

### What a write refreshes

After a write works, the reads it affects ask again, and you write nothing for it. A write affects the reads whose path is **under or over** the path that was written:

| After...       | These ask again                           | These do not         |
| -------------- | ----------------------------------------- | -------------------- |
| `PUT /todos/1` | `/todos`, `/todos/1`, `/todos/1/comments` | `/todos/2`, `/users` |
| `POST /todos`  | `/todos`, `/todos/1`, `/todos/2`          | `/users`             |

A read that something is showing asks at once. One that nothing is showing is marked old, and asks the next time it is used. If a read is in the middle of a request when the write finishes, it asks once more when that one is done, so the page never ends up showing the answer from before the write.

When a write changes something elsewhere, name it:

```ts
const add = post('/todos', { invalidates: ['/stats'] })
```

`invalidates: false` turns it off. `invalidate('/todos')` does the same thing by hand, and `clearApi()` forgets everything.

## Setting it up

Without any set-up, paths are used as they are. To set a base URL, headers or your own `fetch` for the shared API (the one plain `get` and `post` use when there is no `app/apis/default.ts`), once, at the start of the app:

```ts
import { configureApi } from '@pixelscriptio/tessera/core'

configureApi({
  base: '/api',
  headers: () => ({ authorization: `Bearer ${session.token}` }), // may be async
  credentials: 'include',
})
```

| Option        | What it does                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `base`        | In front of every path that is not a full URL.                                                   |
| `headers`     | An object, or a function (it may be async) that is asked before each request.                    |
| `credentials` | Passed to `fetch`.                                                                               |
| `fetch`       | Your own `fetch`. Wrap it to add what every request needs: a token refresh, logging, a trace id. |
| `staleAfter`  | How long an answer is fresh, in ms. Default 5000.                                                |
| `keepFor`     | How long an answer is kept once nothing wants it, in ms. Default 5 minutes.                      |
| `retryDelay`  | `(attempt) => ms`. Default 300 ms, doubling.                                                     |

A full URL (`https://other.example.com/x`) ignores the base.

### One request at a time, differently

Each read and write takes options for itself:

| Option           | For    | What it does                                                                      |
| ---------------- | ------ | --------------------------------------------------------------------------------- |
| `retry`          | both   | A number of retries, or `false`. Reads default to 2, writes to `false`.           |
| `headers`        | both   | Added to the headers of this request.                                             |
| `parse`          | both   | `(response) => data`. Default: JSON, or text if it is not JSON, nothing if empty. |
| `poll`           | reads  | Ask again this often, in ms, while something shows it.                            |
| `staleAfter`     | reads  | This read's own idea of fresh.                                                    |
| `refetchOnFocus` | reads  | Default true.                                                                     |
| `invalidates`    | writes | More paths to refresh, or `false` for none.                                       |

```ts
get('/report.csv', {}, { parse: async (res) => (await res.text()).split('\n') })
post('/jobs', { retry: 2 })
```

Options go third for a read (second is its params) and second for a write (its params are what you pass when you call it).

## In tests

Your own `fetch` is also the way to test: make an api with a `fetch` that answers from a function, with no server and no mocking library.

```ts
import { createApi } from '@pixelscriptio/tessera/core'

const api = createApi({
  fetch: async (url) =>
    new Response(JSON.stringify({ name: 'Ada' }), {
      headers: { 'content-type': 'application/json' },
    }),
})
const user = api.get('/users/1')
```

`createApi(options)` gives an api that has its own memory of what it fetched, so tests do not share answers. The functions the app uses (`get`, `post`...) are one of these, made for you.

## What is not built yet

- **Optimistic updates**: showing the result of a write before the server has answered.
- **Data for a page**: starting the fetch when you navigate, and prerendering a page with its data in it. For now a read that runs while a page is prerendered has no base to use for a relative path.
- **Checking the body of a write** against the description, and development mocks made from it.
- **Loading and error states** in the docs app and the accessibility tests.
- **Pagination and infinite lists, GraphQL and WebSockets.** `parse` and your own `fetch` cover a lot of GraphQL today.

The plan for all of these is in the [roadmap](/releases/roadmap).

## Why it looks like this

- **No keys.** Other tools make you write a key for every query (`['user', id]`) and keep them in step by hand. The path and the params already say what a request is.
- **Signals in, signals out.** Params that are signals make a read follow them, and a read's results are signals. There is no second kind of state to learn, no provider and no stream library.
- **A missing value waits.** That replaces a flag for turning a read on and off.
- **Writes refresh what they affect.** The rule is the path, which you already wrote.
- **`loading` is not `refreshing`.** Showing a spinner over data you already have is the most common reason a page feels slow.
