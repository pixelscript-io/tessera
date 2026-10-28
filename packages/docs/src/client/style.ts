/** The docs app's own styles. They follow the project's semantic tokens when it has them, and fall back to a built-in look when it does not. */
export const STYLE = `
/* Fallbacks, for a project without tokens (or without these ones). A project's own semantic tokens win, so the docs and the app are styled by the same files. */
:root { color-scheme: light dark; --f-bg: #faf9f6; --f-alt: #f2f0ea; --f-inline: #ece9e1; --f-fg: #17160f; --f-muted: #5e5b53; --f-line: #e2dfd7; --f-primary: #17160f; --f-primary-fg: #faf9f6; --f-accent: oklch(0.55 0.13 155); --f-soft: oklch(0.95 0.035 155); --f-link: oklch(0.45 0.11 155); --f-ok: oklch(0.45 0.11 155); --f-bad: #a1261c; --f-code: #17160f; --f-code-line: #17160f; }
@media (prefers-color-scheme: dark) { :root { --f-bg: #13120e; --f-alt: #1b1a15; --f-inline: #24231c; --f-fg: #edeae2; --f-muted: #a8a497; --f-line: #2c2a22; --f-primary: #edeae2; --f-primary-fg: #17160f; --f-accent: oklch(0.78 0.13 155); --f-soft: oklch(0.28 0.04 155); --f-link: oklch(0.82 0.12 155); --f-ok: oklch(0.82 0.12 155); --f-bad: #ff8a80; --f-code: #1b1a15; --f-code-line: #2c2a22; } }
:root { --d-bg: var(--t-color-surface-default, var(--f-bg)); --d-alt: var(--t-color-surface-raised, var(--f-alt)); --d-inline: var(--t-color-surface-hover, var(--f-inline)); --d-fg: var(--t-color-text-default, var(--f-fg)); --d-muted: var(--t-color-text-muted, var(--f-muted)); --d-line: var(--t-color-border-default, var(--f-line)); --d-primary: var(--t-color-action-primary-bg, var(--f-primary)); --d-primary-fg: var(--t-color-action-primary-fg, var(--f-primary-fg)); --d-accent: var(--t-color-accent-default, var(--t-color-action-primary-bg, var(--f-accent))); --d-soft: var(--t-color-accent-soft, var(--t-color-surface-default, var(--f-soft))); --d-link: var(--t-color-accent-text, var(--t-color-action-primary-text, var(--f-link))); --d-ok: var(--t-color-status-success, var(--f-ok)); --d-bad: var(--t-color-status-danger, var(--f-bad)); --d-r-sm: 4px; --d-r-md: 6px; --d-r-lg: 10px; --d-sans: var(--t-font-family-sans, system-ui, -apple-system, 'Segoe UI', sans-serif); --d-mono: var(--t-font-family-mono, 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace); }
* { box-sizing: border-box; }
html { scroll-padding-top: 72px; }
body { margin: 0; font: 16px/1.65 var(--d-sans); -webkit-font-smoothing: antialiased; background: var(--d-bg); color: var(--d-fg); }
a { color: var(--d-link); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 3px; }
.docs-main p a, .docs-main li a { text-decoration: underline; text-underline-offset: 3px; }
:focus-visible { outline: 2px solid var(--d-accent); outline-offset: 2px; }
h1, h2, h3 { text-wrap: balance; }
.docs-eyebrow { margin: 0 0 14px; font: 500 11px/1 var(--d-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--d-muted); display: flex; align-items: center; gap: 8px; }
.docs-eyebrow::before { content: ''; width: 6px; height: 6px; background: var(--d-accent); }
code, pre { font-family: var(--d-mono); font-size: 13px; }
pre { background: var(--t-color-code-bg, var(--f-code)); color: var(--t-color-code-fg, #e9e6dd); border: 1px solid var(--t-color-code-border, var(--f-code-line)); padding: 16px 20px; line-height: 1.65; border-radius: var(--d-r-md); overflow: auto; margin: 8px 0 16px; }
:not(pre) > code { background: var(--d-inline); padding: 1px 6px; border-radius: var(--d-r-sm); font-size: 12px; }
.docs-top { position: sticky; top: 0; z-index: 10; background: var(--d-bg); border-bottom: 1px solid var(--d-line); }
.docs-head { display: flex; flex-wrap: wrap; gap: 8px 24px; align-items: center; max-width: 1400px; margin: 0 auto; min-height: 56px; padding: 6px 24px; }
.docs-top h1 { display: flex; align-items: center; font-size: 16px; font-weight: 700; letter-spacing: -.01em; margin: 0; flex: 1 1 auto; }
.docs-mark { display: inline-grid; grid-template-columns: repeat(2, 7px); gap: 2px; margin-right: 8px; }
.docs-mark span { width: 7px; height: 7px; background: var(--d-fg); border-radius: 1px; }
.docs-mark span:nth-child(2) { background: var(--d-accent); }
.docs-switch { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 13px; color: var(--d-muted); }
.docs-switch label { display: flex; align-items: center; }
.docs-switch select, .docs-controls select, .docs-controls input[type=text] { font: inherit; font-size: 13px; padding: 4px 8px; background: var(--d-alt); color: var(--d-fg); border: 1px solid var(--d-line); border-radius: var(--d-r-md); }
.docs-switch select { margin-left: 6px; }
.docs-shell { max-width: 1400px; margin: 0 auto; padding: 0 24px; display: grid; grid-template-columns: 240px minmax(0, 1fr) 200px; gap: 40px; align-items: start; }
.docs-shell.no-toc { grid-template-columns: 240px minmax(0, 1fr); }
.docs-nav { position: sticky; top: 56px; max-height: calc(100vh - 56px); overflow-y: auto; padding: 24px 0 32px; background: var(--d-bg); font-size: 14px; line-height: 1.4; }
.docs-nav h2 { font-size: 13px; font-weight: 600; letter-spacing: 0; color: var(--d-fg); margin: 24px 0 6px; padding: 0 10px; }
.docs-nav h2:first-child { margin-top: 0; }
.docs-nav ul { list-style: none; margin: 0; padding: 0; }
.docs-nav a { display: block; padding: 4px 10px; border-radius: var(--d-r-md); text-decoration: none; color: var(--d-muted); }
.docs-nav a:hover { color: var(--d-fg); background: var(--d-alt); text-decoration: none; }
.docs-nav a[aria-current=page] { color: var(--d-fg); font-weight: 600; background: var(--d-alt); }
.docs-main { min-width: 0; padding: 36px 0 96px; }
.docs-main h2 { margin: 48px 0 12px; padding: 0 0 8px; border-bottom: 1px solid var(--d-line); font-size: 1.5rem; font-weight: 600; letter-spacing: -.01em; line-height: 1.3; scroll-margin-top: 72px; }
.docs-main h3 { font-size: 1.15rem; margin: 28px 0 8px; }
.docs-main h1 { margin: 0 0 8px; font-size: 2.25rem; line-height: 1.15; font-weight: 700; letter-spacing: -.02em; }
.docs-main h1 + .docs-lead { margin-top: 0; }
.docs-lead { color: var(--d-muted); margin: 0 0 20px; font-size: 1.1rem; line-height: 1.55; max-width: 640px; text-wrap: pretty; }
.docs-badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 28px; }
.docs-badge { border-radius: 999px; padding: 1px 10px; font-size: 12px; line-height: 1.6; border: 1px solid var(--d-line); background: transparent; color: var(--d-muted); }
.docs-badge.warn { color: var(--d-bad); border-color: var(--d-bad); }
.docs-toc { position: sticky; top: 56px; padding: 36px 0; font-size: 13px; max-height: calc(100vh - 56px); overflow-y: auto; }
.docs-toc h2 { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
.docs-toc ul { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--d-line); }
.docs-toc a { display: block; padding: 3px 0 3px 12px; margin-left: -1px; border-left: 2px solid transparent; color: var(--d-muted); text-decoration: none; }
.docs-toc a:hover { color: var(--d-fg); text-decoration: none; }
.docs-toc a[aria-current=location] { color: var(--d-fg); border-left-color: var(--d-accent); font-weight: 600; }
button.docs-menu-toggle { display: none; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 24px; }
th, td { text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--d-line); vertical-align: top; font-size: 14px; }
tr:last-child > td { border-bottom: 0; }
th { color: var(--d-muted); font-weight: 600; font-size: 13px; }
.docs-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 12px 0; }
.docs-card { border: 1px solid var(--d-line); border-radius: var(--d-r-md); padding: 18px 20px; background: var(--d-bg); }
.docs-card b { display: block; font-size: 30px; font-weight: 500; letter-spacing: -.025em; line-height: 1.2; }
.docs-card span { color: var(--d-muted); font: 400 11px/1.4 var(--d-mono); letter-spacing: .06em; text-transform: uppercase; }
.docs-demo { margin: 12px 0 8px; border: 1px solid var(--d-line); border-radius: var(--d-r-lg); overflow: hidden; background: var(--d-alt); }
.docs-demo-bar { display: flex; align-items: center; gap: 4px; padding: 0 8px; border-bottom: 1px solid var(--d-line); background: var(--d-bg); }
.docs-demo-bar [role=tab] { font: inherit; font-size: 14px; padding: 9px 14px; margin-bottom: -1px; color: var(--d-muted); background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer; }
.docs-demo-bar [role=tab]:hover { color: var(--d-fg); }
.docs-demo-bar [role=tab][aria-selected=true] { color: var(--d-fg); font-weight: 600; border-bottom-color: var(--d-accent); }
.docs-demo-bar .docs-demo-hint { margin-left: auto; padding-right: 8px; font-size: 12px; color: var(--d-muted); }
.docs-stage { padding: 48px 28px; min-height: 220px; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px; background-color: var(--t-color-surface-default, #fff); color: var(--t-color-text-default, #17202a); }
/* A block-level component (a group, a form, a field) is as wide as a column of content; an inline one (a button, a key) is as wide as it is. */
.docs-stage > :where(div, form, label, section, fieldset) { width: 100%; max-width: 28rem; }
.docs-stage.parts [class] { outline: 1px dashed #d6336c; outline-offset: 1px; }
.docs-stage .docs-error { color: #a1261c; font-family: ui-monospace, monospace; white-space: pre-wrap; }
.docs-controls { padding: 14px 16px 16px; background: var(--d-bg); border-top: 1px solid var(--d-line); display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 16px; align-items: end; font-size: 13px; }
.docs-controls label { display: grid; gap: 4px; font-size: 12px; font-weight: 600; color: var(--d-muted); }
.docs-controls label select, .docs-controls label input[type=text], .docs-controls label input[type=number] { font: 400 13px/1.4 var(--d-sans); color: var(--d-fg); width: 100%; }
.docs-controls label:has(> span > input[type=checkbox]) { align-self: center; }
.docs-controls label > span { display: flex; align-items: center; gap: 8px; }
.docs-controls .docs-primary { grid-column: 1 / -1; justify-self: start; }
.docs-events-box { grid-column: 1 / -1; font-size: 13px; }
.docs-events-box summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--d-muted); }
.docs-events { margin: 8px 0 0; padding-left: 18px; max-height: 110px; overflow: auto; }
.docs-code { position: relative; background: var(--t-color-code-bg, var(--f-code)); }
.docs-code pre { margin: 0; border: 0; border-radius: 0; max-height: 360px; min-height: 140px; }
.docs-code button.docs-button { position: absolute; top: 8px; right: 10px; background: var(--d-bg); }
.docs-live { border: 1px solid var(--d-line); border-radius: var(--d-r-md); padding: 28px 24px; margin: 12px 0 4px; background-image: radial-gradient(var(--d-line) 1px, transparent 1px); background-size: 16px 16px; background-color: var(--t-color-surface-default, #fff); color: var(--t-color-text-default, #17202a); }
.docs-note { margin: 10px 0 0; padding: 10px 14px; border: 1px dashed var(--d-line); border-radius: var(--d-r-md); color: var(--d-muted); font-size: 13px; }
.docs-controls input[type=number] { font: inherit; padding: 5px 8px; background: var(--d-alt); color: var(--d-fg); border: 1px solid var(--d-line); border-radius: var(--d-r-md); }
.docs-prose h1 { margin: 0 0 12px; font-size: 20px; line-height: 1.3; letter-spacing: -.015em; }
.docs-live > div > * + * { margin-top: 24px; }
.docs-swatch { display: inline-block; width: 22px; height: 22px; border-radius: var(--d-r-sm); border: 1px solid var(--d-line); vertical-align: middle; margin-right: 8px; }
.docs-bar { display: inline-block; height: 10px; background: var(--d-accent); border-radius: var(--d-r-sm); vertical-align: middle; margin-right: 8px; }
.docs-shadow { display: inline-block; width: 44px; height: 26px; border-radius: var(--d-r-sm); background: var(--d-bg); vertical-align: middle; margin-right: 8px; }
.docs-pass { color: var(--d-ok); font-weight: 600; }
.docs-fail { color: var(--d-bad); font-weight: 600; }
.docs-muted { color: var(--d-muted); }
.docs-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.docs-tools input[type=search] { font: inherit; font-size: 13px; padding: 5px 10px; border: 1px solid var(--d-line); border-radius: var(--d-r-md); background: var(--d-alt); color: var(--d-fg); min-width: 220px; }
.docs-controls input[type=checkbox] { appearance: none; width: 14px; height: 14px; margin: 0; border: 1px solid var(--d-muted); border-radius: var(--d-r-sm); background: var(--d-bg); }
.docs-controls input[type=checkbox]:checked { background: var(--d-fg); box-shadow: inset 0 0 0 2px var(--d-bg); border-color: var(--d-fg); }
button.docs-button { font: inherit; font-size: 13px; padding: 5px 12px; border: 1px solid var(--d-line); border-radius: var(--d-r-md); background: transparent; color: var(--d-fg); cursor: pointer; }
button.docs-button:hover { background: var(--d-alt); border-color: var(--d-accent); }
.docs-editbar { border: 1px solid var(--d-line); padding: 14px 16px; margin: 0 0 20px; border-radius: var(--d-r-lg); background: var(--d-soft); font-size: 14px; }
fieldset { border: 1px solid var(--d-line); border-radius: var(--d-r-lg); margin: 14px 0; padding: 8px 16px 16px; }
legend { font-weight: 600; padding: 0 6px; font-size: 14px; }
.docs-field { display: grid; gap: 3px; margin: 10px 0; max-width: 560px; }
.docs-field label { font-size: 13px; color: var(--d-muted); }
.docs-field input[type=text], .docs-field input[type=file], .docs-field textarea, .docs-field select { font: inherit; padding: 6px 10px; background: var(--d-alt); color: var(--d-fg); border: 1px solid var(--d-line); border-radius: var(--d-r-md); width: 100%; }
button.docs-primary, button.docs-primary:hover { background: var(--d-primary); color: var(--d-primary-fg); border-color: var(--d-primary); font-weight: 500; }
button.docs-button:disabled { opacity: .5; cursor: not-allowed; }
.docs-error-line { color: var(--d-bad); margin: 6px 0; }
.docs-plan { border: 1px solid var(--d-line); border-radius: var(--d-r-lg); padding: 4px 18px 16px; margin: 14px 0; background: var(--d-bg); }
.docs-plan h3 { margin: 12px 0 6px; font-size: 17px; font-weight: 600; }
.docs-plan h4 { margin: 12px 0 4px; font-size: 14px; font-weight: 600; }
.docs-plan-block { border: 1px solid var(--d-bad); border-left-width: 6px; border-radius: var(--d-r-md); padding: 8px 12px; margin: 8px 0; }
.docs-plan-breaking { border-left: 6px solid var(--d-bad); padding-left: 10px; }
.docs-plan-additive { border-left: 6px solid var(--d-ok); padding-left: 10px; }
.docs-plan-cosmetic { border-left: 6px solid var(--d-line); padding-left: 10px; }
.docs-diff { margin: 6px 0; max-height: 420px; overflow: auto; }
.docs-diff span { display: inline; white-space: pre; }
.docs-diff-add { background: rgba(80, 200, 130, .22); }
.docs-diff-del { background: rgba(240, 100, 90, .24); }
.docs-diff-skip { color: #a8a497; }
.docs-diff-file summary { cursor: pointer; }
@media (max-width: 1100px) { .docs-shell { grid-template-columns: 240px minmax(0, 1fr); } .docs-toc { display: none; } }
@media (max-width: 860px) { .docs-shell, .docs-shell.no-toc { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 0 16px; } .docs-head { padding: 6px 16px; } button.docs-menu-toggle { display: inline-block; } .docs-nav { display: none; position: static; max-height: none; padding: 12px 0 16px; border-bottom: 1px solid var(--d-line); } .docs-nav.open { display: block; } .docs-main { padding: 24px 0 64px; } .docs-main h1 { font-size: 1.8rem; } .docs-stage { padding: 28px 12px; } }
`
