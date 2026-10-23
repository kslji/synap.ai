# Step 11


> **Superseded — web search was removed in Phase 0.** The SearXNG proxy, `POST /v1/search` and
> `POST /v1/fetch`, trafilatura page cleaning, the `search_requests`, `search_quota_daily` and
> `source_suggestions` tables, the `web_search_per_day` plan knob and the laptop search connectors
> are all deleted. What follows is the record of that step as it shipped; none of it is live.

Desktop version **0.2.0**.

## What this step adds

- Chat, settings, usage, and cache use the light and dark card layout. Accent and density are settings. The theme is still only light or dark.
- Reply actions under an answer: Copy, thumbs up, thumbs down, Read aloud (the operating system voice), Regenerate, and More. Thumbs stay in the open window. They are not stored or uploaded. There is no Share action.
- Regenerate stores the new answer as another version of the same assistant reply. The switcher is ‹ 1/2 ›. It does not add a user turn. Reopening the chat loads those versions.
- Network mode is Offline, Online, or Auto. Auto is the default. It is changed only in Settings. Offline makes no network calls, and the answer says it stayed on this computer. Online allows web search and pack sync. Auto follows the connection. The sidebar chip uses the bot name. It stays that name while idle, turns orange while a sync is actually running, shows Name · Synced for a few seconds after that sync succeeds, and shows Offline or Sync failed when the network is off or the sync did not finish. Clicking the name starts a sync. The tooltip has the pack version and the last sync time. Pack sync stays in the background and swaps a pack only between messages. There is no popup during a chat. Offline mode warns in Settings and in that tooltip when the licence refresh date is near or past.
- The default bot name is Surf. A person can rename it from the chat header or from Settings, General, Bot name, and pick a body colour under General & Appearance. The character is the orange blob: a spline body and two pill eyes, drawn in SVG. Idle, thinking, working, done, and error match that motion. Searching, reading, writing, listening, permission, typing, offline, rest, benchmark, a wink, and a poke use the same body. It is silent. There is no mute control. Reduced motion keeps the motion at a lower amplitude and skips sparkles. Turning off Animate Surf Bot holds one frame. The installed icon stays the default orange.
- Usage counts come from the local log: requests, tokens, model, agent, and day. Export is a CSV of those rows. There is no cost column.
- Cache shows on-disk sizes for models, packs, indexes, chats, saved web, search cache, quote cache, and logs. A bar is drawn only when a category has bytes. Screenshots appear only when files exist in the app data `screenshots` folder. Prompt cache is RAM from the llama.cpp setting, not a file.
- Run benchmark writes tokens per second for the installed file. Until that run, the screen says not measured yet. A saved speed is hidden when the file size no longer matches the registry.
- Dev mode is shown when the unpackaged dev licence flag is on. Term length is shown only when the signed licence has it. Plan names and prices are not shown.
- The app version is `app.getVersion()`.
- The first open downloads the Qwen size named by the installer (2B, 4B, or 9B, Q4_K_M) into the app data folder and checks the registry SHA-256. There is no model picker. A file already in Downloads, or a `synap://setup` link that includes a file path, is verified against the registry SHA-256 and moved into the models folder. If none is found, chat shows "Get your model from synap.surf to start chatting" and a button that opens the website. Settings lists an installed model by its plain name.
- Each chat keeps the agent it was started with. The header shows the bot name beside that agent's badge, for example Surf beside Code. The chat title stays in the sidebar list. Clicking the name edits it in place: Enter saves, Esc cancels. Settings, General, Bot name edits the same name. The name is trimmed, kept to 32 characters, and an empty name is Surf. The input says Message Surf…, and each reply is labelled with that name. A new chat is a Code chat. The account menu opens that agent's latest chat, or starts one, and does not retitle the chat that was already open. General, Assistant, Marine, Pilot, and Construction stay on the card as coming soon and appear in the filter once they have a chat. There is no All / General / Code filter. The open chat stays in the list and is highlighted.
- Arithmetic such as “what is 2+2” is calculated on this computer, then the model phrases that exact number. Greetings, explanations, and small code questions go to the local model. Web search is allowed in Settings, and Offline, Online, or Auto is set there too. The message box does not repeat those controls. File search stays on this chat. The box is an attach menu, the message field, a microphone button, and Send. Attach file, attach image, and capture screenshot are in that menu. Web search uses public pages on the device. It does not call api.synap.surf. A failed search still answers from the model and says so. “Showing results for …” appears only when a web page was used. Offline mode says the network is off and does not fetch.
- Read aloud uses the operating system voice: `say` on macOS and System.Speech on Windows. A second click stops it. If this computer has no voice, the reply row says so. The text is not uploaded.
- The microphone button records on this computer and whisper.cpp (`whisper-cli`, pinned build b5454) types the words into the message box. The speech model is the registry file for this computer's tier, downloaded with its SHA-256 and a plain percent. macOS asks with the system microphone prompt. Windows uses the system microphone permission. Pip shows listening while the microphone is open. The recording is not played back and is not uploaded. Offline only, with no speech model yet, says so and does not fetch.
- Cache Clear does not remove models or chats. A chat with no model shows the website download line and https://synap.surf/#download.

