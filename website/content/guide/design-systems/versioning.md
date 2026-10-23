# Versioning and deprecation

Introduced in v0.1 (Milestone 3), with the tooling in Milestone 16.

A design system changes, and the people using it should find out from a tool, not from a broken page. Tessera gives you three things: fields that say what happened to a component, variant value or token, a command that compares two versions and says which changes break people, and a command that updates the uses for you.

## Saying what happened

A contract has optional fields for the life of a component:

| Field              | Meaning                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `since`            | The version that introduced the component.                                                     |
| `deprecated`       | A message saying what to use instead. The component still works.                               |
| `renamedFrom`      | The previous name of the component.                                                            |
| `deprecatedValues` | Variant values that are deprecated, with a message each. They still work.                      |
| `renamedValues`    | Variant values that were renamed: the old value to its replacement. The old value is now gone. |

```json
{
  "name": "Button",
  "role": "button",
  "parts": ["root"],
  "variants": { "tone": ["primary", "neutral", "destructive", "loud"] },
  "deprecatedValues": { "tone": { "loud": "Use primary." } },
  "renamedValues": { "tone": { "danger": "destructive" } }
}
```

A deprecated value stays in `variants`; a renamed one does not, and its replacement must be there ([T3014](/reference/errors/T3014) says so when it is not).

A token says the same in its `$extensions`:

```json
{
  "space": {
    "3": {
      "$type": "dimension",
      "$value": { "value": 12, "unit": "px" },
      "$extensions": { "tessera": { "renamedFrom": "space.medium", "deprecated": "Use $space.4." } }
    }
  }
}
```

The compiler warns at every use of a deprecated thing ([W4103](/reference/errors/W4103) for a component, [W4104](/reference/errors/W4104) for a variant value, [T2113](/reference/errors/T2113) for a token) and carries the reason. A use of something that was renamed is an error that says what it became: `<Button> was renamed to <Action>`, `"danger" was renamed to "destructive"`, `"$space.medium" was renamed to "$space.3"`, each with the command that fixes it.

## `tessera diff`

```bash
npx tessera diff v1.2.0
```

compares the design system in the working tree with a git ref (a tag, a branch or a commit) and classifies every change:

- **Breaking**: a removed or renamed component, variant, value, part, state, slot or event; a changed role or behavior; a changed default (uses that do not set it render differently); a removed or renamed token or theme; a token whose type changed; **a value change that flips a text contrast result in any theme** (a text token on the background it is used with, measured the way the [docs](/guide/docs-app) show it); and **a value change that moves a token past its neighbour in a scale** (a spacing step that becomes larger than the next one).
- **Additive**: a new component, variant, value, part, state, slot, event, token or theme, and a new deprecation.
- **Cosmetic**: a token value change that does neither of the above, with the old and new values.

A rename that has a codemod says so. `--to <ref>` compares two refs instead of using the working tree, `--json` prints the changes as data, and `--fail-on-breaking` exits 1 when there is a breaking change, for CI.

The ref is read without touching your working tree or your index. Tokens kept outside the repository are used as they are on both sides.

```bash
npx tessera diff v1.2.0 --changelog --version 1.3.0
```

prints the changes as a changelog section, ready to paste: breaking changes, added, deprecated and changed.

## `tessera codemod`

When a component's contract says `renamedFrom`, or a contract lists `renamedValues`, or a token says `renamedFrom`, the codemod brings the project up to date:

```bash
npx tessera codemod
npx tessera codemod --write
```

Without `--write` it lists every change and touches nothing. With it, the files are rewritten:

- `<Old>` and `</Old>` in templates, and an explicit `import Old from ".../Old.tess"`, become the new name;
- a static `tone="danger"` on the component's tags becomes `tone="destructive"`, and the `[data-tone='danger']` selectors in the component's own styles follow;
- `$space.medium` in styles becomes `$space.3`, and so does `{space.medium}` in other token files.

It is lexical, reading only the blocks it can find by name, and it says what it will not guess: a computed value (`:tone="..."`) that mentions an old value is listed as needing a hand. The definitions that declare a rename (the `renamedFrom` field itself) are never touched. If a component's contract is not valid (its name does not match its file name, for example), it is not loaded and its renames cannot be read: the codemod lists it as skipped and exits 1 instead of saying there is nothing to do. Run `tessera check` afterwards; it passes when the rename was the only thing wrong.

It works even when the rename has left the tokens unable to build (an alias that still names the old token), because it reads the rename declarations from the files themselves.

## Who still depends on it

`tessera report` lists, by file and count, the remaining uses of every deprecated component, variant value and token, and the renames not applied yet. A maintainer can see who still depends on something before removing it. `tessera docs` shows the same numbers.

## What it does not do

- A **deprecation window** (at least one minor release before removal) is not enforced. `diff` tells you a removal is breaking whether or not the thing was deprecated first. If you want a window, keep the deprecated item for a release and read the report before you remove it.
- **Parts** are not renamed by a codemod: a part is a documented class name, and its uses are in other people's styles.
- The version number is yours to choose. `diff` classifies, and `--version` only labels the changelog.

## Next steps

[The command line](/guide/cli), [Designing contracts](/guide/design-systems/contracts) and [Releases](/releases/).
