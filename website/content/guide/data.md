# Fetching data

Introduced in v0.6 (Milestone 27).

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

This is the runtime. It works in any script today, and `.tess` files will get `get`, `post` and the rest without imports in the next milestone, with their results unwrapped in templates like any other signal. Until then, import them as above. The things that make it smarter than a fetch helper (checking endpoints against your API description at compile time, prerendering the data) come in the milestones after that, and are listed [at the end](#what-is-not-built-yet).

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

Without any set-up, paths are used as they are. To set a base URL, headers or your own `fetch`, once, at the start of the app:

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

- **In `.tess` files**: `get` and the others without imports, and results unwrapped in templates (the next milestone).
- **A description of your API**: checking at compile time that the endpoint exists, that its parameters are right and that the fields you read are in the response, with a suggestion when they are not; types from it; the endpoints in the manifest for AI tools.
- **A warning for a template that fetches but never handles the loading and error states.**
- **Optimistic updates**: showing the result of a write before the server has answered.
- **Data for a page**: starting the fetch when you navigate, and prerendering a page with its data in it. For now a read that runs while a page is prerendered has no base to use for a relative path.
- **Development mocks** from the description, and loading and error states in the docs app and the accessibility tests.
- **Pagination and infinite lists, GraphQL and WebSockets.** `parse` and your own `fetch` cover a lot of GraphQL today.

The plan for all of these is in the [roadmap](/releases/roadmap).

## Why it looks like this

- **No keys.** Other tools make you write a key for every query (`['user', id]`) and keep them in step by hand. The path and the params already say what a request is.
- **Signals in, signals out.** Params that are signals make a read follow them, and a read's results are signals. There is no second kind of state to learn, no provider and no stream library.
- **A missing value waits.** That replaces a flag for turning a read on and off.
- **Writes refresh what they affect.** The rule is the path, which you already wrote.
- **`loading` is not `refreshing`.** Showing a spinner over data you already have is the most common reason a page feels slow.
