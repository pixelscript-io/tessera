Your design tokens go in this folder, as `*.tokens.json` files (the W3C Design Tokens format). Nothing is here yet on purpose: Tessera does not guess a design.

Bring yours in with one command, from a file, a folder, a URL or a link to a Figma file:

    npx @pixelscriptio/tessera tokens import <source>

Your names are kept as they are. Then `npx @pixelscriptio/tessera check` validates the tokens and everything that uses them.
