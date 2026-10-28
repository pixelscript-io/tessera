import { relative } from 'node:path'
import type { TokenManifest } from '@tessera/tokens'

/**
 * A token a theme sets for itself does not follow the base. When one of those changes in the base, the theme still shows
 * the old value, which looks like the change did not work. Compare the manifest from before a change with the one after
 * it, and say so for each such token (a theme that changed it too, or that does not set it, is left out).
 */
export function themeOverrideNotes(
  before: TokenManifest,
  after: TokenManifest,
  root: string,
): string[] {
  const was = new Map(before.tokens.map((t) => [t.path, t]))
  const notes: string[] = []
  for (const token of after.tokens) {
    const old = was.get(token.path)
    const base = token.values['base']
    const baseWas = old?.values['base']
    if (!old || !base || !baseWas || base.resolved === baseWas.resolved) continue
    for (const theme of after.themes) {
      if (!theme.overrides.includes(token.path)) continue
      const scope = `${theme.attribute}=${theme.name}`
      const now = token.values[scope]
      const then = old.values[scope]
      // The theme changed with the base, so it is not left behind.
      if (!now || (then && then.resolved !== now.resolved)) continue
      notes.push(
        `${token.path} changed, but the ${theme.name} theme sets its own value in ${relative(root, theme.file).replaceAll('\\', '/')}, so ${theme.name} still shows ${now.alias ?? now.resolved}. Change it there too.`,
      )
    }
  }
  return notes
}
