# Surf Bot motion

The app draws the star from `packages/ui` and steps an original face (eyes, blink, mouth) plus squash-and-stretch in JavaScript. It is silent. There is no mute control because nothing plays audio.

Idle breathes and blinks. Thinking looks up. Searching scans. Success hops with a squash and a stretch. Error shakes and frowns. A tap plays one of hop, spin, or wink, chosen from a random seed. `prefers-reduced-motion: reduce` and the animate setting both hold a still frame.

`animation/mp4` is a style reference for mood, energy, timing, length, and colour. It is not in this checkout. If clips are added later, leave watermarks on them. Do not crop, trace, or reuse frames. The desktop build does not package this folder: `electron-builder` only ships `out/**`, and a unit test rejects an `mp4` import or an `animation/mp4` extra resource.

The motions that ship are listed in `manifest.json` and `packages/ui/src/mascot.ts`.
