import re

def edit(path, pairs):
    t = open(path, encoding='utf8').read()
    for a, b in pairs:
        assert a in t, (path, a[:70])
        t = t.replace(a, b)
    open(path, 'w', encoding='utf8').write(t)

edit('packages/cli/src/commands-doc.ts', [
    ("'tessera figma import --map <file> (--url <link> | --from-json <file>) [--out <folder>] [--replace] [--strict] [--no-images]'",
     "'tessera figma import (--url <link> | --from-json <file>) [--component <name>] [--map <file>] [--out <folder>] [--replace] [--strict] [--no-images]'"),
    ("Reads one component set of a Figma file (with a personal access token in `FIGMA_TOKEN`, or from a saved response) and writes a component, the tokens it needs, and a test. The map (`figma.map.json`, written by hand) says what the Figma properties, layers and states are in Tessera: which variant properties are props, which one is the state (and which pseudo-class each value is), which layer is which part, and the role and behavior. A property or layer the map does not mention is an error, never a guess.",
     "Reads one component set of a Figma file (with a personal access token in `FIGMA_TOKEN`, or from a saved response) and writes a component, the tokens it needs, and a test. It needs nothing but the link: the map that says what the Figma properties, layers and states are in Tessera (which variant properties are props, which one is the state, which layer is which part, and what each icon switch controls) is worked out from the design and written next to the component, as `figma.map.json`. Give your own with `--map` to change what it says; a property or layer a given map does not mention is an error, never a guess. A link to a page with one component set is enough; with several, `--component` names the one. The tests need the browser setup of `tessera a11y`, which the import does as well."),
    ("      { flag: '--map <file>', description: 'The map: which component set, and what its parts and properties are.' },",
     "      { flag: '--map <file>', description: 'A map of your own, instead of the one worked out from the design.' },\n      { flag: '--component <name>', description: 'The component set to import, when the link has several.' },"),
])

edit('website/content/guide/commands.md', [
    ("The map (`figma.map.json`, written by hand) says which Figma properties are props, which one is the state, which layer is which part, and the role and behavior; a property or layer it does not mention is an error, never a guess.",
     "It needs nothing but the link: the map that says which Figma properties are props, which one is the state, which layer is which part and what each icon switch controls is worked out from the design and written next to the component (`--map` gives your own; a property or layer a given map does not mention is an error, never a guess)."),
    ('npx tessera figma import --map figma.map.json --url "https://www.figma.com/design/KEY/Name?node-id=1-1183"',
     'npx tessera figma import --url "https://www.figma.com/design/KEY/Name?node-id=1-1183"'),
])
