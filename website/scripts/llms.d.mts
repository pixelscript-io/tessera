export function docPages(contentDir: string): string[]
export function buildLlms(options: { contentDir: string; version?: string; base?: string }): {
  index: string
  full: string
  pages: string[]
}
