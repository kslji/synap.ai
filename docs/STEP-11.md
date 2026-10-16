# Step 11

Desktop version **0.2.0**.

## What this step adds

- Chat, settings, usage, and cache use the light and dark card layout. Accent and density are settings. The theme is still only light or dark.
- Reply actions under an answer: Copy, thumbs up, thumbs down, Read aloud (the operating system voice), Regenerate, and More. Thumbs stay in the open window. They are not stored or uploaded. There is no Share action.
- Regenerate keeps the earlier answer text on that reply in the open window. The new answer is also saved as the next turn in chat history.
- Surf Bot is the mascot name. A person can rename it on this computer. Motion is original CSS on the existing star drawing. It is silent. There is no mute control.
- Usage counts come from the local log: requests, tokens, model, agent, and day. Export is a CSV of those rows. There is no cost column.
- Cache shows on-disk sizes for models, packs, indexes, chats, saved web, search cache, quote cache, and logs. A bar is drawn only when a category has bytes. Screenshots appear only when files exist in the app data `screenshots` folder. Prompt cache is RAM from the llama.cpp setting, not a file.
- Run benchmark writes tokens per second for the installed file. Until that run, the screen says not measured yet. A saved speed is hidden when the file size no longer matches the registry.
- Dev mode is shown when the unpackaged dev licence flag is on. Term length is shown only when the signed licence has it. Plan names and prices are not shown.
- The app version is `app.getVersion()`.

## Not shown, because there is no real source

- Cloud spillover, cloud fallback, weekly compute quota, plan names, and prices.
- Tokens per second, engine version, config id, Metal graph, connected-app counts, telemetry throughput, and an air-gap badge.
- System theme. The product theme is light or dark.
- Screenshot files the person saved somewhere else with the save dialog. Those paths are not in app data.

## Animations

No clips were in `animation/mp4` in this checkout, so none were watermark-inspected and none are packaged. Timings are the original CSS durations in `packages/ui/src/star-surf.css` and `animation/manifest.json` (idle 3.6s, searching 0.7s, thinking 2.2s, success 0.9s, error 0.55s, clicks 0.8s / 0.9s / 1.0s). No audio files were added.

## Release

A `v*` tag runs the CI workflow, including the no-fabrication gate and the Step 11 suite, and only then builds installers. This step does not push a tag.

The 4B and 9B RAM script reports file size when the GGUF is present and exits 0 when it is absent. It does not start llama-server.
