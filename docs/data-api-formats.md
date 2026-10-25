# Describing an API to Tessera: two formats to choose between

> **Decided and built in Milestone 29: both.** The small format is `app/apis/<name>.api.json` (next to the API file, not in `system/`, because an API is named by its file), and `tessera api import` makes it from OpenAPI 3 in JSON. The comparison below is kept for the reasoning; the guide page "Fetching data" has what was built, and SPEC.md the decisions.

Milestone 29 of the data work (see SPEC.md, "Data: calling APIs") needs the compiler to know your API: which endpoints exist, what parameters they take and what they return. Then `get('/todos/:id')` can be checked at compile time ("Did you mean `/todos/:id`?"), `todo.title` can be checked against the response, and AI tools can ask which endpoints exist.

There are two ways to give it that, and the decision is open. Neither blocks Milestones 27 and 28.

Below is the same small API (a to-do list) in both.

## 1. OpenAPI 3

The standard. Most back ends already have one, or can generate one.

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Todos", "version": "1.0.0" },
  "servers": [{ "url": "/api" }],
  "paths": {
    "/todos": {
      "get": {
        "operationId": "listTodos",
        "parameters": [
          { "name": "done", "in": "query", "schema": { "type": "boolean" } },
          { "name": "page", "in": "query", "schema": { "type": "integer" } }
        ],
        "responses": {
          "200": {
            "description": "The to-dos",
            "content": {
              "application/json": {
                "schema": { "type": "array", "items": { "$ref": "#/components/schemas/Todo" } }
              }
            }
          }
        }
      },
      "post": {
        "operationId": "createTodo",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": { "schema": { "$ref": "#/components/schemas/NewTodo" } }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": { "schema": { "$ref": "#/components/schemas/Todo" } }
            }
          }
        }
      }
    },
    "/todos/{id}": {
      "parameters": [
        { "name": "id", "in": "path", "required": true, "schema": { "type": "integer" } }
      ],
      "get": {
        "operationId": "getTodo",
        "responses": {
          "200": {
            "description": "The to-do",
            "content": {
              "application/json": { "schema": { "$ref": "#/components/schemas/Todo" } }
            }
          },
          "404": { "description": "There is no such to-do" }
        }
      },
      "put": {
        "operationId": "updateTodo",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": { "schema": { "$ref": "#/components/schemas/NewTodo" } }
          }
        },
        "responses": {
          "200": {
            "description": "Updated",
            "content": {
              "application/json": { "schema": { "$ref": "#/components/schemas/Todo" } }
            }
          }
        }
      },
      "delete": {
        "operationId": "deleteTodo",
        "responses": { "204": { "description": "Deleted" } }
      }
    }
  },
  "components": {
    "schemas": {
      "Todo": {
        "type": "object",
        "required": ["id", "title", "done"],
        "properties": {
          "id": { "type": "integer" },
          "title": { "type": "string" },
          "done": { "type": "boolean" },
          "due": { "type": "string", "format": "date" }
        }
      },
      "NewTodo": {
        "type": "object",
        "required": ["title"],
        "properties": {
          "title": { "type": "string" },
          "done": { "type": "boolean" },
          "due": { "type": "string", "format": "date" }
        }
      }
    }
  }
}
```

**For:** it already exists for many teams; it is the thing back-end tools generate and keep up to date; it has examples, enums, formats and error shapes; every other tool understands it.

**Against:** it is long (100 lines for what the format below says in 25), its paths are written `{id}` where Tessera's calls say `:id`, and `$ref`s, `allOf` and `oneOf` are a lot of language to support well. We would support a useful part of it and say what we skip.

## 2. A small format of our own

JSON, like the contracts and the tokens, in `system/api/api.json`:

```json
{
  "base": "/api",
  "types": {
    "Todo": { "id": "number", "title": "string", "done": "boolean", "due": "string?" },
    "NewTodo": { "title": "string", "done": "boolean?", "due": "string?" }
  },
  "paths": {
    "/todos": {
      "get": { "query": { "done": "boolean?", "page": "number?" }, "returns": "Todo[]" },
      "post": { "body": "NewTodo", "returns": "Todo" }
    },
    "/todos/:id": {
      "get": { "returns": "Todo", "errors": { "404": "There is no such to-do" } },
      "put": { "body": "NewTodo", "returns": "Todo" },
      "delete": {}
    }
  }
}
```

A type is a string: `string`, `number`, `boolean`, a name from `types`, `Name[]` for a list, `?` after it for optional, `"open" | "done"` for a choice. An object is an object of those. `returns` is missing or `"none"` when the reply is empty.

**For:** small enough to read in one go and to write by hand; paths are written the way the calls use them (`:id`); the compiler's checks and error messages can be about exactly this and nothing else.

**Against:** somebody has to write it, and if your back end already has an OpenAPI file, it is a second description to keep in step.

## What I recommend: both, the way tokens work

This is how the design tokens already work. `tessera tokens import` reads other tools' formats and writes the strict one that the compiler understands. The same would be true here:

- `tessera api import openapi.json` reads OpenAPI (the useful part) and writes `system/api/api.json`, the small format.
- The small format is what the compiler reads, what is diffed in a code review, and what you may write by hand if you have no OpenAPI.
- Re-running the import updates it, and shows what changed (a removed endpoint, a field that became optional), as `tessera diff` does for contracts and tokens.

That costs one importer (the part of OpenAPI that matters) and keeps the checks simple. If you would rather have only one, the cheaper one to build is the small format; the more useful one for teams with a back end is OpenAPI.

## What to decide

1. OpenAPI only, the small format only, or both as above?
2. If both: which parts of OpenAPI to support first? I would start with paths, parameters, JSON request and response bodies, `$ref`s into `components/schemas`, enums, and `required`, and say that `oneOf`, `allOf` and callbacks are not read.
3. Where should the file live: `system/api/` next to the tokens and components, or in a place of your choosing set in `tessera.config.ts`?
