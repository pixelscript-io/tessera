/** The docs app's own styles. They follow the project's semantic tokens when it has them, and fall back to a built-in look when it does not. */
export const STYLE = `
/* Fallbacks, for a project without tokens (or without these ones). A project's own semantic tokens win, so the docs and the app are styled by the same files. */
:root { color-scheme: light dark; --f-bg: #f0f2ed; --f-fg: #0a0a0a; --f-muted: #55584f; --f-line: #d3d6cc; --f-panel: #e7eae1; --f-accent: #0a0a0a; --f-accent-fg: #f0f2ed; --f-ok: #0f6b3c; --f-bad: #a1261c; }
@media (prefers-color-scheme: dark) { :root { --f-bg: #0a0a0a; --f-fg: #f0f2ed; --f-muted: #a6aaa0; --f-line: #2a2c28; --f-panel: #161715; --f-accent: #f0f2ed; --f-accent-fg: #0a0a0a; --f-ok: #66d19e; --f-bad: #ff8a80; } }
:root { --d-bg: var(--t-color-surface-default, var(--f-bg)); --d-fg: var(--t-color-text-default, var(--f-fg)); --d-muted: var(--t-color-text-muted, var(--f-muted)); --d-line: var(--t-color-border-default, var(--f-line)); --d-panel: var(--t-color-surface-hover, var(--f-panel)); --d-accent: var(--t-color-action-primary-bg, var(--f-accent)); --d-accent-fg: var(--t-color-action-primary-fg, var(--f-accent-fg)); --d-ok: var(--t-color-status-success, var(--f-ok)); --d-bad: var(--t-color-status-danger, var(--f-bad)); --d-radius: var(--t-radius-sm, 2px); --d-sans: var(--t-font-family-sans, ui-sans-serif, system-ui, sans-serif); --d-mono: var(--t-font-family-mono, ui-monospace, Menlo, Consolas, monospace); }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.6 var(--d-sans); -webkit-font-smoothing: antialiased; background: var(--d-bg); color: var(--d-fg); }
a { color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
a:hover { text-decoration-thickness: 2px; }
code, pre { font-family: var(--d-mono); font-size: 13px; }
pre { background: var(--d-panel); padding: 12px; border-radius: var(--d-radius); overflow: auto; margin: 8px 0; }
:not(pre) > code { background: var(--d-panel); padding: 1px 5px; border-radius: var(--d-radius); }
.docs-top { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; padding: 14px 28px; border-bottom: 1px solid var(--d-line); position: sticky; top: 0; background: var(--d-bg); z-index: 2; }
.docs-top h1 { font-size: 17px; font-weight: 500; letter-spacing: -.01em; margin: 0; flex: 1 1 auto; }
.docs-switch { display: flex; gap: 6px; align-items: center; font-size: 13px; }
.docs-switch select, .docs-controls select, .docs-controls input[type=text] { font: inherit; padding: 3px 6px; background: var(--d-bg); color: var(--d-fg); border: 1px solid var(--d-line); border-radius: var(--d-radius); }
.docs-shell { display: grid; grid-template-columns: 230px minmax(0, 1fr); }
.docs-nav { padding: 24px 16px 40px 28px; border-right: 1px solid var(--d-line); min-height: calc(100vh - 54px); }
.docs-nav h2 { font-size: 12px; font-weight: 500; color: var(--d-muted); margin: 22px 0 4px; }
.docs-nav ul { list-style: none; margin: 0; padding: 0; }
.docs-nav a { display: block; padding: 3px 8px; border-radius: var(--d-radius); text-decoration: none; color: inherit; }
.docs-nav a:hover { background: var(--d-panel); }
.docs-nav a[aria-current=page] { background: var(--d-panel); font-weight: 500; box-shadow: inset 2px 0 var(--d-accent); }
.docs-main { padding: 36px 40px 80px; max-width: 1100px; }
.docs-main h2 { margin: 36px 0 10px; font-size: 20px; font-weight: 500; letter-spacing: -.02em; }
.docs-main h1 { margin: 0 0 8px; font-size: 40px; line-height: 1.1; font-weight: 500; letter-spacing: -.03em; }
.docs-lead { color: var(--d-muted); margin: 0 0 16px; font-size: 17px; max-width: 62ch; }
.docs-badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 14px; }
.docs-badge { border: 1px solid var(--d-line); border-radius: var(--d-radius); padding: 1px 10px; font-size: 12px; color: var(--d-muted); }
.docs-badge.warn { color: var(--d-bad); border-color: var(--d-bad); }
table { border-collapse: collapse; width: 100%; margin: 6px 0 12px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--d-line); vertical-align: top; font-size: 14px; }
th { color: var(--d-muted); font-weight: 500; font-size: 13px; }
.docs-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 12px 0; }
.docs-card { border: 1px solid var(--d-line); border-radius: var(--d-radius); padding: 16px 18px; background: transparent; }
.docs-card b { display: block; font-size: 32px; font-weight: 500; letter-spacing: -.03em; }
.docs-card span { color: var(--d-muted); font-size: 13px; }
.docs-preview { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 12px; border: 1px solid var(--d-line); border-radius: var(--d-radius); overflow: hidden; }
.docs-stage { padding: 28px; min-height: 120px; display: flex; align-items: center; justify-content: center; background: var(--t-color-surface-default, #fff); color: var(--t-color-text-default, #17202a); }
.docs-stage.parts [class] { outline: 1px dashed #d6336c; outline-offset: 1px; }
.docs-stage .docs-error { color: #a1261c; font-family: ui-monospace, monospace; white-space: pre-wrap; }
.docs-controls { padding: 12px 14px; background: var(--d-panel); border-left: 1px solid var(--d-line); display: grid; gap: 10px; align-content: start; font-size: 13px; }
.docs-controls label { display: grid; gap: 3px; }
.docs-controls h3 { margin: 0; font-size: 13px; font-weight: 500; color: var(--d-muted); }
.docs-events { margin: 0; padding-left: 18px; max-height: 110px; overflow: auto; }
.docs-live { border: 1px solid var(--d-line); border-radius: var(--d-radius); padding: 20px; margin: 10px 0 4px; background: var(--t-color-surface-default, #fff); color: var(--t-color-text-default, #17202a); }
.docs-swatch { display: inline-block; width: 22px; height: 22px; border-radius: var(--d-radius); border: 1px solid var(--d-line); vertical-align: middle; margin-right: 8px; }
.docs-bar { display: inline-block; height: 10px; background: var(--d-accent); border-radius: var(--d-radius); vertical-align: middle; margin-right: 8px; }
.docs-shadow { display: inline-block; width: 44px; height: 26px; border-radius: 4px; background: var(--d-bg); vertical-align: middle; margin-right: 8px; }
.docs-pass { color: var(--d-ok); font-weight: 500; }
.docs-fail { color: var(--d-bad); font-weight: 500; }
.docs-muted { color: var(--d-muted); }
.docs-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.docs-tools input[type=search] { font: inherit; padding: 4px 8px; border: 1px solid var(--d-line); border-radius: var(--d-radius); background: var(--d-bg); color: var(--d-fg); min-width: 220px; }
button.docs-button { font: inherit; padding: 4px 12px; border: 1px solid var(--d-fg); border-radius: var(--d-radius); background: transparent; color: var(--d-fg); cursor: pointer; }
button.docs-button:hover { background: var(--d-panel); }
.docs-editbar { border: 1px solid var(--d-line); background: var(--d-panel); border-radius: var(--d-radius); padding: 8px 12px; margin: 0 0 16px; }
fieldset { border: 1px solid var(--d-line); border-radius: var(--d-radius); margin: 14px 0; padding: 8px 14px 14px; }
legend { font-weight: 500; padding: 0 6px; }
.docs-field { display: grid; gap: 3px; margin: 10px 0; max-width: 560px; }
.docs-field label { font-size: 13px; color: var(--d-muted); }
.docs-field input[type=text], .docs-field input[type=file], .docs-field textarea, .docs-field select { font: inherit; padding: 5px 8px; background: var(--d-bg); color: var(--d-fg); border: 1px solid var(--d-line); border-radius: var(--d-radius); width: 100%; }
button.docs-primary, button.docs-primary:hover { background: var(--d-accent); color: var(--d-accent-fg); border-color: var(--d-accent); font-weight: 500; }
button.docs-button:disabled { opacity: .5; cursor: not-allowed; }
.docs-error-line { color: var(--d-bad); margin: 6px 0; }
.docs-plan { border: 1px solid var(--d-fg); border-radius: var(--d-radius); padding: 4px 16px 14px; margin: 14px 0; background: var(--d-bg); }
.docs-plan h3 { margin: 12px 0 6px; font-size: 17px; }
.docs-plan h4 { margin: 12px 0 4px; font-size: 14px; }
.docs-plan-block { border: 1px solid var(--d-bad); border-left-width: 6px; border-radius: var(--d-radius); padding: 8px 12px; margin: 8px 0; }
.docs-plan-breaking { border-left: 6px solid var(--d-bad); padding-left: 10px; }
.docs-plan-additive { border-left: 6px solid var(--d-ok); padding-left: 10px; }
.docs-plan-cosmetic { border-left: 6px solid var(--d-line); padding-left: 10px; }
.docs-diff { margin: 6px 0; max-height: 420px; overflow: auto; }
.docs-diff span { display: inline; white-space: pre; }
.docs-diff-add { background: rgba(15, 107, 60, .22); }
.docs-diff-del { background: rgba(161, 38, 28, .22); }
.docs-diff-skip { color: var(--d-muted); }
.docs-diff-file summary { cursor: pointer; }
@media (max-width: 760px) { .docs-shell { grid-template-columns: 1fr; } .docs-nav { border-right: 0; border-bottom: 1px solid var(--d-line); min-height: 0; } .docs-preview { grid-template-columns: 1fr; } .docs-controls { border-left: 0; border-top: 1px solid var(--d-line); } }
`
