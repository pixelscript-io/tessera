import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { listImports } from '@tessera/compiler'
import { parseJsonc } from '@tessera/contract'
import type { Args } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import { openProject } from '../project'

const PASCAL = /^[A-Z][A-Za-z0-9]*$/

/** The version of the design system a component comes from: its package's, else the contract's `since`. */
function systemVersion(file: string, since: string | undefined): string {
  for (let dir = dirname(file); dirname(dir) !== dir; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const version = (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version
      if (version) return version
    }
  }
  return since ?? '0.0.0'
}

/**
 * Rewrite a contract block: a new `name`, and `forkedFrom` recording what it was copied from. Edits the text
 * in place so comments and formatting survive.
 */
export function forkContract(
  source: string,
  name: string,
  from: { component: string; version: string },
): string {
  const open = source.indexOf('<contract>')
  const close = source.indexOf('</contract>')
  if (open === -1 || close === -1) throw new CliError('This component has no <contract>.')
  const start = open + '<contract>'.length
  const block = source.slice(start, close)
  const root = parseJsonc(block)
  if (root.type !== 'object') throw new CliError('The <contract> is not an object.')

  const nameProp = root.props.find((p) => p.key === 'name')
  if (!nameProp) throw new CliError('The <contract> has no "name".')
  const forked = root.props.find((p) => p.key === 'forkedFrom')

  const edits: Array<{ start: number; end: number; text: string }> = [
    { start: nameProp.value.start, end: nameProp.value.end, text: JSON.stringify(name) },
  ]
  const value = JSON.stringify(from)
  if (forked) {
    edits.push({ start: forked.value.start, end: forked.value.end, text: value })
  } else {
    const lineStart = block.lastIndexOf('\n', nameProp.keyStart) + 1
    const indent = block.slice(lineStart, nameProp.keyStart)
    const separator = indent.trim() === '' && indent !== '' ? `\n${indent}` : ' '
    edits.push({
      start: nameProp.value.end,
      end: nameProp.value.end,
      text: `,${separator}"forkedFrom": ${value}`,
    })
  }
  let out = block
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }
  return source.slice(0, start) + out + source.slice(close)
}

/**
 * `tessera eject <Name> [<NewName>]`: copy a system component into `app/components/` under a new name and
 * record `forkedFrom` (the component and the version it came from), so owning a copy never means silent drift.
 * A component of the Tessera UI library may be copied under its own name: the copy then replaces the library's.
 */
export async function eject(args: Args, io: Io): Promise<number> {
  const [from, given] = args.positional
  if (!from)
    throw new CliError(
      'Say which component to copy and what to call the copy.',
      'tessera eject Button FancyButton',
    )
  const project = await openProject(io.cwd, args)
  const registry = project.components().registry

  const entry = registry.entries.get(from)
  if (!entry) {
    const near = [...registry.entries.keys()].join(', ')
    throw new CliError(
      `There is no component named ${from}.`,
      near ? `Components: ${near}.` : undefined,
    )
  }
  const appDir = join(project.root, 'app', 'components').replaceAll('\\', '/')
  if (entry.file.replaceAll('\\', '/').startsWith(`${appDir}/`)) {
    throw new CliError(
      `${from} is already your own component (${project.display(entry.file)}).`,
      'Eject copies a system component. To make a variation of your own, copy the file by hand.',
    )
  }
  // A library component keeps its name by default (the copy replaces it); any other needs a new one.
  const to = given ?? (entry.library ? from : undefined)
  if (!to) {
    throw new CliError(
      'Say which component to copy and what to call the copy.',
      `tessera eject ${from} Fancy${from}`,
    )
  }
  if (!PASCAL.test(to)) {
    throw new CliError(
      `"${to}" is not a valid component name.`,
      'Use PascalCase with letters and numbers, such as FancyButton.',
    )
  }
  if (registry.entries.has(to) && !(to === from && entry.library)) {
    throw new CliError(
      `A component named ${to} already exists (${project.display(registry.entries.get(to)!.file)}).`,
    )
  }
  const target = join(appDir, `${to}.tess`)
  if (existsSync(target)) throw new CliError(`${project.display(target)} already exists.`)

  const source = readFileSync(entry.file, 'utf8')
  const version = systemVersion(entry.file, entry.contract?.since)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, forkContract(source, to, { component: from, version }))

  const made = `Created ${project.display(target)}, forked from ${from}@${version}.`
  io.out(io.ui ? io.ui.ok(made) : made)
  const relative = listImports(source).filter((i) => i.source.startsWith('.'))
  if (relative.length) {
    const note = `Note: it imports ${relative.map((i) => `"${i.source}"`).join(', ')}, which are relative to the original. Check those paths.`
    io.out(io.ui ? io.ui.warn(note) : note)
  }
  return 0
}
