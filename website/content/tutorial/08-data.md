# 8. Data from an API

Most pages show something that lives on a server. A new project already does: open `app/pages/index.tess` and find the line

```text
const users = get('/users')
```

That is the whole request. `get` needs no import, and `app/apis/default.ts` says which server it asks (`https://jsonplaceholder.typicode.com`, a free test API). Here is a page of your own that does the same:

```xml tess kind=page
<page>
{ "title": "Users" }
</page>

<script>
const users = get('/users')
</script>

<template>
  <main>
    <h1>Users</h1>
    <p if="users.loading">Loading...</p>
    <p else-if="users.error">Could not load the users: {users.error.message}</p>
    <ul else>
      <li each="user in users.data" key="user.id">{user.name}</li>
    </ul>
  </main>
</template>
```

Save it as `app/pages/users.tess` and open `/users`. The page shows at once with "Loading...", then the list. If the request fails, the message is shown, and `users.refresh()` asks again. Leave out the `loading` and `error` branches and the compiler warns you ([W4105](/reference/errors/W4105)) that a visitor would see an empty page while it loads, or with no explanation when it fails.

## Use a different server

Each file in `app/apis` is an API, named after the file. Add `app/apis/github.ts`:

```ts
import { createApi } from '@pixelscriptio/tessera/core'

export default createApi({ base: 'https://api.github.com' })
```

and call it by that name, with the parts of the path that vary as `:name`:

```text
<script>
const profile = github.get('/users/:name', { name: 'octocat' })
</script>

<template>
  <main>
    <p if="profile.data">{profile.data.login} has {profile.data.followers} followers.</p>
    <p else-if="profile.error">{profile.error.message}</p>
    <p else>Loading...</p>
  </main>
</template>
```

## Let the compiler check the calls

Next to the API file, a description says what the server has. Save this as `app/apis/github.api.json`:

```json
{
  "types": {
    "User": { "login": "string", "followers": "number" }
  },
  "paths": {
    "/users/:name": { "get": { "returns": "User" } }
  }
}
```

Now a mistyped path, a missing parameter or a field the server does not send is an error with a suggestion, before the page runs. Change `profile.data.login` to `profile.data.logn` and run `npx tessera check`:

```text
ERROR  T5008  app/pages/users.tess:5:20
  "profile.data.logn" is not a field of User.
  Did you mean "login"?
```

You do not have to write a description by hand. If the API publishes an OpenAPI file, `tessera api import <file or address> --name github` makes it for you.

## Writing

`post`, `put`, `patch` and `del` give a function that sends the request, and refreshes every read of the same path when it succeeds:

```xml tess kind=page
<script>
const add = post('/users')
const name = state('')

async function submit() {
  await add({ name: name.value })
  name.value = ''
}
</script>

<template>
  <div>
    <input aria-label="Name" bind:value="name" />
    <button type="button" :disabled="add.pending" @click="submit">Add</button>
    <p if="add.error">{add.error.message}</p>
  </div>
</template>
```

## Check

Run `npx tessera check`: it reports a call on `github` to an endpoint the description does not have. Then turn the network off in the browser tools and reload `/users`: the error message appears instead of the list. Everything about requests, caching and retries is in [Fetching data](/guide/data).

## Next steps

[Sharing state](/tutorial/09-shared-state).
