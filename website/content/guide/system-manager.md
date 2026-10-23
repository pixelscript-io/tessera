# Tokens in the design system docs

Introduced in v0.3 (Milestone 19).

Tokens are edited in your design tool. The [design system docs](/guide/docs-app) are where people who do not write code move them between the tool and the project: **export** them to the tool, **bring in** what the tool exports. Nothing else about the system is edited here: components are files, and a developer changes them.

## Sending tokens to your design tool

The docs have an **Export** page (under Tokens) in every mode, including the [static export](/guide/docs-app). It offers the project's tokens in either format, with the files listed:

- **DTCG, with a Resolver:** the W3C Design Tokens format, one file per set and a resolver file. Figma variables and most token tools read it.
- **Tokens Studio or Penpot:** one file per set, with `$themes.json` and `$metadata.json`.

Download all of the files as a zip, or one at a time. This is the same output as [`tessera tokens export`](/guide/interchange); it needs no key and writes nothing.

## Bringing tokens back in

Bringing tokens in writes files, so it is behind `--edit`:

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

**Bring in tokens** takes the files a design tool exported (strict DTCG with its resolver file, or Tokens Studio or Penpot files; choose the files, or the whole folder) and shows what saving would do. This is [`tessera tokens import`](/guide/interchange) with a preview in front of it.

**Tokens are not edited by typing values into the docs.** Their source of truth is your design tool. An editor in Tessera would be a second source of truth that the next export overwrote. The docs show every token as they always did, read-only.

## Every import is checked before it is saved

Choosing **Preview the import** asks the server to prepare the change, and writes nothing. The panel that appears shows:

- **What the compiler says.** The import is applied to a copy of the project in memory, and every component and page is checked with the real rules. If the new tokens would introduce an error that `tessera check` did not already report (a component using a token that no longer exists, a text and background pair a component declares that no longer passes contrast), the import is **refused**: you see the compiler's message and **Save this change** is disabled. Errors the project already had do not stop an unrelated import.
- **What it means for people using the system.** The same classification as [`tessera diff`](/guide/design-systems/versioning): **breaking** (a token removed, a token that flips a contrast result), **added**, or **changed**.
- **The files.** Each token file that would change, as a diff, with a plus or minus sign on every changed line, not only a color. A file the import only reformats is not a change.
- **Notes.** What the importer skipped or adjusted ([T1016](/reference/errors/T1016)).

An import **replaces** the token set: token files the export does not produce are listed as deleted in the diff, so nothing disappears unseen.

## What a save writes

Only the token files. A save is atomic, and it is refused if a file changed on disk between the preview and the save (someone edited it, or git switched branches): prepare it again.

## Undo, and landing a change

After a save the bar at the top shows what was saved and an **Undo** button, which puts the files back (if they are still as the save left them). Beyond that, git is the history.

**Changes** shows what git says, and **Propose this change** creates a new branch and commits exactly the files the manager changed, with a message you write. Anything else you have changed or staged stays out of the commit. It does not push, and it does not open a pull request: hand the branch to a developer.

## Who can use it

Bringing tokens in is for one person at one computer.

- The server listens on `127.0.0.1` only, never on the network.
- Every request must carry the key from the printed address, which is new each run and is taken out of the address bar as soon as the page has it.
- A request is refused if its `Host` is not a local name (which is how DNS rebinding arrives), if the page that made it is another origin, or if a write is not JSON (so another site cannot trigger one with a form).

There are no accounts or roles. Whoever can open the address on that computer can change the project's token files, so do not run it on a shared machine you do not trust. A hosted, multi-person editor would need real authentication and a way to handle two people editing at once; it is not built.

## What it does not do

- **Edit components, templates, styles, scripts or the config.** Those are developer work, done in the files.
- **Edit token values.** That is the design tool's job.
- **Open pull requests.** It makes a branch and a commit.
- **Keep its own history** for people without git: one undo, and git.

## Related

- [The design system docs](/guide/docs-app)
- [Importing and exporting tokens](/guide/interchange)
