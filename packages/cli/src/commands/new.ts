import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildRouteManifest } from '@tessera/router/manifest'
import type { Args } from '../args'
import type { Io } from '../io'
import { CliError } from '../io'
import { openProject } from '../project'

const PASCAL = /^[A-Z][A-Za-z0-9]*$/

export function componentTemplate(name: string): string {
  return `<contract>
{
  "name": "${name}",
  "role": "group",
  "description": "",
  "parts": ["root"],
  "slots": { "default": "content" }
}
</contract>

<template>
  <div class="root">
    <slot />
  </div>
</template>

<style>
.root {
  padding: $space.4;
  color: $color.text.default;
}
</style>
`
}

/** A readable title for a page path: `blog/[slug]` is "Slug", `blog/index` is "Blog", the home page is "Home". */
function titleFor(path: string): string {
  const parts = path.split('/')
  if (parts[parts.length - 1] === 'index') parts.pop()
  const last = parts.pop()
  if (!last) return 'Home'
  const words = last.replace(/^\[|\]$/g, '').replace(/[-_]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function pageTemplate(path: string): string {
  const title = titleFor(path)
  return `<page>
{ "title": ${JSON.stringify(title)} }
</page>

<template>
  <main>
    <h1>${title}</h1>
  </main>
</template>
`
}

/** `tessera new component <Name>` and `tessera new page <path>`. */
export async function newCommand(args: Args, io: Io): Promise<number> {
  const [kind, target] = args.positional
  if ((kind !== 'component' && kind !== 'page') || !target) {
    throw new CliError(
      'Say what to create.',
      'tessera new component <Name>   or   tessera new page <path>, such as blog/[slug]',
    )
  }
  const project = await openProject(io.cwd, args)

  if (kind === 'component') {
    if (!PASCAL.test(target)) {
      throw new CliError(
        `"${target}" is not a valid component name.`,
        'Use PascalCase with letters and numbers, such as UserCard.',
      )
    }
    const taken = project.components().registry.entries.get(target)
    if (taken) {
      throw new CliError(
        `A component named ${target} already exists (${project.display(taken.file)}).`,
        'Component names are global. Pick another name, or edit the existing one.',
      )
    }
    const path = join(project.root, 'app', 'components', `${target}.tess`)
    if (existsSync(path)) throw new CliError(`${project.display(path)} already exists.`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, componentTemplate(target))
    const message = `Created ${project.display(path)}. Use it as <${target}> in any template; no import needed.`
    io.out(io.ui ? io.ui.ok(message) : message)
    return 0
  }

  const page = target.replace(/^\/+/, '').replace(/\.tess$/, '')
  const file = `${page}.tess`
  const pagesDir = join(project.root, 'app', 'pages')
  const path = join(pagesDir, file)
  if (existsSync(path)) throw new CliError(`${project.display(path)} already exists.`)
  const existing = project.routes().manifest
  const known = [
    ...existing.routes.map((r) => r.file),
    ...(existing.notFound ? [existing.notFound.file] : []),
  ]
  const trial = buildRouteManifest([...known, file])
  const problem = trial.diagnostics.find((d) => d.files.includes(file))
  if (problem) throw new CliError(problem.message, problem.hint)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, pageTemplate(page))
  const route = trial.routes.find((r) => r.file === file)?.path ?? '(the not-found page)'
  const made = `Created ${project.display(path)} for ${route}.`
  io.out(io.ui ? io.ui.ok(made) : made)
  return 0
}
