# AI coding tools

Introduced in v0.1 (Milestone 13).

AI coding tools write UI by guessing: a button that does not exist, a padding of `13px`, a variant nobody declared. Tessera already rejects all of those at compile time, so the useful thing to do for a tool is to tell it the truth before it writes, and to let it ask the compiler before it answers. Three pieces do that, and none of them changes how you write Tessera.

::: tip This is a bet
No framework enforces its design system at compile time for agents, and no study shows it changes what they produce. The compiler's checks are the part you can rely on. The pieces below make it cheaper for a tool to be right the first time, and the experiment described at the end of this page is how this project tests whether they do.
:::

## The manifest

`.tessera/manifest.json` is every fact about the project in one file: each component with its contract and valid usage examples, each token with its tier, its description and its value in every theme, the routes and layouts, and the rules the compiler enforces (which properties must use tokens, the contrast minimum). `tessera dev` and `tessera build` keep it current; `tessera manifest` writes it without a build, which is what CI wants.

```bash
npx tessera manifest
```

The same command writes `.tessera/custom-elements.json`, the components in the `custom-elements.json` format that editors and component tooling already read. A Tessera component is not a registered custom element, so its entry has no tag name: the variants are attributes, the events are events, the parts are `cssParts`, and the default slot has the empty name.

The folder `.tessera/` is generated; keep it out of version control.

## The MCP server

`tessera mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server over the project. It speaks on standard input and output, so a client starts it as a command. It is read-only: no tool writes a file.

```bash
npx tessera mcp
```

Tell the client how to start it. For most clients that is a `.mcp.json` or settings entry like this one:

```json
{
  "mcpServers": {
    "tessera": { "command": "npx", "args": ["tessera", "mcp"] }
  }
}
```

It runs in the project it is started in, or the one named with `--root`. What a client can do with it:

- **Find the right component.** `list_components`, `search_components` ("a button that deletes") and `get_component`, which returns the contract, usage examples and the source.
- **Use the right token.** `list_tokens` filters by tier, type or path, and `resolve_value` takes a raw value the model was about to write, such as `13px` for `padding`, and answers with the tokens to use, or says it is already valid. It runs the compiler's own style check, so the answer is what the build would accept.
- **Check before answering.** `validate_snippet` compiles a `.tess` file or fragment in the context of the project and returns exactly the errors `tessera check` would print, each with its hint and fix.
- **Call the right endpoint.** `list_apis` and `get_endpoint` give the path, parameters and answer type of an API that has a [description](/guide/data#describing-an-api-checked-calls).
- **Share state the right way.** `list_state` and `get_state` say what shared state exists and which functions change it.
- **Look up the rest.** `list_routes`, `get_rules` and `explain_error`.

Every tool, with its arguments, is in the [MCP server reference](/reference/mcp).

## AGENTS.md and llms.txt

```bash
npx tessera agent-files
```

writes `AGENTS.md` (what to do and not do in this project, and its components) and `llms.txt` (the same facts as a short index). Both are generated from the manifest and say so on their first line. Run the command again and a file Tessera wrote is refreshed; a file you wrote yourself is left alone unless you pass `--force`.

These are the cheap part. They help a tool that cannot run an MCP server, and they are no substitute for the compiler: `AGENTS.md` asks the tool to run `npx tessera check`, and the check is what decides.

## Does it help?

This project measured it once, and the honest answer is: not shown yet. [`experiments/agent-mcp`](https://github.com/pixelscript-io/tessera/tree/main/experiments/agent-mcp) has six UI prompts for the kitchen-sink app, run with and without the MCP server, and a scorer that counts what the compiler rejects. Without the tools a model produced 2 errors in 15 files; with them, 0 in 9. Neither arm invented a component, variant or slot. The difference comes from `validate_snippet`, which is the compiler, and the lookup tools had little to prevent in a system this small. It is six prompts and one attempt each, so treat it as a smoke test. The full account and its limits are in the specification's decisions log.

## Related

- [The command line](/guide/cli)
- [Contracts](/guide/contracts)
- [Styles and enforcement](/guide/styles)
