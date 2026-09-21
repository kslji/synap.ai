# Pack self-check (Surf AI)

Run this inside your unzipped pack folder to verify the download is healthy
before you chat. No internet required for these checks (Ollama ping is optional).

## Mac / Linux

```bash
bash harness/check-pack.sh
```

## Windows

```bat
harness\check-pack.bat
```

## What it proves

| Check | Meaning |
|---|---|
| `agent.json` present | Pack identity file exists |
| Model title / tag match | This folder is only for the model you downloaded |
| `MODEL.txt` | Human-readable identity card |
| `local-agent.html` | Chat page baked for this model (not another) |
| No re-download upsell | Standalone pack must not nag synap.surf for a “larger pack” |
| Summarize + delete wired | Sidebar buttons call `compact()` / `wipe()` |
| Mic on/off icons | Recording state is visible |
| Moss vault sealed | `moss_vault.enc` uses surf-seal-v1 (no plaintext keys) |
| Moss bridge present | `moss_bridge.py` ships in the pack |
| Ollama (optional) | If Ollama is up, this pack’s tag is listed or pullable |

## Default Moss path (automated)

From the repo (no download needed):

```bash
python3 harness/evals/test_moss_pack.py
```

This proves seal → unseal → index → search works by default (keyword fallback without SDK keys).

## Smoke prompts (manual)

After `LOCAL-SETUP` / `SURF-OPEN` opens chat, try:

1. `Which model are you using?` → must answer this pack’s model name
2. Attach a short `.txt` and ask `Summarize this file in one sentence.`
3. `Save a short summary and delete chats` → should keep a memory note
4. `Delete all chats and files` → click twice to confirm wipe

If any automated check fails, re-download the pack from synap.surf/download.
