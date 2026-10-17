# Step 11

Desktop version **0.2.0**.

## What this step adds

- Chat, settings, usage, and cache use the light and dark card layout. Accent and density are settings. The theme is still only light or dark.
- Reply actions under an answer: Copy, thumbs up, thumbs down, Read aloud (the operating system voice), Regenerate, and More. Thumbs stay in the open window. They are not stored or uploaded. There is no Share action.
- Regenerate stores the new answer as another version of the same assistant reply. The switcher is ‹ 1/2 ›. It does not add a user turn. Reopening the chat loads those versions.
- Network mode is Offline, Online, or Auto. Auto is the default. It is changed only in Settings. Offline makes no network calls, and the answer says it stayed on this computer. Online allows web search and pack sync. Auto follows the connection. A sidebar chip shows Up to date, Syncing pack v…, Sync failed, will retry, or Offline, plus the current mode. The tooltip has the pack version and the last sync time. Pack sync stays in the background and swaps a pack only between messages. There is no popup during a chat. Offline mode warns in Settings and in that tooltip when the licence refresh date is near or past.
- Surf Bot is the mascot name. A person can rename it on this computer. Idle plays the approved silent star clip. The other states use an original SVG face (eyes, blink, mouth) and squash-and-stretch. It is silent. There is no mute control. Reduced motion holds the still frame.
- Usage counts come from the local log: requests, tokens, model, agent, and day. Export is a CSV of those rows. There is no cost column.
- Cache shows on-disk sizes for models, packs, indexes, chats, saved web, search cache, quote cache, and logs. A bar is drawn only when a category has bytes. Screenshots appear only when files exist in the app data `screenshots` folder. Prompt cache is RAM from the llama.cpp setting, not a file.
- Run benchmark writes tokens per second for the installed file. Until that run, the screen says not measured yet. A saved speed is hidden when the file size no longer matches the registry.
- Dev mode is shown when the unpackaged dev licence flag is on. Term length is shown only when the signed licence has it. Plan names and prices are not shown.
- The app version is `app.getVersion()`.
- The desktop app does not download models. The website downloads Qwen 2B, 4B, and 9B from the registry URLs. On launch the app checks the Downloads folder, and a `synap://setup` link that includes a file path, against the registry SHA-256, then moves a match into the models folder. If none is found, chat shows "Get your model from synap.surf to start chatting" and a button that opens the website. Settings lists an installed model by its plain name.

## Not shown, because there is no real source

- Cloud spillover, cloud fallback, weekly compute quota, plan names, and prices.
- Tokens per second, engine version, config id, Metal graph, connected-app counts, telemetry throughput, and an air-gap badge.
- System theme. The product theme is light or dark.
- Screenshot files the person saved somewhere else with the save dialog. Those paths are not in app data, and they are not added to the cache.

## Animations

Idle uses the approved silent star clip at `packages/ui/src/assets/surfbot-idle.webm`, with the transparent still when motion is reduced. That clip is not from `animation/mp4`. No reference clips were in `animation/mp4`, so none were watermark-inspected and none are packaged. Searching, thinking, success, error, and taps stay original SVG. Timings in `animation/manifest.json` are idle 3.6s, searching 0.7s, thinking 2.2s, success 0.9s, error 0.55s, and taps 0.8s / 0.9s / 1.0s. No audio files were added.

## Eval

`step11-questions.ts` scores 101 questions with the real gates: coding 20, splitting 15, run/fix 10, screenshots 13, fresh info 12, finance 12, legal 9, no-fabrication 10. With the other Step 11 checks the suite is 222 rows, all required to pass. The separate no-fabrication suite is 42 cases. Those checks do not call a model.

The `model-eval` CI job downloads Qwen3.5-2B Q4_K_M, checks the registry SHA-256, and asks llama-server a 46-question subset (coding, splitting, run/fix, finance, and all 10 no-fabrication questions). No-fabrication is scored after the verifier: a missing source returns the fixed "Unable to find … right now" line and does not call the model, and a number, price, date, URL, section, or quote that is not in a fetched record is removed. Finance, news, and legal answers are composed in code. The job records accuracy, tokens per second, time to first token, and peak llama-server RSS. The subset floors in `harness/baselines/model-eval.json` are accuracy 1.0 and no-fabrication 1.0. The 101-question run keeps no-fabrication at 1.0 and uses `fullMinAccuracy` for the other questions. The GGUF is cached by file SHA and is not committed.

`model-eval-full` runs nightly. A `v*` tag runs it with the release gate before installers. It covers Qwen 2B, 4B, and 9B, the full 101 questions, and the mmproj screenshot add-on. `scripts/measure-ram.ts` starts llama-server when a GGUF is present and samples process RSS. A missing file still exits 0. Set the repository variable `SURF_MODEL_EVAL_RUNNER` to use a larger runner. Otherwise `./scripts/model-eval-full.sh` is the one command on a Mac, and the release gate reads `harness/baselines/model-eval-full.json` for any size that runner could not load.

## Release

A `v*` tag runs the CI workflow, including the no-fabrication gate and the Step 11 suite, and only then builds installers. This step does not push a tag.
