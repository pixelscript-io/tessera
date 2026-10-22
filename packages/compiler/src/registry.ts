import { nearest, type Contract } from '@tessera/contract'
import type { ComponentInfo, ComponentResolver } from './codegen'
import { extractContractInfo } from './compile'

/** A component found in `system/components` or `app/components`. */
export interface RegistryEntry {
  /** The contract `name`, which is also the tag. */
  name: string
  /** Absolute path, with forward slashes. */
  file: string
  contract: Contract
  /** Where the contract's `name` value is in the file (1-based). */
  nameAt: { line: number; column: number }
}

export interface RegistryDiagnostic {
  code: 'T5001'
  severity: 'error'
  /** Path as shown to the user. */
  file: string
  line: number
  column: number
  message: string
  hint?: string
}

export interface RegistryFile {
  /** Absolute path. */
  file: string
  source: string
}

const normalize = (path: string) => path.replaceAll('\\', '/')

/** The import specifier that reaches `to` from the file `from`, such as `../../system/components/Button.tess`. */
export function relativeImport(from: string, to: string): string {
  const a = normalize(from).split('/').slice(0, -1)
  const b = normalize(to).split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  const up = a.slice(i).map(() => '..')
  const rest = b.slice(i)
  return up.length ? [...up, ...rest].join('/') : ['.', ...rest].join('/')
}

/**
 * Every component in the project, keyed by contract name. Names are global across `system/components` and
 * `app/components`: a repeated name is an error that names both files, and no component shadows another.
 * This is pure, so it also runs in a browser; reading the folders is the caller's job.
 */
export class ComponentRegistry {
  readonly entries = new Map<string, RegistryEntry>()
  readonly diagnostics: RegistryDiagnostic[] = []
  /** Entries that lost to an earlier file with the same name. */
  readonly duplicates: RegistryEntry[] = []

  private constructor(private readonly display: (file: string) => string) {}

  /**
   * Build the registry from files in a stable order (system components first, then app components, each sorted).
   * The first definition of a name is the one tags resolve to, so a duplicate does not also break every user.
   * A file whose contract does not parse is left out; its own compile reports why.
   */
  static build(
    files: RegistryFile[],
    display: (file: string) => string = (f) => f,
  ): ComponentRegistry {
    const registry = new ComponentRegistry(display)
    for (const { file, source } of files) {
      const info = extractContractInfo(source, file)
      if (!info) continue
      const entry: RegistryEntry = {
        name: info.contract.name,
        file: normalize(file),
        contract: info.contract,
        nameAt: info.nameAt,
      }
      if (registry.entries.has(entry.name)) registry.duplicates.push(entry)
      else registry.entries.set(entry.name, entry)
    }

    for (const dup of registry.duplicates) {
      const first = registry.entries.get(dup.name)!
      const group = [first, ...registry.duplicates.filter((d) => d.name === dup.name)]
      for (const e of group) {
        const others = group.filter((o) => o !== e).map((o) => display(o.file))
        // One diagnostic per file in the group, so each file shows the problem.
        if (
          registry.diagnostics.some(
            (d) => d.file === display(e.file) && d.message.includes(`"${dup.name}"`),
          )
        )
          continue
        registry.diagnostics.push({
          code: 'T5001',
          severity: 'error',
          file: display(e.file),
          line: e.nameAt.line,
          column: e.nameAt.column,
          message: `Duplicate component name "${dup.name}". It is also defined in ${others.join(' and ')}.`,
          hint: 'Component names are global and cannot shadow each other. Rename one of them, or use the system component through a wrapper.',
        })
      }
    }
    return registry
  }

  names(): string[] {
    return [...this.entries.keys()]
  }

  get(name: string): RegistryEntry | undefined {
    return this.entries.get(name)
  }

  /** Problems that belong to one file, for its own compile to report. */
  diagnosticsFor(file: string): RegistryDiagnostic[] {
    const shown = this.display(file)
    return this.diagnostics.filter((d) => d.file === shown)
  }

  /** Looks tags up for the file at `importer` (an absolute path), producing imports relative to it. */
  resolverFor(
    importer: string,
  ): ComponentResolver & { importHint(tag: string): string | undefined } {
    return {
      resolve: (tag): ComponentInfo | undefined => {
        const entry = this.entries.get(tag)
        return entry
          ? { contract: entry.contract, importPath: relativeImport(importer, entry.file) }
          : undefined
      },
      names: () => this.names(),
      importHint: (tag) => {
        const entry = this.entries.get(tag)
        return entry
          ? `import ${tag} from ${JSON.stringify(relativeImport(importer, entry.file))}`
          : undefined
      },
    }
  }

  /** The closest component name to a misspelled tag. */
  suggest(tag: string): string | undefined {
    return nearest(tag, this.names())
  }
}
