# Surf Bot motion

The app plays original CSS animations of the star drawing in `packages/ui`. They are silent. There is no mute control because nothing plays audio.

`animation/mp4` is a style reference for mood, energy, timing, length, and colour. It is not in this checkout. If clips are added later, leave watermarks on them. Do not crop, trace, or reuse frames. The desktop build does not package this folder: `electron-builder` only ships `out/**`, and a unit test rejects an `mp4` import or an `animation/mp4` extra resource.

The motions that ship are listed in `manifest.json` and `packages/ui/src/mascot.ts`. A click plays one of the three click motions, chosen from a random seed.
