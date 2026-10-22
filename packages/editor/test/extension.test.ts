import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const built = here('../vscode/dist/extension.cjs')
const repo = here('../../../')
const seededPath = `${repo}examples/kitchen-sink/app/seeded/Broken.tess`

// A small stand-in for the VS Code API: just enough to run the extension's activate() and watch what it does.
function fakeVscode() {
  const sets = new Map<string, unknown[]>()
  const handlers: Record<string, Array<(arg: any) => void>> = {}
  let completion: { provideCompletionItems(doc: any, pos: any): any[] | undefined } | undefined
  const on = (name: string) => (fn: (arg: any) => void) => {
    ;(handlers[name] ??= []).push(fn)
    return { dispose() {} }
  }
  const watcher = () => ({
    onDidChange: on('watch'),
    onDidCreate: on('watch'),
    onDidDelete: on('watch'),
    dispose() {},
  })
  const documents: any[] = []
  const api = {
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    CompletionItemKind: { Property: 9, EnumMember: 19 },
    Range: class {
      constructor(
        readonly startLine: number,
        readonly startCharacter: number,
        readonly endLine: number,
        readonly endCharacter: number,
      ) {}
    },
    Diagnostic: class {
      code?: string
      source?: string
      constructor(
        readonly range: unknown,
        readonly message: string,
        readonly severity: number,
      ) {}
    },
    CompletionItem: class {
      insertText?: string
      range?: unknown
      detail?: string
      constructor(
        readonly label: string,
        readonly kind: number,
      ) {}
    },
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri: { toString(): string }, diagnostics: unknown[]) =>
          sets.set(uri.toString(), diagnostics),
        delete: (uri: { toString(): string }) => sets.delete(uri.toString()),
        dispose() {},
      }),
      registerCompletionItemProvider: (_language: string, provider: typeof completion) => {
        completion = provider
        return { dispose() {} }
      },
    },
    workspace: {
      textDocuments: documents,
      getWorkspaceFolder: () => ({ uri: { fsPath: repo } }),
      createFileSystemWatcher: watcher,
      onDidOpenTextDocument: on('open'),
      onDidChangeTextDocument: on('change'),
      onDidCloseTextDocument: on('close'),
    },
  }
  return { api, sets, handlers, documents, completion: () => completion }
}

function document(path: string, text: string) {
  const lines = text.split('\n')
  return {
    languageId: 'tess',
    uri: { fsPath: path, toString: () => `file://${path}` },
    getText: () => text,
    offsetAt: ({ line, character }: { line: number; character: number }) =>
      lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + character,
    positionAt: (offset: number) => {
      const before = text.slice(0, offset).split('\n')
      return { line: before.length - 1, character: before[before.length - 1]!.length }
    },
  }
}

function load(vscode: object) {
  const nodeRequire = createRequire(import.meta.url)
  const module = { exports: {} as { activate(context: { subscriptions: unknown[] }): void } }
  const run = new Function('require', 'module', 'exports', readFileSync(built, 'utf8'))
  run((id: string) => (id === 'vscode' ? vscode : nodeRequire(id)), module, module.exports)
  return module.exports
}

describe.skipIf(!existsSync(built))('the built VS Code extension', () => {
  it('publishes diagnostics for the seeded kitchen-sink file when it opens', () => {
    const fake = fakeVscode()
    const doc = document(seededPath, readFileSync(seededPath, 'utf8'))
    fake.documents.push(doc)
    load(fake.api).activate({ subscriptions: [] })

    const published = fake.sets.get(doc.uri.toString()) as Array<{
      message: string
      code: string
      source: string
      severity: number
    }>
    expect(published.map((d) => [d.code, d.message])).toEqual([
      ['T4008', 'Counter.tone has no value "primry".\nDid you mean "primary"?'],
      ['T2104', expect.stringMatching(/^Unknown token "\$space\.9"/)],
      ['T2104', 'Unknown token "$color.surface.defalt"\nDid you mean "$color.surface.default"?'],
    ])
    expect(published.every((d) => d.source === 'tessera' && d.severity === 0)).toBe(true)
  })

  it('updates diagnostics when the document changes, and clears them when it closes', async () => {
    const fake = fakeVscode()
    load(fake.api).activate({ subscriptions: [] })
    const bad = document(seededPath, readFileSync(seededPath, 'utf8'))
    fake.handlers.open![0]!(bad)
    expect((fake.sets.get(bad.uri.toString()) as unknown[]).length).toBe(3)

    const fixed = document(
      seededPath,
      readFileSync(seededPath, 'utf8')
        .replace('primry', 'primary')
        .replace('$space.9', '$space.4')
        .replace('defalt', 'default'),
    )
    fake.handlers.change![0]!({ document: fixed })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(fake.sets.get(fixed.uri.toString())).toEqual([])

    fake.handlers.close![0]!(fixed)
    expect(fake.sets.has(fixed.uri.toString())).toBe(false)
  })

  it('offers contract completions in a tess document', () => {
    const fake = fakeVscode()
    load(fake.api).activate({ subscriptions: [] })
    const text = '<contract>\n{ "role": "tool" }\n</contract>\n<template><div></div></template>'
    const doc = document(seededPath, text)
    const offset = text.indexOf('tool') + 4
    const items = fake.completion()!.provideCompletionItems(doc, doc.positionAt(offset))!
    expect(items.map((i: { label: string }) => i.label)).toContain('toolbar')
    expect(items.find((i: { label: string }) => i.label === 'toolbar').insertText).toBe('toolbar')
    expect(
      fake
        .completion()!
        .provideCompletionItems(document(seededPath, text), { line: 3, character: 12 }),
    ).toBeUndefined()
  })

  it('ignores documents in other languages', () => {
    const fake = fakeVscode()
    load(fake.api).activate({ subscriptions: [] })
    const other = { ...document('/x.ts', 'const a = 1'), languageId: 'typescript' }
    fake.handlers.open![0]!(other)
    expect(fake.sets.size).toBe(0)
  })
})
