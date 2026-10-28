import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { Project } from '@tessera/compiler/project'
import type { RegistryFile } from './registry/schema'
import { presetFiles } from './commands/init'

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g
const TOKEN_REF = /\$([A-Za-z][\w-]*(?:\.[\w-]+)+)/g
const ALIAS = /^\{([^{}]+)\}$/
const TOKEN_PATH = /^[A-Za-z][\w-]*(?:\.[\w-]+)+$/

/** The file the fit fix writes, in a system's tokens folder. Its name is the mark: it holds only what `add` put there. */
export const FIT_FILE = 'tessera-ui.tokens.json'
const FIT_NOTE =
  'Added by tessera add: a token the Tessera UI components use that this system lacked.'

/** A token a component uses, with the type the reference set gives it. */
export interface Need {
  path: string
  /** Undefined when the reference set does not define the token. */
  type: string | undefined
  /** The components being added that use it. */
  by: string[]
}

export interface SystemFit {
  name: string
  /** The system's tokens folder, absolute. */
  dir: string
  /** Tokens the components use that the system does not define. */
  missing: Need[]
  /** Tokens the system defines with another type than the components expect. */
  wrongType: Array<Need & { has: string }>
  /** The tokens of this system do not build, so nothing could be compared. */
  broken?: boolean
  /** The themes the system has, by name. */
  themes: string[]
}

interface RefNode {
  value: unknown
  type: string | undefined
  /** `primitive`, `semantic` or `component`, from the token or the group it is in. */
  tier: string | undefined
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function tierOf(doc: Record<string, unknown>): string | undefined {
  const tessera = isObject(doc.$extensions) ? doc.$extensions.tessera : undefined
  return isObject(tessera) && typeof tessera.tier === 'string' ? tessera.tier : undefined
}

function collect(
  doc: unknown,
  into: Map<string, RefNode>,
  path: string[] = [],
  inherited: { type?: string; tier?: string } = {},
) {
  if (!isObject(doc)) return
  const here = {
    type: typeof doc.$type === 'string' ? doc.$type : inherited.type,
    tier: tierOf(doc) ?? inherited.tier,
  }
  if ('$value' in doc) {
    into.set(path.join('.'), { value: doc.$value, ...here })
    return
  }
  for (const [key, value] of Object.entries(doc))
    if (!key.startsWith('$')) collect(value, into, [...path, key], here)
}

/** The tokens the Tessera UI components are written against: the `tailwind` set that ships inside the CLI. */
class Reference {
  readonly base = new Map<string, RefNode>()
  readonly themes = new Map<string, Map<string, RefNode>>()

  constructor() {
    const prefix = 'system/tailwind/tokens/'
    for (const [file, content] of Object.entries(presetFiles('tailwind'))) {
      if (!file.startsWith(prefix) || !file.endsWith('.tokens.json')) continue
      const rest = file.slice(prefix.length)
      const doc = JSON.parse(content) as unknown
      if (rest.startsWith('themes/')) {
        const name = rest.slice('themes/'.length, -'.tokens.json'.length)
        const map = this.themes.get(name) ?? new Map<string, RefNode>()
        collect(doc, map)
        this.themes.set(name, map)
      } else collect(doc, this.base)
    }
  }

  /** The type of a token, following an alias to the token it names when the token states none. */
  type(path: string, depth = 0): string | undefined {
    const node = this.base.get(path)
    if (!node) return undefined
    if (node.type) return node.type
    const target = typeof node.value === 'string' ? ALIAS.exec(node.value)?.[1] : undefined
    return target && depth < 20 ? this.type(target, depth + 1) : undefined
  }

  /** A token's value in a theme (or the base), with every alias followed to a literal. */
  literal(path: string, theme?: string, depth = 0): unknown {
    const node = (theme ? this.themes.get(theme)?.get(path) : undefined) ?? this.base.get(path)
    if (!node || depth > 20) return undefined
    const resolve = (v: unknown): unknown => {
      if (typeof v === 'string') {
        const target = ALIAS.exec(v)?.[1]
        return target ? this.literal(target, theme, depth + 1) : v
      }
      if (Array.isArray(v)) return v.map(resolve)
      if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]))
      return v
    }
    return resolve(node.value)
  }
}

let reference: Reference | undefined
const referenceSet = (): Reference => (reference ??= new Reference())

/** Every token the style blocks of these files use, and which component uses it. */
export function needsOf(files: RegistryFile[]): Need[] {
  const ref = referenceSet()
  const found = new Map<string, Set<string>>()
  for (const file of files) {
    if (!file.path.endsWith('.tess')) continue
    const name = file.path.slice(0, -'.tess'.length)
    for (const block of file.content.matchAll(STYLE_BLOCK))
      for (const match of block[1]!.matchAll(TOKEN_REF)) {
        const set = found.get(match[1]!) ?? new Set<string>()
        set.add(name)
        found.set(match[1]!, set)
      }
  }
  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, by]) => ({ path, type: ref.type(path), by: [...by].sort() }))
}

/** Read `--map a.b=c.d,e.f=g.h`. Throws a message for the person when a pair is not two token paths. */
export function parseMap(given: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const pair of given.split(',').filter(Boolean)) {
    const [from, to, ...extra] = pair.split('=')
    if (!from || !to || extra.length || !TOKEN_PATH.test(from) || !TOKEN_PATH.test(to))
      throw new Error(
        `"${pair}" is not a token mapping. Write it as --map color.action.primary.bg=color.brand.bg (the token the component uses, then the one in your system).`,
      )
    map.set(from, to)
  }
  return map
}

