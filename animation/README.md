# Pip

Pip is the orange blob drawn in `packages/ui`. One SVG, a spline body and two pill eyes, is stepped with `requestAnimationFrame`. It is silent. There is no mute control because nothing plays audio.

The moods are idle, thinking, working, happy, oops, searching, reading, writing, permission, typing, offline, sleepy, benchmark, wink, guiding, notification, and dizzy. `error` uses the oops pose. `success` and `done` use the happy pose. A poke squashes the body. Three quick pokes make Pip dizzy. `prefers-reduced-motion: reduce` keeps the motion and lowers the amplitude, and it skips sparkles. Turning animation off holds one frame.

The stylesheet records thinking at 2.2s and searching at 0.7s. The other moods are not fixed-length clips. There is no video folder and no audio file. The desktop build does not package `animation/` or any mp4.

The moods that ship are listed in `manifest.json` and `packages/ui/src/mascot.ts`. The default orange is `#ffc27a` at the top and `#f2740f` at the bottom. Offline mixes that orange with grey. The installed icon stays the default orange.
