# Experiment: does the MCP server reduce off-system output?

SPEC 10.1 calls agent support a bet and asks for a small experiment before anyone believes it. This folder is that
experiment. It measures one thing: when a model builds UI in the kitchen-sink app, how much of what it writes does the
compiler reject as off the system?

## Arms

- **without**: the model has the app's files and nothing else. No AGENTS.md, no manifest, no MCP server.
- **with**: the same model, same prompts, same files, plus the `tessera` MCP server (`npx tessera mcp`) and the
  instruction to use it.

## Tools

- `node experiments/agent-mcp/setup.mjs`: makes a clean working copy of the app per arm and prompt in `work/` (not committed).
- `node experiments/agent-mcp/mcp-call.mjs <folder> <tool> <json>`: calls one tool of the real `tessera mcp` server from a shell, for models that have no MCP connection.
- `node experiments/agent-mcp/extract.mjs`: copies the files a run added or changed to `runs/` (committed, as the record).
- `pnpm --filter @tessera/agent score`: scores `runs/`, checking each run inside its own working copy.

## Procedure

1. Start each run from a clean copy of `examples/kitchen-sink`, with `.tessera/`, `AGENTS.md` and `llms.txt` removed,
   so the "without" arm cannot read the manifest.
2. For each prompt in `prompts.json`, give the model the prompt as is. In the "with" arm add: "The `tessera` MCP server
   is connected. Use it."
3. One attempt per prompt. The model may not run `tessera check` or the build, so the score is its first draft, not what
   it fixed after the compiler told it.
4. Copy the `.tess` files the model wrote or changed to `runs/<arm>/<prompt id>/app/...`.
5. Score:

   ```bash
   pnpm --filter @tessera/agent score
   ```

The score counts the compiler's errors on those files, split into raw values, wrong tokens, invented components and
invented variants, slots or events. Fewer is better. The baseline is ignored.

## Result

Run once on 2026-10-23; the result and its limits are in the SPEC Decisions log. In short: without the tools, 2 errors in 15 files; with them, 0 in 9; no invented components or variants in either arm. The difference comes from the compiler check, not the lookup tools, and it is a smoke test.
