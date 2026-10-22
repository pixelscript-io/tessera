import { dirname } from 'node:path'
import * as vscode from 'vscode'
import { completeContract } from './contract-completion'
import { EditorProject } from './node'

const DEBOUNCE_MS = 200

/** The VS Code side: it only wires editor events to the language service. */
export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('tessera')
  const projects = new Map<string, EditorProject>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const projectFor = (document: vscode.TextDocument): EditorProject => {
    const root =
      vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? dirname(document.uri.fsPath)
    let project = projects.get(root)
    if (!project) {
      project = new EditorProject(root)
      projects.set(root, project)
    }
    return project
  }

  const refresh = (document: vscode.TextDocument): void => {
    if (document.languageId !== 'tess') return
    const results = projectFor(document).diagnose(document.uri.fsPath, document.getText())
    collection.set(
      document.uri,
      results.map((d) => {
        const range = new vscode.Range(d.line, d.column, d.endLine, d.endColumn)
        const diagnostic = new vscode.Diagnostic(
          range,
          d.message,
          d.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        )
        diagnostic.code = d.code
        diagnostic.source = 'tessera'
        return diagnostic
      }),
    )
  }

  const refreshAll = (): void => {
    for (const document of vscode.workspace.textDocuments) refresh(document)
  }

  const schedule = (document: vscode.TextDocument): void => {
    const key = document.uri.toString()
    clearTimeout(timers.get(key))
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        refresh(document)
      }, DEBOUNCE_MS),
    )
  }

  // Token and component files change what other files' diagnostics should say.
  const tokenWatcher = vscode.workspace.createFileSystemWatcher('**/*.tokens.json')
  const onTokensChanged = () => {
    for (const project of projects.values()) project.invalidate()
    refreshAll()
  }
  const componentWatcher = vscode.workspace.createFileSystemWatcher('**/*.tess')
  // A component added, removed or edited changes which tags resolve and what their contracts allow.
  const onComponentsChanged = () => {
    for (const project of projects.values()) project.invalidate()
    refreshAll()
  }

  context.subscriptions.push(
    collection,
    tokenWatcher,
    componentWatcher,
    tokenWatcher.onDidChange(onTokensChanged),
    tokenWatcher.onDidCreate(onTokensChanged),
    tokenWatcher.onDidDelete(onTokensChanged),
    componentWatcher.onDidChange(onComponentsChanged),
    componentWatcher.onDidCreate(onComponentsChanged),
    componentWatcher.onDidDelete(onComponentsChanged),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearTimeout(timers.get(document.uri.toString()))
      collection.delete(document.uri)
    }),
    vscode.languages.registerCompletionItemProvider(
      'tess',
      {
        provideCompletionItems(document, position) {
          const result = completeContract(document.getText(), document.offsetAt(position))
          if (!result) return undefined
          const range = new vscode.Range(
            document.positionAt(result.replaceStart),
            document.positionAt(result.replaceEnd),
          )
          return result.items.map((item) => {
            const completion = new vscode.CompletionItem(
              item.label,
              item.kind === 'property'
                ? vscode.CompletionItemKind.Property
                : vscode.CompletionItemKind.EnumMember,
            )
            completion.insertText = item.insert
            completion.range = range
            completion.detail = item.detail
            return completion
          })
        },
      },
      '"',
    ),
  )

  refreshAll()
}

export function deactivate(): void {}