/** Rewrite the tokens a component's styles use, so a component written for one name fits a system that calls it another. */
export function applyMap(files: RegistryFile[], map: Map<string, string>): RegistryFile[] {
  if (!map.size) return files
  return files.map((file) =>
    file.path.endsWith('.tess')
      ? {
          path: file.path,
          content: file.content.replace(STYLE_BLOCK, (block) =>
            block.replace(TOKEN_REF, (whole, path: string) =>
              map.has(path) ? `$${map.get(path)}` : whole,
            ),
          ),
        }
      : file,
  )
}

/** How each design system of the project fits the tokens the components use. Systems without tokens are left out. */
export function fitOf(project: Project, needs: Need[]): SystemFit[] {
  const listed = project.config.systems ?? []
  const open = (name: string | undefined) =>
    name === undefined
      ? project
      : new Project(project.root, {
          ...project.options,
          config: { ...project.config, defaultSystem: name },
        })
  const targets = listed.length >= 1 ? listed.map((s) => s.name) : [undefined]
  const out: SystemFit[] = []
  for (const target of targets) {
    const other = open(target)
    const dir = other.tokensDir()
    const loaded = other.tokens()
    if (!dir || !loaded) continue
    const name = target ?? 'your design system'
    if (!loaded.ok) {
      out.push({ name, dir, missing: [], wrongType: [], broken: true, themes: [] })
      continue
    }
    const has = new Map(loaded.manifest.tokens.map((t) => [t.path, t.type]))
    const missing = needs.filter((n) => !has.has(n.path))
    const wrongType = needs.flatMap((n) => {
      const type = has.get(n.path)
      return type !== undefined && n.type !== undefined && type !== n.type
        ? [{ ...n, has: type }]
        : []
    })
    out.push({
      name,
      dir,
      missing,
      wrongType,
      themes: loaded.manifest.themes.filter((t) => t.attribute === 'theme').map((t) => t.name),
    })
  }
  // Two names for one folder would report the same system twice.
  return out.filter((s, i) => out.findIndex((o) => o.dir === s.dir) === i)
}

export const hasProblems = (fits: SystemFit[]): boolean =>
  fits.some((f) => f.broken || f.missing.length || f.wrongType.length)

/** The report, as lines. */
export function describeFit(fits: SystemFit[]): string[] {
  const lines: string[] = []
  const by = (n: Need) => `(${n.by.join(', ')})`
  for (const fit of fits) {
    if (fit.broken) {
      lines.push(
        `  ${fit.name}: its tokens do not build, so they could not be compared. Run tessera check.`,
      )
      continue
    }
    if (!fit.missing.length && !fit.wrongType.length) {
      lines.push(`  ${fit.name}: has every token the new components use.`)
      continue
    }
    lines.push(`  ${fit.name}:`)
    for (const n of fit.missing)
      lines.push(
        `    missing     ${n.path}${n.type ? ` (a ${n.type})` : ' (not in the reference set)'} ${by(n)}`,
      )
    for (const n of fit.wrongType)
      lines.push(
        `    wrong type  ${n.path} is a ${n.has} here, and the components expect a ${n.type} ${by(n)}`,
      )
  }
  return lines
}

/** Set a token in a nested token document, creating the groups on the way. */
function setToken(doc: Record<string, unknown>, path: string, node: Record<string, unknown>) {
  const keys = path.split('.')
  let at = doc
  for (const key of keys.slice(0, -1)) {
    const next = at[key]
    at = isObject(next) ? next : (at[key] = {})
  }
  at[keys[keys.length - 1]!] = node
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return isObject(parsed) ? parsed : {}
}

function writeJson(path: string, doc: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n')
}

/**
 * Add the missing tokens to a system, with the reference set's values: the base values in `tessera-ui.tokens.json`,
 * and the dark overrides in the system's own `themes/dark.tokens.json`, since a theme file is named for the theme
 * and cannot be split. Returns the files it wrote, relative to `root`, and the tokens it cannot add (the reference
 * set does not define them).
 */
export function addMissingTokens(
  root: string,
  fit: SystemFit,
): { files: string[]; added: string[]; unknown: string[] } {
  const ref = referenceSet()
  const base = readJson(join(fit.dir, FIT_FILE))
  const added: string[] = []
  const unknown: string[] = []
  const themeEdits = new Map<string, Array<[string, unknown]>>()
  for (const need of fit.missing) {
    const type = need.type
    const value = ref.literal(need.path)
    if (type === undefined || value === undefined) {
      unknown.push(need.path)
      continue
    }
    const tier = ref.base.get(need.path)?.tier
    setToken(base, need.path, {
      $type: type,
      $value: value,
      $description: FIT_NOTE,
      ...(tier ? { $extensions: { tessera: { tier } } } : {}),
    })
    added.push(need.path)
    for (const theme of fit.themes) {
      if (ref.themes.get(theme)?.has(need.path)) {
        const edits = themeEdits.get(theme) ?? []
        edits.push([need.path, ref.literal(need.path, theme)])
        themeEdits.set(theme, edits)
      }
    }
  }
  const files: string[] = []
  const rel = (path: string) => relative(root, path).replaceAll('\\', '/')
  if (added.length) {
    writeJson(join(fit.dir, FIT_FILE), base)
    files.push(rel(join(fit.dir, FIT_FILE)))
  }
  for (const [theme, edits] of themeEdits) {
    const file = join(fit.dir, 'themes', `${theme}.tokens.json`)
    if (!existsSync(file)) continue
    const doc = readJson(file)
    for (const [path, value] of edits) setToken(doc, path, { $value: value })
    writeJson(file, doc)
    files.push(rel(file))
  }
  return { files, added, unknown }
}
