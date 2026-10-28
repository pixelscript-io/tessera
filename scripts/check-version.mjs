/* global console, process */
// Run by `prepublishOnly` in every published package: Tessera has not declared 1.0, so a version that is not 0.MINOR.PATCH
// stops the publish. There is no flag to skip this. Declaring 1.0 is the author's decision; it means changing this file.
//
// It also stops `npm publish` of a package whose dependencies use `workspace:` ranges: only `pnpm publish` rewrites them to
// real versions, and a package published with them cannot be installed (0.9.0 of create-tessera was).
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const { name, version } = manifest
if (!/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  console.error(
    `Refusing to publish ${name}@${version}. Tessera stays at 0.MINOR.PATCH until the author declares 1.0 (SPEC.md, "Versioning"). ` +
      'Use the next minor, such as 0.10.0 after 0.9.0, not 1.0.0.',
  )
  process.exit(1)
}

const workspace = ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) =>
  Object.entries(manifest[field] ?? {})
    .filter(([, range]) => String(range).startsWith('workspace:'))
    .map(([dependency]) => dependency),
)
if (workspace.length && /^npm\//.test(process.env.npm_config_user_agent ?? '')) {
  console.error(
    `Refusing to publish ${name}@${version} with npm: ${workspace.join(', ')} ${workspace.length === 1 ? 'is' : 'are'} a workspace: range, ` +
      'which only pnpm rewrites to a version. Run `pnpm publish --access public` instead.',
  )
  process.exit(1)
}
