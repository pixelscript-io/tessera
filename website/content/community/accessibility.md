# Accessibility statement

This site aims to meet WCAG 2.2 level AA.

## How it is checked

- Every page of the built site is scanned with axe-core in CI, and the build fails on a serious or critical violation.
- The site's colors come from Tessera's design tokens, and the contrast of the pairs it uses is checked by the same code that checks components.
- Pages are static HTML and readable without JavaScript. Navigation, search and the theme switch are built with keyboard access in mind.

## What that does not mean

Automated checks find only part of what matters. This site has not been audited by an accessibility specialist, and it has not been tested with a range of screen readers. Do not read "passes axe" as a conformance claim.

## Known limitations

- Code samples are shown in the default code-block styling of the site generator. They are scrollable regions; their contrast is checked, but how well they read with a screen magnifier or in forced-colors mode has not been tested.
- The site is English only.

## Telling us

If something on this site is hard to use or read, [report it](/community/bugs) with the page, what you used, and what happened. Accessibility problems are bugs.
