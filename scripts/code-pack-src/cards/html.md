---
language: html
library: html
version: original
source_url: https://synap.surf/code-pack/cards/html
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## button type

A button inside a form submits the form unless type="button". The missing type is the usual reason a click reloads the page. Use type="submit" for the button that should submit, and type="button" for a button that only runs a script. Put the label in the button element, not only in a value attribute.

## CSS specificity

CSS specificity: an id selector beats a class selector, which beats an element selector. #id is stronger than .class, and .class is stronger than p. Inline style beats all three. Prefer a class over an id when you need to override a rule later. !important wins over specificity and is harder to override, so leave it for a rare case.
