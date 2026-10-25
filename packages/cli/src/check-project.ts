import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkPlainScriptAutoImports,
  routeDiagnostics,
  type CompilerDiagnostic,
} from '@tessera/compiler'
import type { Project, ProjectFileResult } from '@tessera/compiler/project'
import { formatDiagnostic as formatTokenDiagnostic } from '@tessera/tokens'

export interface FileReport {
  file: string
  /** What is left to fix after severity and the baseline. */
  diagnostics: CompilerDiagnostic[]
  /** The compile result, for `.tess` files. */
  checked?: ProjectFileResult
}

export interface ProjectReport {
  files: FileReport[]
  /** Problems that belong to no single file (tokens that do not build). */
  messages: string[]
}

/** Every `.ts` file under `app/` that is not a type declaration, with forward-slash absolute paths. */
function appScripts(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(path)
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        out.push(path.replaceAll('\\', '/'))
      }
    }
  }
  walk(join(root, 'app'))
  return out.sort()
}

/**
 * Run every validation without bundling: tokens build, each `.tess` file (contract, template, style rules,
 * contrast, links, layouts), route conflicts, and auto-imports used in plain `.ts` files. This is the same
 * compile the Vite plugin does, with severity and the baseline applied, so it reports what a build would.
 * Pass `baseline: null` to ignore the baseline (to measure what it would need to record).
 */
export function checkProject(project: Project, options: { baseline?: null } = {}): ProjectReport {
  const messages: string[] = []
  const files: FileReport[] = []

  const tokens = project.tokens()
  if (tokens && !tokens.ok) messages.push(...tokens.diagnostics.map(formatTokenDiagnostic))

  for (const path of project.files()) {
    const checked = project.compileFile(path, readFileSync(path, 'utf8'), {
      baseline: options.baseline,
    })
    files.push({ file: checked.file, diagnostics: [...checked.diagnostics], checked })
  }

  const routes = project.routes()
  for (const d of routeDiagnostics(routes.manifest, project.display(routes.dir))) {
    const existing = files.find((f) => f.file === d.file)
    if (existing) existing.diagnostics.push(d)
    else files.push({ file: d.file, diagnostics: [d] })
  }

  for (const d of project.apis().diagnostics) {
    const existing = files.find((f) => f.file === d.file)
    if (existing) existing.diagnostics.push(d)
    else files.push({ file: d.file, diagnostics: [d] })
  }

  for (const path of appScripts(project.root)) {
    const file = project.display(path)
    const problems = checkPlainScriptAutoImports(readFileSync(path, 'utf8'), file)
    if (problems.length) files.push({ file, diagnostics: problems })
  }

  return { files, messages }
}

export const countBy = (report: ProjectReport, severity: 'error' | 'warning'): number =>
  report.files.reduce((n, f) => n + f.diagnostics.filter((d) => d.severity === severity).length, 0)