## Not shown, because there is no real source

- Cloud spillover, cloud fallback, weekly compute quota, plan names, and prices.
- Tokens per second, engine version, config id, Metal graph, connected-app counts, telemetry throughput, and an air-gap badge.
- System theme. The product theme is light or dark.
- Screenshot files the person saved somewhere else with the save dialog. Those paths are not in app data, and they are not added to the cache.

## Animations

Pip is the live blob in `packages/ui/src/BlobMascot.tsx`, not a clip. `animation/manifest.json` lists the blob moods. The stylesheet still records thinking at 2.2s and searching at 0.7s. The other moods are not fixed-length clips. A poke squashes the body, and three quick pokes make Pip dizzy. No audio files were added. The build does not package an mp4. The window pauses the animation while it is hidden.

## Eval

`step11-questions.ts` scores 102 questions with the real gates: coding 20, splitting 15, run/fix 10, screenshots 13, finance 10, legal 9, no-fabrication 10, and everyday 15. Everyday questions are “what is 2+2” and the similar sums, a greeting, a short explanation, a fact, a small code question, and the computer-control asks. Sums use the calculator. Control asks must be the plain “isn't available yet” reply. Every row of the Step 11 suite must pass; the suite prints its own row count instead of the doc repeating one. Those checks do not call a model. The desktop unit job and the model-eval job print `everyday <id> pass` or `fail` for each one. They also print `shape <id> pass` or `fail`: a visible reply must not end mid-word, fences and bold marks must be closed, and the text must not contain a replacement character.

The `model-eval` CI job downloads Qwen3.5-2B Q4_K_M, checks the registry SHA-256, and asks llama-server a 44-question subset (coding, splitting, run/fix, finance, and all 10 no-fabrication questions). Everyday questions are scored in that job before the model starts, and they are not sent to llama-server. No-fabrication is scored after the verifier: a missing source returns the fixed "Unable to find … right now" line and does not call the model, and a number, price, date, URL, section, or quote that is not in the supplied record is removed. Finance and legal answers are composed in code. The job records accuracy, tokens per second, time to first token, and peak llama-server RSS. It prints `shape n/total pass` for the model replies as well as for the everyday set. The subset floors in `harness/baselines/model-eval.json` are accuracy 1.0 and no-fabrication 1.0. The 87-question model run keeps no-fabrication at 1.0 and uses `fullMinAccuracy` for the other model questions. The GGUF is cached by file SHA and is not committed.

`model-eval-full` runs nightly. A `v*` tag runs it with the release gate before installers. It covers Qwen 2B, 4B, and 9B, all 87 model questions, and the mmproj screenshot add-on. `scripts/measure-ram.ts` starts llama-server when a GGUF is present and samples process RSS. A missing file still exits 0. Set the repository variable `SURF_MODEL_EVAL_RUNNER` to use a larger runner. Otherwise `./scripts/model-eval-full.sh` is the one command on a Mac, and the release gate reads `harness/baselines/model-eval-full.json` for any size that runner could not load.

## Release

A `v*` tag runs the CI workflow, including the Step 11 suite, and only then builds installers. This step does not push a tag.
