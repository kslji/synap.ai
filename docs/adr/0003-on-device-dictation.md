# ADR 0003 — Dictate with whisper.cpp

The message box needs speech-to-text that stays on the computer and works the same on macOS and Windows.

macOS `SFSpeechRecognizer` can require Apple to download a speech asset, and it does not exist on Windows. Windows `System.Speech.Recognition` is a command grammar, not open dictation. The WinRT speech APIs are not available to this Node process without another native addon.

whisper.cpp is the architecture choice: MIT, offline, and one `whisper-cli` on both systems. Linux and Windows use the official b5454 archives. macOS has no CLI archive for that tag, so the installer job builds that same tag. The model is the registry row for the machine's tier (`whisper-base-q8_0`, `whisper-small-q8_0`, or `whisper-large-v3-turbo-q5_0`), fetched with the existing size and SHA-256 check. A button recording is already bounded, so Silero VAD is not applied to it. The clip is not played back and is not uploaded.
