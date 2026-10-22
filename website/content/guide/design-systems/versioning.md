# Versioning and deprecation

Introduced in v0.1 (Milestone 3). Most of the tooling is planned.

A contract has three optional fields for the life of a component:

| Field         | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| `since`       | The version that introduced the component.                       |
| `deprecated`  | A message saying what to use instead. The component still works. |
| `renamedFrom` | The previous name, for migrations.                               |

## What exists

- The fields are validated, and carried into the generated types and the manifest.
- `tessera report` lists every deprecated component and who still uses it, by file and count, so maintainers can see who depends on it before removal.
- `tessera eject` records `forkedFrom` for copies.

## What is planned

These are on [the roadmap](/releases/roadmap) and are not built:

- `tessera diff <ref>`: a contract and token change report between two versions, with breaking changes flagged (a removed variant value, a renamed part, a contrast regression).
- Codemods for renamed variant values, tokens and components.
- A deprecation window (at least one minor release) enforced by the tooling.

Until then, treat a rename as a breaking change: keep the old name as a deprecated component for a release, say what replaces it in `deprecated`, and use `tessera report` to find the last users.

## Next steps

[The command line](/guide/cli) and [Releases](/releases/).
