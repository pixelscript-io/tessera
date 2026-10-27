/** The docs app's own styles. They follow the project's semantic tokens when it has them, and fall back to a built-in look when it does not. */
export const STYLE = `
/* Fallbacks, for a project without tokens (or without these ones). A project's own semantic tokens win, so the docs and the app are styled by the same files. */
:root { color-scheme: light dark; --f-bg: #faf9f6; --f-alt: #f2f0ea; --f-inline: #ece9e1; --f-fg: #17160f; --f-muted: #5e5b53; --f-line: #e2dfd7; --f-primary: #17160f; --f-primary-fg: #faf9f6; --f-accent: oklch(0.55 0.13 155); --f-soft: oklch(0.95 0.035 155); --f-link: oklch(0.45 0.11 155); --f-ok: oklch(0.45 0.11 155); --f-bad: #a1261c; --f-code: #17160f; --f-code-line: #17160f; }
@media (prefers-color-scheme: dark) { :root { --f-bg: #13120e; --f-alt: #1b1a15; --f-inline: #24231c; --f-fg: #edeae2; --f-muted: #a8a497; --f-line: #2c2a22; --f-primary: #edeae2; --f-primary-fg: #17160f; --f-accent: oklch(0.78 0.13 155); --f-soft: oklch(0.28 0.04 155); --f-link: oklch(0.82 0.12 155); --f-ok: oklch(0.82 0.12 155); --f-bad: #ff8a80; --f-code: #1b1a15; --f-code-line: #2c2a22; } }
:root { --d-bg: var(--t-color-surface-default, var(--f-bg)); --d-alt: var(--t-color-surface-raised, var(--f-alt)); --d-inline: var(--t-color-surface-hover, var(--f-inline)); --d-fg: var(--t-color-text-default, var(--f-fg)); --d-muted: var(--t-color-text-muted, var(--f-muted)); --d-line: var(--t-color-border-default, var(--f-line)); --d-primary: var(--t-color-action-primary-bg, var(--f-primary)); --d-primary-fg: var(--t-color-action-primary-fg, var(--f-primary-fg)); --d-accent: var(--t-color-accent-default, var(--t-color-action-primary-bg, var(--f-accent))); --d-soft: var(--t-color-accent-soft, var(--t-color-surface-default, var(--f-soft))); --d-link: var(--t-color-accent-text, var(--t-color-action-primary-text, var(--f-link))); --d-ok: var(--t-color-status-success, var(--f-ok)); --d-bad: var(--t-color-status-danger, var(--f-bad)); --d-r-sm: var(--t-radius-sm, 2px); --d-r-md: var(--t-radius-md, 3px); --d-r-lg: var(--t-radius-lg, 4px); --d-sans: var(--t-font-family-sans, 'Instrument Sans', ui-sans-serif, system-ui, sans-serif); --d-mono: var(--t-font-family-mono, 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace); }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.65 var(--d-sans); font-feature-settings: 'ss01', 'cv11'; -webkit-font-smoothing: antialiased; background: var(--d-bg); color: var(--d-fg); }
a { color: var(--d-link); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 3px; }
:focus-visible { outline: 2px solid var(--d-accent); outline-offset: 2px; }
h1, h2, h3 { text-wrap: balance; }
.docs-eyebrow { margin: 0 0 14px; font: 500 11px/1 var(--d-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--d-muted); display: flex; align-items: center; gap: 8px; }
.docs-eyebrow::before { content: ''; width: 6px; height: 6px; background: var(--d-accent); }
code, pre { font-family: var(--d-mono); font-size: 13px; }
pre { background: var(--t-color-code-bg, var(--f-code)); color: var(--t-color-code-fg, #e9e6dd); border: 1px solid var(--t-color-code-border, var(--f-code-line)); padding: 16px 20px; line-height: 1.65; border-radius: var(--d-r-md); overflow: auto; margin: 8px 0 16px; }
:not(pre) > code { background: var(--d-inline); padding: 1px 6px; border-radius: var(--d-r-sm); font-size: 12px; }
.docs-top { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; min-height: 56px; padding: 8px 24px; border-bottom: 1px solid var(--d-line); position: sticky; top: 0; background: var(--d-bg); z-index: 2; }
.docs-top h1 { display: flex; align-items: center; font-size: 14px; font-weight: 600; letter-spacing: -.005em; margin: 0; flex: 1 1 auto; }
.docs-mark { display: inline-grid; grid-template-columns: repeat(2, 7px); gap: 2px; margin-right: 8px; }
.docs-mark span { width: 7px; height: 7px; background: var(--d-fg); border-radius: 1px; }
.docs-mark span:nth-child(2) { background: var(--d-accent); }
.docs-switch { display: flex; gap: 8px; align-items: center; font: 500 11px/1 var(--d-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--d-muted); }
.docs-switch select, .docs-controls select, .docs-controls input[type=text] { font: inherit; padding: 5px 8px; background: var(--d-alt); color: var(--d-fg); border: 1px solid var(--d-line); border-radius: var(--d-r-md); }
.docs-shell { display: grid; grid-template-columns: 260px minmax(0, 1fr); align-items: start; }
.docs-nav { position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto; padding: 20px 16px 48px 20px; background: var(--d-bg); border-right: 1px solid var(--d-line); font-size: 13px; line-height: 1.4; }
.docs-nav h2 { font: 500 11px/1 var(--d-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--d-muted); margin: 28px 0 8px 10px; }
.docs-nav h2:first-child { margin-top: 4px; }
.docs-nav ul { list-style: none; margin: 0; padding: 0; }
.docs-nav a { display: block; padding: 5px 10px; border-left: 2px solid transparent; text-decoration: none; color: var(--d-muted); }
.docs-nav a:hover { color: var(--d-fg); border-left-color: var(--d-line); }
.docs-nav a[aria-current=page] { color: var(--d-fg); font-weight: 600; border-left-color: var(--d-accent); background: var(--d-alt); }
.docs-main { padding: 48px 40px 112px; max-width: 1040px; }
.docs-main h2 { margin: 56px 0 16px; padding-top: 24px; border-top: 1px solid var(--d-line); font-size: 20px; font-weight: 500; letter-spacing: -.015em; line-height: 1.3; scroll-margin-top: 80px; }
.docs-main h1 { margin: 0 0 14px; font-size: 40px; line-height: 1.05; font-weight: 500; letter-spacing: -.03em; }
.docs-main h1 + .docs-lead { margin-top: 0; }
.docs-lead { color: var(--d-muted); margin: 0 0 18px; font-size: 17px; line-height: 1.55; max-width: 60ch; text-wrap: pretty; }
.docs-badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 32px; }
.docs-badge { border-radius: var(--d-r-sm); padding: 3px 8px; font: 400 11px/1.4 var(--d-mono); border: 1px solid var(--d-line); background: transparent; color: var(--d-muted); }
.docs-badge.warn { background: transparent; color: var(--d-bad); box-shadow: inset 0 0 0 1px var(--d-bad); }
table { border-collapse: collapse; width: 100%; margin: 6px 0 24px; }
th, td { text-align: left; padding: 10px 16px 10px 0; border-bottom: 1px solid var(--d-line); vertical-align: top; font-size: 13px; }
tr:last-child > td { border-bottom: 0; }
th { color: var(--d-muted); font: 500 11px/1.4 var(--d-mono); letter-spacing: .06em; text-transform: uppercase; border-bottom-color: var(--d-fg); }
.docs-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 12px 0; }
.docs-card { border: 1px solid var(--d-line); border-radius: var(--d-r-md); padding: 18px 20px; background: var(--d-bg); }
.docs-card b { display: block; font-size: 30px; font-weight: 500; letter-spacing: -.025em; line-height: 1.2; }
.docs-card span { color: var(--d-muted); font: 400 11px/1.4 var(--d-mono); letter-spacing: .06em; text-transform: uppercase; }
.docs-preview { display: grid; grid-template-columns: minmax(0, 1fr) 240px; border: 1px solid var(--d-line); border-radius: var(--d-r-md); overflow: hidden; }
.docs-stage { padding: 40px 28px; min-height: 240px; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px; background-color: var(--t-color-surface-default, #fff); background-image: radial-gradient(var(--d-line) 1px, transparent 1px); background-size: 16px 16px; color: var(--t-color-text-default, #17202a); }
.docs-stage.parts [class] { outline: 1px dashed #d6336c; outline-offset: 1px; }
.docs-stage .docs-error { color: #a1261c; font-family: ui-monospace, monospace; white-space: pre-wrap; }
.docs-controls { padding: 16px 18px; background: var(--d-bg); border-left: 1px solid var(--d-line); display: grid; gap: 12px; align-content: start; font-size: 13px; }
.docs-controls label { display: grid; gap: 4px; font: 500 11px/1.2 var(--d-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--d-muted); }
.docs-controls label select, .docs-controls label input[type=text] { font: 400 13px/1.4 var(--d-sans); letter-spacing: 0; text-transform: none; color: var(--d-fg); }
.docs-controls h3 { margin: 0; font: 500 11px/1 var(--d-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--d-fg); }
.docs-events { margin: 0; padding-left: 18px; max-height: 110px; overflow: auto; }
.docs-live { border: 1px solid var(--d-line); border-radius: var(--d-r-md); padding: 28px 24px; margin: 12px 0 4px; background-image: radial-gradient(var(--d-line) 1px, transparent 1px); background-size: 16px 16px; background-color: var(--t-color-surface-default, #fff); color: var(--t-color-text-default, #17202a); }
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
@media (max-width: 760px) { .docs-shell { grid-template-columns: 1fr; } .docs-nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--d-line); } .docs-main { padding: 28px 16px 64px; } .docs-preview { grid-template-columns: 1fr; } .docs-controls { border-left: 0; border-top: 1px solid var(--d-line); } }
`
