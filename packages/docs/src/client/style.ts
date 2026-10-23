/** The docs app's own styles. It looks the same whatever the project's tokens are; only the preview stage uses them. */
export const STYLE = `
:root { color-scheme: light dark; --d-bg: #fff; --d-fg: #17202a; --d-muted: #566573; --d-line: #d5dbe1; --d-panel: #f4f6f8; --d-accent: #1d4ed8; --d-ok: #0f6b3c; --d-bad: #a1261c; }
@media (prefers-color-scheme: dark) { :root { --d-bg: #11161c; --d-fg: #e8edf2; --d-muted: #a3afbb; --d-line: #2d3641; --d-panel: #1a212a; --d-accent: #8ab4ff; --d-ok: #66d19e; --d-bad: #ff8a80; } }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: var(--d-bg); color: var(--d-fg); }
a { color: var(--d-accent); }
code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
pre { background: var(--d-panel); padding: 12px; border-radius: 6px; overflow: auto; margin: 8px 0; }
:not(pre) > code { background: var(--d-panel); padding: 1px 5px; border-radius: 4px; }
.docs-top { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; padding: 10px 20px; border-bottom: 1px solid var(--d-line); position: sticky; top: 0; background: var(--d-bg); z-index: 2; }
.docs-top h1 { font-size: 16px; margin: 0; flex: 1 1 auto; }
.docs-switch { display: flex; gap: 6px; align-items: center; font-size: 13px; }
.docs-switch select, .docs-controls select, .docs-controls input[type=text] { font: inherit; padding: 3px 6px; background: var(--d-bg); color: var(--d-fg); border: 1px solid var(--d-line); border-radius: 4px; }
.docs-shell { display: grid; grid-template-columns: 230px minmax(0, 1fr); }
.docs-nav { padding: 16px 12px 40px 20px; border-right: 1px solid var(--d-line); min-height: calc(100vh - 54px); }
.docs-nav h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--d-muted); margin: 16px 0 4px; }
.docs-nav ul { list-style: none; margin: 0; padding: 0; }
.docs-nav a { display: block; padding: 3px 8px; border-radius: 4px; text-decoration: none; color: inherit; }
.docs-nav a:hover { background: var(--d-panel); }
.docs-nav a[aria-current=page] { background: var(--d-panel); font-weight: 600; box-shadow: inset 3px 0 var(--d-accent); }
.docs-main { padding: 20px 28px 60px; max-width: 1100px; }
.docs-main h2 { margin: 28px 0 8px; font-size: 18px; }
.docs-main h1 { margin: 0 0 4px; font-size: 26px; }
.docs-lead { color: var(--d-muted); margin: 0 0 12px; }
.docs-badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 14px; }
.docs-badge { border: 1px solid var(--d-line); border-radius: 99px; padding: 1px 10px; font-size: 12px; color: var(--d-muted); }
.docs-badge.warn { color: var(--d-bad); border-color: var(--d-bad); }
table { border-collapse: collapse; width: 100%; margin: 6px 0 12px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--d-line); vertical-align: top; font-size: 14px; }
th { color: var(--d-muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.docs-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 12px 0; }
.docs-card { border: 1px solid var(--d-line); border-radius: 8px; padding: 12px 14px; background: var(--d-panel); }
.docs-card b { display: block; font-size: 24px; }
.docs-card span { color: var(--d-muted); font-size: 13px; }
.docs-preview { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 12px; border: 1px solid var(--d-line); border-radius: 8px; overflow: hidden; }
.docs-stage { padding: 28px; min-height: 120px; display: flex; align-items: center; justify-content: center; background: var(--t-color-surface-default, #fff); color: var(--t-color-text-default, #17202a); }
.docs-stage.parts [class] { outline: 1px dashed #d6336c; outline-offset: 1px; }
.docs-stage .docs-error { color: #a1261c; font-family: ui-monospace, monospace; white-space: pre-wrap; }
.docs-controls { padding: 12px 14px; background: var(--d-panel); border-left: 1px solid var(--d-line); display: grid; gap: 10px; align-content: start; font-size: 13px; }
.docs-controls label { display: grid; gap: 3px; }
.docs-controls h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--d-muted); }
.docs-events { margin: 0; padding-left: 18px; max-height: 110px; overflow: auto; }
.docs-live { border: 1px solid var(--d-line); border-radius: 8px; padding: 20px; margin: 10px 0 4px; background: var(--t-color-surface-default, #fff); color: var(--t-color-text-default, #17202a); }
.docs-swatch { display: inline-block; width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--d-line); vertical-align: middle; margin-right: 8px; }
.docs-bar { display: inline-block; height: 10px; background: var(--d-accent); border-radius: 2px; vertical-align: middle; margin-right: 8px; }
.docs-shadow { display: inline-block; width: 44px; height: 26px; border-radius: 4px; background: var(--d-bg); vertical-align: middle; margin-right: 8px; }
.docs-pass { color: var(--d-ok); font-weight: 600; }
.docs-fail { color: var(--d-bad); font-weight: 600; }
.docs-muted { color: var(--d-muted); }
.docs-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.docs-tools input[type=search] { font: inherit; padding: 4px 8px; border: 1px solid var(--d-line); border-radius: 4px; background: var(--d-bg); color: var(--d-fg); min-width: 220px; }
button.docs-button { font: inherit; padding: 4px 12px; border: 1px solid var(--d-line); border-radius: 4px; background: var(--d-bg); color: var(--d-fg); cursor: pointer; }
@media (max-width: 760px) { .docs-shell { grid-template-columns: 1fr; } .docs-nav { border-right: 0; border-bottom: 1px solid var(--d-line); min-height: 0; } .docs-preview { grid-template-columns: 1fr; } .docs-controls { border-left: 0; border-top: 1px solid var(--d-line); } }
`
