# The system manager

Introduced in v0.1 (Milestone 19).

The [design system docs](/guide/docs-app) can also change the system, for the people who decide it but do not write code. Run it with `--edit`:

```bash
npx tessera docs --edit
```

It prints an address with a key in it, which is new every run. Open that address.

```text
Editing is on. Open this address (it carries a key that is new each run):
  http://127.0.0.1:5173/?key=...
Anyone who can open it on this computer can change the project files. The docs listen on this computer only.
```

Without `--edit` the docs cannot write anything: every editing request is refused.

## What you can change

**Component contracts.** On a component's page, the **Edit this component** section has forms for:

- the description, the version it was introduced in, and a deprecation (with what to use instead);
- a variant's values: add one, rename one, deprecate one, remove one, or make a different value the default;
- a new variant, and a new slot or event, and the descriptions of existing ones.

On the overview, **Add a component** creates one from the starter.

**A token export.** **Bring in tokens** takes the files a design tool exported (strict DTCG with its resolver file, or Tokens Studio or Penpot files; choose the files, or the whole folder) and shows what saving would do.

**Tokens themselves are not edited here.** Their source of truth is your design tool, and [`tessera tokens import`](/guide/interchange) is how they arrive. An editor in Tessera would be a second source of truth that the next export overwrote. The docs show every token as they always did, read-only.

## Every change is checked before it is saved

Choosing **Preview** asks the server to prepare the change, and writes nothing. The panel that appears shows:

- **What the compiler says.** The change is applied to a copy of the project in memory, and every component and page is checked with the real rules. If the change would introduce an error that `tessera check` did not already report, it is **refused**: you see the compiler's message and **Save this change** is disabled. Errors the project already had do not stop an unrelated change.
- **What it means for people using the system.** The same classification as [`tessera diff`](/guide/design-systems/versioning): **breaking** (a value removed, a default changed, a token that flips a contrast result), **added**, or **changed**. A removal that is not refused is still shown as breaking.
- **What it touches.** The count of uses of the thing you are changing, by file.
- **The files.** Each file that would change, as a diff, with a plus or minus sign on every changed line, not only a color.
- **Notes.** For a token import, what the importer skipped or adjusted ([T1016](/reference/errors/T1016)).

A **rename** also rewrites every use, in the same save, the way [`tessera codemod`](/guide/design-systems/versioning) does: the contract records the rename, the components and pages that used the old name are updated, and the component's own styles follow.

A token import **replaces** the token set: token files the export does not produce are listed as deleted in the diff, so nothing disappears unseen. If the new tokens would leave a component using a token that no longer exists, that is the compiler's error and the import is refused.

## What a save writes

- For a contract change: only the **contract block** of the component's file, by the smallest edit that does the job. The contract's comments and layout stay as they were.
- For a rename: the files that used the old name.
- For a new component: one file in `app/components`.
- For a token import: the token files.

Nothing else is ever written. A save is atomic, and it is refused if a file changed on disk between the preview and the save (someone edited it, or git switched branches): prepare the change again.

## Undo, and landing a change

After a save the bar at the top shows what was saved and an **Undo** button, which puts the files back (if they are still as the save left them). Beyond that, git is the history.

**Changes** shows what git says, and **Propose this change** creates a new branch and commits exactly the files the manager changed, with a message you write. Anything else you have changed or staged stays out of the commit. It does not push, and it does not open a pull request: hand the branch to a developer.

## Who can use it

The editor is for one person at one computer.

- The server listens on `127.0.0.1` only, never on the network.
- Every request must carry the key from the printed address, which is new each run and is taken out of the address bar as soon as the page has it.
- A request is refused if its `Host` is not a local name (which is how DNS rebinding arrives), if the page that made it is another origin, or if a write is not JSON (so another site cannot trigger one with a form).

There are no accounts or roles. Whoever can open the address on that computer can change the project's files, so do not run it on a shared machine you do not trust. A hosted, multi-person editor would need real authentication and a way to handle two people editing at once; it is not built.

## What it does not do

- **Edit tokens, templates, styles, scripts or the config.** Those are design-tool and developer work.
- **Rename a component** (that renames a file): use the file and `renamedFrom`, then `tessera codemod`.
- **Open pull requests.** It makes a branch and a commit.
- **Keep its own history** for people without git: one undo, and git.

## Related

- [The design system docs](/guide/docs-app)
- [Versioning and deprecation](/guide/design-systems/versioning)
- [Importing and exporting tokens](/guide/interchange)
