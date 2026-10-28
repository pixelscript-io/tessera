/* global console, process */
// Run by `prepublishOnly` in every published package: Tessera has not declared 1.0, so a version that is not 0.MINOR.PATCH
// stops the publish. There is no flag to skip this. Declaring 1.0 is the author's decision; it means changing this file.
import { readFileSync } from 'node:fs'

const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'))
if (!/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  console.error(
    `Refusing to publish ${name}@${version}. Tessera stays at 0.MINOR.PATCH until the author declares 1.0 (SPEC.md, "Versioning"). ` +
      'Use the next minor, such as 0.10.0 after 0.9.0, not 1.0.0.',
  )
  process.exit(1)
}
