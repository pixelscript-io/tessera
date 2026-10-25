// The language guide that goes into AGENTS.md: how a .tess file, a page, data and shared state are written. It is
// Markdown in a file of its own, so it is read and edited as Markdown, and the tests compile its samples.
const FILES = import.meta.glob('./agent-guide.md', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>

export const AGENT_GUIDE: string = FILES['./agent-guide.md']!
