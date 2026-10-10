# Code + UI design reference

This pack is the starting point for a live preview. It is not a downloaded component library.

## Tokens

| Token | Value |
|---|---|
| Ink | `#111111` |
| Paper | `#fafafa` |
| Line | `#e7e5e4` |
| Accent | `#f97316` |
| Radius | `16px` |
| Button | pill, weight 700 |

## Components

Buttons, cards, and fields follow the same shapes as the Surf app: a rounded card, an orange primary button, and a quiet border. Copy the snippet into the preview tab and change it there. The preview iframe cannot load a remote stylesheet, a remote image, or a network call.

React preview compiles JSX with Sucrase inside the app, then runs it in the sandboxed iframe. The iframe does not load React from the network.
