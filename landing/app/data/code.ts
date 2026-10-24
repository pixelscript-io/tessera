/** The code shown on the page, and how it is colored. Color is a `kind`; the component maps each kind to a token. */

export type Kind = 'str' | 'key' | 'tok' | 'tag' | 'com' | 'err' | ''

export interface Segment {
  text: string
  kind: Kind
}

export interface CodeLine {
  segs: Segment[]
}

export interface CodePane {
  lines: CodeLine[]
}

export type TabId = 'contract' | 'check' | 'mcp'

export const CODE_TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'contract', label: 'Badge.tess' },
  { id: 'check', label: 'tessera check' },
  { id: 'mcp', label: 'tessera mcp' },
]

const CODE: Record<TabId, string[]> = {
  contract: [
    `<contract>
{
  "name": "Badge",
  "role": "status",
  "parts": ["root"],
  "variants": { "tone": ["neutral", "success", "danger"] },
  "slots": { "default": "label" }
}
</contract>

<template>
  <span class="root"><slot /></span>
</template>`,
    `<style>
.root {
  padding: $space.1 $space.2;
  border-radius: $radius.md;
  background: $color.surface.raised;
  color: $color.text.default;
}
</style>

// From this file the compiler knows what
// <Badge tone="success"> may be, and that
// tone="sucess" is wrong.`,
  ],
  check: [
    `$ npx tessera check

ERROR  T4008  app/pages/index.tess:5:18
  Badge.tone has no value "sucess".
  Did you mean "success"?

ERROR  T2102  app/components/Note.tess:14:12
  Raw length "13px" in "padding" is off the scale.
  Did you mean "$space.3" (12px)? Or write raw(13px, "reason").

$ npx tessera check --fix`,
  ],
  mcp: [
    `// .mcp.json
{
  "mcpServers": {
    "tessera": { "command": "npx", "args": ["tessera", "mcp"] }
  }
}`,
    `→ resolve_value  padding: "13px"
← Use $space.3 (12px) or $space.4 (16px)

→ validate_snippet  <Button tone="dangr">
← T4008 Button.tone has no value "dangr".
  Did you mean "danger"?`,
  ],
}

const TOKENS =
  /(\/\/.*$)|("(?:[^"\\]|\\.)*")(\s*:)?|(\$[a-z][\w.]*)|(<\/?[A-Za-z][\w-]*|\/?>)|(\bERROR\b)|(\bT\d{4}\b)|(^\$ |^→|^←)/g

/** Split a line into pieces with a color kind each. */
export function highlight(line: string): CodeLine {
  const segs: Segment[] = []
  const push = (text: string, kind: Kind = '') => {
    if (text) segs.push({ text, kind })
  }
  let last = 0
  for (const m of line.matchAll(TOKENS)) {
    push(line.slice(last, m.index))
    if (m[1]) push(m[1], 'com')
    else if (m[2]) {
      push(m[2], m[3] ? 'key' : 'str')
      if (m[3]) push(m[3])
    } else if (m[4]) push(m[4], 'tok')
    else if (m[5]) push(m[5], 'tag')
    else if (m[6]) push(m[6], 'err')
    else if (m[7]) push(m[7], 'tag')
    else if (m[8]) push(m[8], 'com')
    last = m.index + m[0].length
  }
  push(line.slice(last))
  return { segs }
}

export const PANES: Record<TabId, CodePane[]> = Object.fromEntries(
  Object.entries(CODE).map(([id, panes]) => [
    id,
    panes.map((source) => ({ lines: source.split('\n').map(highlight) })),
  ]),
) as Record<TabId, CodePane[]>

export const QUICK_COMMAND = [
  '$ npm create @pixelscriptio/tessera@latest my-app',
  '$ cd my-app && npm install',
  '$ npm run dev',
].join('\n')
export const DOCS_COMMAND = ['$ npx tessera docs', '$ npx tessera docs --static'].join('\n')
