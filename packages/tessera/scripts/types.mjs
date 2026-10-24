// Type declarations for the published package. TypeScript emits declarations for every internal package the
// entries reach, which import each other as `@tessera/*`. Those names do not exist for a user, so rewrite each
// to a relative path to the emitted file, then add one declaration per public entry where `exports` expects it.
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')
const repo = join(pkg, '..', '..')
const out = join(pkg, 'dist', 'types')

rmSync(out, { recursive: true, force: true })
execFileSync(
  process.execPath,
  [join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(pkg, 'tsconfig.dts.json')],
  {
    stdio: 'inherit',
  },
)

/** Where an internal package's entry for a specifier lives, as a path without extension under dist/types. */
function target(spec) {
  const [, name, ...sub] = spec.split('/')
  const dir = join(repo, 'packages', name)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const key = sub.length ? `./${sub.join('/')}` : '.'
  let entry = manifest.exports?.[key] ?? (key === '.' ? manifest.main : undefined)
  if (entry && typeof entry === 'object') entry = entry.types ?? entry.default
  if (!entry) throw new Error(`no entry for ${spec}`)
  return join(out, 'packages', name, entry.replace(/^\.\//, '').replace(/\.ts$/, ''))
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.d.ts') ? [p] : []
  })
}

for (const file of walk(out)) {
  const text = readFileSync(file, 'utf8')
  const next = text.replace(/(['"])(@tessera\/[a-z0-9]+(?:\/[a-z/-]+)?)\1/g, (_, q, spec) => {
    let rel = relative(dirname(file), target(spec)).replaceAll('\\', '/')
    if (!rel.startsWith('.')) rel = `./${rel}`
    return `${q}${rel}${q}`
  })
  if (next !== text) writeFileSync(file, next)
}

process.stdout.write('Built the type declarations.\n')
