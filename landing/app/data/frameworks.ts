import { highlight, type CodePane } from './code'

/** How to use the built elements (`npx tessera elements`, into `dist-elements/`) in each kind of project. */

export type FrameworkId = 'html' | 'react' | 'vue' | 'svelte' | 'angular'

export const FRAMEWORK_TABS: ReadonlyArray<{ id: FrameworkId; label: string }> = [
  { id: 'html', label: 'HTML' },
  { id: 'react', label: 'React' },
  { id: 'vue', label: 'Vue' },
  { id: 'svelte', label: 'Svelte' },
  { id: 'angular', label: 'Angular' },
]

const SNIPPETS: Record<FrameworkId, string[]> = {
  html: [
    `<link rel="stylesheet" href="elements.css" />
<script type="module" src="elements.js"></script>`,
    `<t-button tone="danger">Delete</t-button>
<t-checkbox checked>Send me product news</t-checkbox>`,
  ],
  react: [
    `// The wrappers are in the folder: no JSX plugin, no build step.
import { Button, Checkbox } from "./dist-elements/react.js"
import "./dist-elements/elements.css"`,
    `<Button tone="danger" onPress={save}>Delete</Button>
<Checkbox checked={agreed} onToggle={toggle}>
  Send me product news
</Checkbox>`,
  ],
  vue: [
    `// main.ts: tell Vue the t- tags are not Vue components
import "./dist-elements/elements.js"
import "./dist-elements/elements.css"

app.config.compilerOptions.isCustomElement =
  (tag) => tag.startsWith("t-")`,
    `<t-button tone="danger" @press="save">Delete</t-button>
<t-checkbox :checked="agreed">
  Send me product news
</t-checkbox>`,
  ],
  svelte: [
    `<script>
  // Svelte treats t-button like any other element.
  import "./dist-elements/elements.js"
  import "./dist-elements/elements.css"
</script>`,
    `<t-button tone="danger">Delete</t-button>
<t-checkbox checked>Send me product news</t-checkbox>`,
  ],
  angular: [
    `// main.ts
import "./dist-elements/elements.js"

// In the component (or module) that uses them:
schemas: [CUSTOM_ELEMENTS_SCHEMA]

// angular.json, "styles":
// "dist-elements/elements.css"`,
    `<t-button tone="danger" (press)="save()">Delete</t-button>
<t-checkbox checked>Send me product news</t-checkbox>`,
  ],
}

export const FRAMEWORK_PANES: Record<FrameworkId, CodePane[]> = Object.fromEntries(
  Object.entries(SNIPPETS).map(([id, panes]) => [
    id,
    panes.map((source) => ({ lines: source.split('\n').map(highlight) })),
  ]),
) as Record<FrameworkId, CodePane[]>
