import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'
import { main } from '../src'
import type { Io } from '../src/io'

/** The repository's design tokens, so throwaway projects have real tokens to check against. */
export const REPO_TOKENS = fileURLToPath(
  new URL('../../../system/tokens', import.meta.url),
).replaceAll('\\', '/')

const made: string[] = []
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A throwaway project on disk with these files, plus a `tessera.config.ts` pointing at the repo tokens. */
export function project(files: Record<string, string>, config = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'tessera-cli-'))
  made.push(root)
  const all: Record<string, string> = {
    'tessera.config.ts': `export default { tokens: ${JSON.stringify(REPO_TOKENS)}${config ? `, ${config}` : ''} }\n`,
    ...files,
  }
  for (const [name, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return root
}

export const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')

export const write = (root: string, file: string, content: string) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), content)
}

/** Run the CLI in a folder and collect what it printed. */
export async function run(cwd: string, ...argv: string[]) {
  let out = ''
  let err = ''
  const io: Io = {
    cwd,
    out: (t) => void (out += t + '\n'),
    err: (t) => void (err += t + '\n'),
  }
  const code = await main(argv, io)
  return { code, out, err }
}

export const component = (name: string, style = '') =>
  `<contract>
{ "name": "${name}", "role": "group", "parts": ["root"] }
</contract>
<template><div class="root"></div></template>
${style ? `<style>\n${style}\n</style>\n` : ''}`

export const page = (body = '<h1>Hi</h1>', head = '') =>
  `${head}<template><main>${body}</main></template>\n`
